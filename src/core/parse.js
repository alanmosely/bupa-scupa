import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CLAIM_STATUS } from './model.js';
import { currentClaimFiles, documentReviews, documentHash } from './documents.js';
import {
  RAW,
  PARSED,
  HEADERS,
  loadConfig,
  refToDate,
  ddmmyyyyToIso,
  md5,
  parseMoney,
  fmtMoney,
  atomicWrite,
} from './util.js';

const AMOUNT_CELL = /^-?[£€]?\s?\d[\d,]*\.\d{2}$/;
const DUP_WORDING = /won't pay this cost because we've reviewed it before/i;
const NOT_LIABLE = /member is not liable to pay for the shortfall/i;
const REASON_LINE = /unable to pay|won't pay|we cannot pay/i;
const matchesCurrency = (amount, currency) =>
  (!amount.includes('£') || currency === 'GBP') && (!amount.includes('€') || currency === 'EUR');

function statementCurrencies(header, segment, errors) {
  const evidence = header + '\n' + segment;
  const codes = new Set(
    evidence
      .match(/\b(?:GBP|EUR|USD|CHF|HKD|AED|SGD|AUD|CAD|JPY|CNY|NZD)\b/gi)
      ?.map((s) => s.toUpperCase()) || [],
  );
  for (const match of evidence.matchAll(/\bcurrency(?:\s+code)?\s*[:=]?\s*([A-Z]{3})\b/gi))
    codes.add(match[1].toUpperCase());
  for (const match of evidence.matchAll(/\bAmount\s*\(([A-Z]{3})\)/gi))
    codes.add(match[1].toUpperCase());
  if (evidence.includes('£')) codes.add('GBP');
  if (evidence.includes('€')) codes.add('EUR');
  // A bare dollar or yen sign cannot identify a particular currency safely.
  if (
    [...evidence.matchAll(/\p{Sc}/gu)].some(([symbol]) => !['£', '€'].includes(symbol)) ||
    [...codes].some((code) => !['GBP', 'EUR'].includes(code))
  ) {
    errors.push({
      code: 'UNSUPPORTED_CURRENCY',
      message: 'unsupported statement currency — review manually',
    });
    return null;
  }
  if (codes.size === 1) {
    const currency = [...codes][0];
    return { claimed: currency, paid: currency, columns: 0 };
  }
  // Only a labelled conversion table establishes which currency belongs to each
  // amount. Two currency names elsewhere in a document are not enough.
  const tables = segment
    .split(/\r?\n/)
    .filter((line) => /^\s*Treatment date\s+Benefit or deduction\b/i.test(line))
    .map((line) =>
      /^\s*Treatment date\s+Benefit or deduction\s+(tax\s*\/\s*discount\s+)?Amount\s*\((GBP|EUR)\)\s+Amount\s*\((GBP|EUR)\)\s*$/i.exec(
        line,
      ),
    );
  const first = tables[0];
  if (
    codes.size === 2 &&
    first &&
    first[2].toUpperCase() !== first[3].toUpperCase() &&
    tables.every(
      (table) =>
        table &&
        table[2].toUpperCase() === first[2].toUpperCase() &&
        table[3].toUpperCase() === first[3].toUpperCase() &&
        !!table[1] === !!first[1],
    )
  ) {
    return {
      claimed: first[2].toUpperCase(),
      paid: first[3].toUpperCase(),
      columns: first[1] ? 3 : 2,
    };
  }
  errors.push({
    code: codes.size ? 'AMBIGUOUS_CURRENCY' : 'MISSING_CURRENCY',
    message: (codes.size ? 'ambiguous' : 'missing') + ' statement currency — review manually',
  });
  return null;
}

function findPdftotext() {
  const bin = process.env.SCUPA_PDFTOTEXT;
  if (bin) {
    const r = spawnSync(bin, ['-v'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    if (!r.error && /pdftotext version/i.test((r.stdout || '') + (r.stderr || ''))) return bin;
  }
  throw new Error(
    'Bundled PDF reader not found. Re-download the complete BUPA SCUPA release, or run npm run vendor in a source checkout.',
  );
}

const textModes = new Map();
export function pdfToText(bin, pdfPath) {
  if (!textModes.has(bin)) {
    const help = spawnSync(bin, ['-h'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    // Xpdf's table mode keeps amounts aligned with their labels; layout mode
    // can shift a bold total or a second benefit amount onto the preceding line.
    textModes.set(
      bin,
      /-table\b/.test((help.stdout || '') + (help.stderr || '')) ? '-table' : '-layout',
    );
  }
  const r = spawnSync(bin, [textModes.get(bin), '-enc', 'UTF-8', pdfPath, '-'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`pdftotext failed on ${pdfPath}: ${(r.stderr || '').trim()}`);
  return r.stdout;
}

const normQuotes = (s) => s.replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D]/g, '"');

function findTotalLine(text) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*Total\s+payment\s+made\s+to\s+(you\b|your\s+healthcare(?:\s+provider)?\b)/i.exec(
      lines[i],
    );
    if (!m) continue;
    let line = lines[i];
    if (/your healthcare$/i.test(m[1].replace(/\s+/g, ' '))) {
      if (!/^\s*provider\b/i.test(lines[i + 1] || '')) continue;
      line += ' ' + lines[i + 1];
    }
    const amounts = line.match(/-?[£€]?\s?\d[\d,]*\.\d{2}/g);
    if (!amounts) continue;
    const values = amounts.map(parseMoney);
    return {
      paidTo: /healthcare/i.test(m[1]) ? 'provider' : 'you',
      // A table total may include claimed and deducted columns before payment.
      paid: values[values.length - 1],
      amounts: values,
      cells: amounts,
    };
  }
  return null;
}

function compareStatements(a, b) {
  return (
    (a.payment_date || '').localeCompare(b.payment_date || '') ||
    a.source.mtime - b.source.mtime ||
    a.source.file.localeCompare(b.source.file, 'en', { numeric: true })
  );
}

function findPaymentDate(text) {
  const m = /(?:payment date|date of payment|paid(?: to you)? on)[:\s]*(\d{2}\/\d{2}\/\d{4})/i.exec(
    text,
  );
  return m ? ddmmyyyyToIso(m[1]) : '';
}

export function parseStatementText(rawText, member) {
  const text = normQuotes(rawText);
  const marks = [];
  const re = /For Claim\s+(CL\d{12})/g;
  let m;
  while ((m = re.exec(text))) marks.push({ ref: m[1], idx: m.index });
  if (!marks.length) return [];

  const records = [];
  for (let i = 0; i < marks.length; i++) {
    const seg = text.slice(marks[i].idx, marks[i + 1] ? marks[i + 1].idx : undefined);
    records.push(parseClaimSegment(seg, marks[i].ref, member, text, marks.length));
  }
  return records;
}

function parseClaimSegment(seg, ref, member, fullText, nClaims) {
  const warnings = [];
  /** @type {Array<{code: string, message: string}>} */
  const errors = [];
  let assessment = seg;
  const adjustment = /Total\s+adjustment\s+payment\s+made[^\n]*/i.exec(seg);
  if (adjustment) {
    const tail = seg.slice(adjustment.index + adjustment[0].length);
    const current = tail.search(/For treatment at/i);
    assessment = current >= 0 ? tail.slice(current) : '';
    if (current < 0)
      errors.push({
        code: 'MISSING_ASSESSMENT',
        message: 'current assessment not found after adjustment',
      });
  }
  const currencies = statementCurrencies(
    fullText.slice(0, fullText.indexOf('For Claim')),
    assessment,
    errors,
  );
  const converted = !!currencies?.columns;
  const benefit = [];
  for (const line of assessment.split(/\r?\n/)) {
    // A dated row that does not fit the table must not disappear from the claim.
    if (!/^\s*(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})\b/.test(line)) continue;
    const cells = line.trim().split(/\s{2,}/);
    const amountCells = [];
    while (cells.length > 1 && AMOUNT_CELL.test(cells[cells.length - 1])) {
      amountCells.unshift(cells.pop());
    }
    const amounts = amountCells.map(parseMoney);
    if (
      !amounts.length ||
      (converted &&
        (amounts.length !== currencies.columns ||
          amountCells.some(
            (cell, index) =>
              !matchesCurrency(
                cell,
                index === amountCells.length - 1 ? currencies.paid : currencies.claimed,
              ),
          ))) ||
      cells.length < 2 ||
      !/^\d{2}\/\d{2}\/\d{4}$/.test(cells[0]) ||
      cells.slice(1).some((cell) => /(?:^|\s)-?[£€]?\d[\d,]*\.\d{2}(?:\s|$)/.test(cell))
    ) {
      errors.push({
        code: 'UNPARSED_BENEFIT',
        message: 'a dated benefit row could not be parsed completely — review manually',
      });
      continue;
    }
    const date = ddmmyyyyToIso(cells.shift());
    const desc = cells.join(' ').trim();
    const nonPayable = /non ?payable item/i.test(desc);
    const claimed = converted
      ? amounts[amounts.length - 2]
      : nonPayable
        ? amounts[amounts.length - 1]
        : amounts[0];
    benefit.push({ date, desc, claimed, nonPayable });
  }
  if (!benefit.length)
    errors.push({
      code: 'MISSING_BENEFITS',
      message: 'no benefit lines parsed — refusing zero-value assessment',
    });

  const provM = /For treatment at\s+(.+?)\s*\(provider invoice\s+([^)]+)\)/i.exec(assessment);
  const provider = provM ? provM[1].replace(/\s+/g, ' ').trim() : '';
  const invoice = provM ? provM[2].replace(/\s+/g, ' ').trim() : '';
  if (!provM) warnings.push('provider line not found');

  const totalText = !adjustment && nClaims === 1 ? fullText : assessment;
  const totalMatches = totalText.match(/Total\s+payment\s+made\s+to/gi) || [];
  const total = totalMatches.length === 1 ? findTotalLine(totalText) : null;
  if (totalMatches.length > 1) {
    errors.push({
      code: 'AMBIGUOUS_PAYMENT_TOTAL',
      message: 'multiple payment totals for one claim — review manually',
    });
  } else if (!total) {
    errors.push({
      code: 'MISSING_PAYMENT_TOTAL',
      message: 'no authoritative payment total — review manually',
    });
  }

  const claimed = Math.round(benefit.reduce((s, b) => s + b.claimed, 0) * 100) / 100;
  let paid;
  let paidInClaimCurrency;
  let paidTo = '';
  if (total) {
    paid = total.paid;
    paidInClaimCurrency = converted ? total.amounts[0] : paid;
    paidTo = total.paidTo;
    if (
      converted &&
      (total.amounts.length !== 2 ||
        !total.cells.every((cell, index) =>
          matchesCurrency(cell, index === 0 ? currencies.claimed : currencies.paid),
        ))
    )
      errors.push({
        code: 'INVALID_CONVERSION_TOTAL',
        message:
          'conversion total must give both amounts in their labelled currencies — review manually',
      });
    if (converted && nClaims === 1) {
      const payments = [
        ...fullText.matchAll(/^\s*Payment amount\s+(GBP|EUR)\s+(-?\d[\d,]*\.\d{2})\s*$/gim),
      ];
      if (
        payments.some(
          (payment) =>
            payment[1].toUpperCase() !== currencies.paid ||
            Math.abs(parseMoney(payment[2]) - paid) > 0.005,
        )
      )
        errors.push({
          code: 'INVALID_CONVERSION_TOTAL',
          message: 'conversion payment disagrees with the statement total — review manually',
        });
    }
  }

  const isDup = DUP_WORDING.test(assessment);
  const notLiable = NOT_LIABLE.test(assessment);
  let status;
  if (isDup) {
    paid = 0;
    status = CLAIM_STATUS.duplicate;
  } else if (Math.abs(paidInClaimCurrency - claimed) < 0.005) {
    status = CLAIM_STATUS.paid;
  } else if (paidInClaimCurrency === 0) {
    status = CLAIM_STATUS.rejected;
  } else if (notLiable) {
    status = CLAIM_STATUS.planRate;
  } else {
    status = CLAIM_STATUS.partial;
  }

  const categories = [
    ...new Set(benefit.filter((b) => !b.nonPayable && b.desc).map((b) => b.desc)),
  ].join('; ');
  const isDental = /dental|ortho|hygien/i.test(categories + ' ' + provider) ? 'True' : 'False';
  const treatmentDate =
    benefit
      .map((b) => b.date)
      .filter(Boolean)
      .sort()[0] || '';

  let notes = '';
  if (status !== CLAIM_STATUS.paid) {
    const reasons = assessment
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => REASON_LINE.test(l));
    notes = [...new Set(reasons)].join(' | ').slice(0, 250);
  }

  return {
    member,
    claim_ref: ref,
    received_date: refToDate(ref),
    treatment_date: treatmentDate,
    currency: currencies?.claimed || '',
    claimed: fmtMoney(claimed),
    paid_currency: currencies?.paid || '',
    paid: fmtMoney(paid),
    status,
    paid_to: paidTo,
    benefit_categories: categories,
    is_dental: isDental,
    provider,
    payment_date:
      findPaymentDate(seg) ||
      findPaymentDate(fullText.slice(0, fullText.indexOf('For Claim'))) ||
      (nClaims === 1 ? findPaymentDate(fullText) : ''),
    notes,
    invoice,
    warnings,
    errors,
    stub: false,
  };
}

/** @param {{rawDir?: string, parsedPath?: string, extractText?: (file: string) => string, checkCancelled?: () => void}} [options] */
export function parseRawDir({
  rawDir = RAW,
  parsedPath = PARSED,
  extractText,
  checkCancelled = () => {},
} = {}) {
  const cfg = loadConfig();
  const bin = extractText ? null : findPdftotext();
  const readText = extractText || ((file) => pdfToText(bin, file));
  const records = [];
  const documents = [];
  const cachedText = new Map();
  /** @type {{statements: number, duplicates: number, stubs: number, errors: string[]}} */
  const stats = { statements: 0, duplicates: 0, stubs: 0, errors: [] };

  if (!fs.existsSync(rawDir))
    throw new Error(`nothing to parse: ${rawDir} does not exist — run fetch first`);
  for (const member of fs.readdirSync(rawDir)) {
    checkCancelled();
    const memberDir = path.join(rawDir, member);
    if (!fs.statSync(memberDir).isDirectory()) continue;
    if (!Object.hasOwn(cfg.members, member)) {
      stats.errors.push(`Unknown member archive directory: ${member}`);
      continue;
    }
    for (const claimId of fs.readdirSync(memberDir)) {
      const claimDir = path.join(memberDir, claimId);
      if (!/^CL\d{12}$/.test(claimId) || !fs.statSync(claimDir).isDirectory()) continue;
      let currentFiles, reviews;
      try {
        currentFiles = currentClaimFiles(claimDir);
        reviews = documentReviews(claimDir);
      } catch (error) {
        stats.errors.push(`${member}/${claimId}: ${error.message} — refusing to merge`);
        continue;
      }
      // Portal tags supporting invoices as statements too — exclude them by label
      // Archives without current.json retain the legacy date/mtime selection.
      const statements = currentFiles
        .filter((f) => /^statement_\d+_/i.test(f) && !/invoice|receipt/i.test(f))
        .sort(
          (a, b) =>
            fs.statSync(path.join(claimDir, a)).mtimeMs -
              fs.statSync(path.join(claimDir, b)).mtimeMs ||
            a.localeCompare(b, 'en', { numeric: true }),
        );
      const perRef = new Map();
      const supportingStatements = new Set();
      for (const f of statements) {
        checkCancelled();
        let text;
        try {
          text = readText(path.join(claimDir, f));
        } catch (e) {
          stats.errors.push(`${member}/${claimId}/${f}: ${e.message}`);
          continue;
        }
        const hash = `${member}:${md5(text)}`;
        let parsed = cachedText.get(hash);
        if (parsed) {
          if (parsed.length) stats.duplicates++;
        } else {
          parsed = parseStatementText(text, member);
          cachedText.set(hash, parsed);
          if (parsed.length) stats.statements++;
        }
        // Supporting documents can have opaque labels and the portal's statement tag.
        // Titles are evidence; scans require a review bound to the PDF's contents.
        const supportingTitle =
          /(?:^|\n|[ \t]{2,})[ \t]*(?:(?:tax[ \t]+)?invoice\b|receipt\b|order[ \t]+(?:summary|details|confirmation)\b)/i;
        const statementMarker =
          /\b(?:For\s+Claim|(?:claim|payment)\s+(?:statement|summary)|Total\s+payment\s+made)\b/i;
        if (parsed.length || !text.trim()) {
          const sha256 = documentHash(path.join(claimDir, f));
          documents.push({ file: `${member}/${claimId}/${f}`, sha256, readable: !!text.trim() });
          if (!text.trim() && reviews.supporting[f]?.sha256 === sha256) supportingStatements.add(f);
          // Portal tags and statement-shaped text do not establish insurer authorship.
          // Authorise each PDF independently of the extracted-text cache.
          if (parsed.length && reviews.assessments[f]?.sha256 !== sha256)
            parsed = parsed.map((rec) => ({
              ...rec,
              errors: [
                ...rec.errors,
                {
                  code: 'UNREVIEWED_ASSESSMENT',
                  message: 'confirm this PDF is a Bupa assessment in Archive help before importing',
                },
              ],
            }));
        }
        if (!parsed.length && supportingTitle.test(text) && !statementMarker.test(text)) {
          supportingStatements.add(f);
        }
        if (!parsed.length && !supportingStatements.has(f))
          stats.errors.push(
            `${member}/${claimId}/${f}: statement format is not recognised — refusing to merge`,
          );
        for (const original of parsed) {
          const rec = {
            ...original,
            warnings: [...original.warnings],
            source: {
              file: `${member}/${claimId}/${f}`,
              mtime: fs.statSync(path.join(claimDir, f)).mtimeMs,
            },
          };
          for (const error of rec.errors) {
            stats.errors.push(
              `${member}/${claimId}/${f}: ${rec.claim_ref} [${error.code}]: ${error.message}`,
            );
          }
          if (perRef.has(rec.claim_ref)) {
            const previous = perRef.get(rec.claim_ref);
            if (compareStatements(rec, previous) < 0) continue;
            if ([...HEADERS, 'invoice'].some((field) => rec[field] !== previous[field])) {
              rec.warnings.push(
                `superseded earlier statement for this ref in ${member}/${claimId} (kept latest)`,
              );
            }
          }
          perRef.set(rec.claim_ref, rec);
        }
      }
      records.push(...perRef.values());
      if (!perRef.has(claimId)) {
        stats.stubs++;
        records.push({
          member,
          claim_ref: claimId,
          received_date: refToDate(claimId),
          treatment_date: '',
          currency: '',
          claimed: '',
          paid_currency: '',
          paid: '',
          status: CLAIM_STATUS.awaiting,
          paid_to: '',
          benefit_categories: '',
          is_dental: '',
          provider: '',
          payment_date: '',
          notes: 'no statement in portal yet',
          invoice: '',
          errors: [],
          files: currentFiles,
          warnings: [
            statements.length && !statements.every((f) => supportingStatements.has(f))
              ? 'statement file(s) present but none parseable for this ref — check manually'
              : currentFiles.length
                ? 'only invoice/supporting files in portal — not yet assessed'
                : 'claim has no attachments',
          ],
          stub: true,
        });
      }
    }
  }

  // A statement inside claim X's folder can reference other (older) claims — those
  // parse as their own refs and flow through merge as reassessments, which is intended.
  // When both a stub and a real record exist for a ref, the real one wins.
  const byRef = new Map();
  for (const r of records) {
    const prev = byRef.get(r.claim_ref);
    if (prev && prev.member !== r.member) {
      stats.errors.push(
        `${r.claim_ref} appears in both ${prev.member} and ${r.member} archives — refusing ambiguous ownership`,
      );
      continue;
    }
    if (prev && r.stub && !prev.stub) continue;
    if (prev && !prev.stub && !r.stub) {
      // A multi-claim statement can appear in several folders. Prefer a later
      // payment date, then the archive modification time, independent of traversal.
      const order = compareStatements(r, prev);
      if (order < 0) continue;
    }
    byRef.set(r.claim_ref, r);
  }
  const out = [...byRef.values()].map(({ source: _source, ...record }) => record);
  checkCancelled();
  atomicWrite(
    parsedPath,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), stats, records: out, documents },
      null,
      1,
    ),
  );
  return { records: out, stats };
}
