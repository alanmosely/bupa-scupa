import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA, RAW, HEADERS, loadConfig, saveConfig, atomicWrite, ensureDir } from './util.js';
import { loadMaster, mergeRecords } from './merge.js';
import { parseRawDir, parseStatementText, pdfToText } from './parse.js';
import {
  documentHash,
  resolveDocument,
  resolveClaimPdf,
  currentClaimFiles,
  documentReviews,
} from './documents.js';
import { emptyFollowUp, queryClaims, assessmentKey, assessmentReviewed } from './claims.js';
import { loadWorkspace, storeFollowUp, saveView, removeView } from './workspace.js';
import { validatePdf } from './safety.js';
import { toCsv } from './csv.js';
import { ScupaError } from './errors.js';
export { ScupaError };

function validateNames(names) {
  if (!Array.isArray(names) || names.length < 1 || names.length > 30)
    throw new ScupaError('INVALID_INPUT', 'Enter between 1 and 30 member names.');
  if (names.some((name) => typeof name !== 'string'))
    throw new ScupaError('INVALID_INPUT', 'Member names must be text.');
  names = names.map((name) => name.trim().replace(/\s+/g, ' '));
  if (
    names.some((n) => !n || n.length > 100 || /[\x00-\x1f]/.test(n)) ||
    new Set(names.map((n) => n.toLowerCase())).size !== names.length
  ) {
    throw new ScupaError('INVALID_INPUT', 'Use distinct member names as shown in MembersWorld.');
  }
  return names;
}
export function setup(names) {
  names = validateNames(names);
  const cfg = loadConfig();
  if (Object.keys(cfg.members).length)
    throw new ScupaError(
      'ALREADY_CONFIGURED',
      'This archive already has a household. Choose another archive folder for another household.',
    );
  cfg.members = Object.fromEntries(
    names.map((displayName, i) => [
      'm_' +
        crypto.createHash('sha256').update(displayName.toLowerCase()).digest('hex').slice(0, 16),
      { displayName, self: i === 0 },
    ]),
  );
  saveConfig(cfg);
  return snapshot();
}
/** Correct display names without changing member IDs, ownership or archive paths. */
export function updateHousehold(edits) {
  const cfg = loadConfig();
  const ids = Object.keys(cfg.members);
  if (!ids.length) throw new ScupaError('SETUP_REQUIRED', 'Set up your household first.');
  if (
    !Array.isArray(edits) ||
    edits.length !== ids.length ||
    new Set(edits.map((edit) => edit?.id)).size !== ids.length ||
    edits.some((edit) => !edit || !Object.hasOwn(cfg.members, edit.id))
  ) {
    throw new ScupaError(
      'INVALID_INPUT',
      'Correct the existing household names. Members cannot be reassigned or removed.',
    );
  }
  const names = validateNames(edits.map((edit) => edit.displayName));
  const changed = edits.some((edit, index) => cfg.members[edit.id].displayName !== names[index]);
  if (!changed) return snapshot();
  const backup = path.join(DATA, 'household-backups', `household-${crypto.randomUUID()}.json`);
  atomicWrite(backup, JSON.stringify(cfg, null, 2) + '\n');
  edits.forEach((edit, index) => {
    if (cfg.members[edit.id].displayName !== names[index]) {
      cfg.members[edit.id].displayName = names[index];
      cfg.members[edit.id].needsConfirmation = true;
    }
  });
  saveConfig(cfg);
  return snapshot();
}

export function archiveHelp() {
  const file = path.join(DATA, 'parsed.json');
  let issues = [];
  const documents = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    issues = Array.isArray(parsed.stats?.errors)
      ? parsed.stats.errors.filter((message) => typeof message === 'string').slice(0, 50)
      : [];
    for (const document of Array.isArray(parsed.documents) ? parsed.documents : []) {
      try {
        const absolute = reviewedDocumentPath(document);
        const reviews = documentReviews(path.dirname(absolute));
        const supporting = reviews.supporting[path.basename(absolute)]?.sha256 === document.sha256;
        const assessment = reviews.assessments[path.basename(absolute)]?.sha256 === document.sha256;
        documents.push({
          file: document.file,
          sha256: document.sha256,
          supporting,
          assessment,
          readable: document.readable === true,
        });
      } catch {
        // Stale or invalid diagnostics cannot authorise a document review.
      }
    }
  } catch {
    /* No prior parsing diagnostics. */
  }
  return { dataDir: DATA, issues, documents, lock: inspectLock() };
}

export function reviewedDocumentPath({ file, sha256 }) {
  const absolute = resolveDocument(file);
  if (typeof sha256 !== 'string' || documentHash(absolute) !== sha256)
    throw new ScupaError(
      'INVALID_INPUT',
      'The PDF has changed. Recheck saved PDFs before reviewing it.',
    );
  validatePdf(fs.readFileSync(absolute));
  return absolute;
}

/** Caller holds the archive lock. This decision never changes a PDF or master row. */
export function reviewDocument({ file, sha256, classification }) {
  if (![null, 'supporting', 'assessment'].includes(classification))
    throw new ScupaError('INVALID_INPUT', 'Choose a document classification.');
  const absolute = reviewedDocumentPath({ file, sha256 });
  const text = classification === null ? '' : pdfToText(process.env.SCUPA_PDFTOTEXT, absolute);
  if (classification === 'supporting' && text.trim())
    throw new ScupaError(
      'INVALID_INPUT',
      'Only image-only documents can be reviewed here. Statement parsing errors must be resolved.',
    );
  if (classification === 'assessment') {
    const records = parseStatementText(text, file.split('/')[0]);
    if (!records.length || records.some((record) => record.errors.length))
      throw new ScupaError(
        'INVALID_INPUT',
        'Only readable, valid assessments can be approved. Parsing errors must be resolved.',
      );
  }
  reviewedDocumentPath({ file, sha256 });
  const directory = path.dirname(absolute);
  const reviews = documentReviews(directory);
  const name = path.basename(absolute);
  delete reviews.supporting[name];
  delete reviews.assessments[name];
  if (classification !== null)
    reviews[classification === 'supporting' ? 'supporting' : 'assessments'][name] = {
      sha256,
      reviewedAt: new Date().toISOString(),
    };
  atomicWrite(
    path.join(directory, 'document-reviews.json'),
    JSON.stringify({ schemaVersion: 1, ...reviews }, null, 2),
  );
}

/** Only ESRCH proves that the process is gone. Permission errors remain busy. */
function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}
export function inspectLock({ ignoreRecovery = false } = {}) {
  if (!ignoreRecovery && fs.existsSync(path.join(DATA, '.scupa-recovery')))
    return { state: 'unknown', recoverable: false };
  const file = path.join(DATA, '.scupa-lock');
  if (!fs.existsSync(file)) return { state: 'unlocked', recoverable: false };
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Number.isSafeInteger(value.pid) || value.pid < 1 || typeof value.startedAt !== 'string') {
      return { state: 'unknown', recoverable: false };
    }
    const alive = processIsAlive(value.pid);
    return { state: alive ? 'active' : 'stale', recoverable: !alive, startedAt: value.startedAt };
  } catch {
    return { state: 'unknown', recoverable: false };
  }
}
export function recoverLock() {
  ensureDir(DATA);
  const recovery = path.join(DATA, '.scupa-recovery');
  let handle;
  try {
    handle = fs.openSync(recovery, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new ScupaError('BUSY', 'Another recovery is already in progress.');
    throw error;
  }
  try {
    const lock = inspectLock({ ignoreRecovery: true });
    if (lock.state === 'unlocked') return { recovered: false };
    if (!lock.recoverable)
      throw new ScupaError(
        'BUSY',
        'SCUPA cannot safely release this lock. Close the other SCUPA window, then try again.',
      );
    // All writers honour the recovery guard. A new lock cannot replace this one.
    fs.unlinkSync(path.join(DATA, '.scupa-lock'));
    return { recovered: true };
  } finally {
    fs.closeSync(handle);
    fs.unlinkSync(recovery);
  }
}
export function snapshot() {
  const cfg = loadConfig();
  const rows = loadMaster();
  /** @type {Record<string, {claimed: number, paid: number, claims: number}>} */
  const totals = {};
  for (const row of rows) {
    if (!row.currency || !row.paid_currency || !row.paid || !row.claimed) continue;
    for (const currency of new Set([row.currency, row.paid_currency])) {
      const t = (totals[currency] ??= { claimed: 0, paid: 0, claims: 0 });
      if (currency === row.currency) t.claimed += Math.round(Number(row.claimed) * 100);
      if (currency === row.paid_currency) t.paid += Math.round(Number(row.paid) * 100);
      t.claims++;
    }
  }
  for (const t of Object.values(totals)) {
    t.claimed /= 100;
    t.paid /= 100;
  }
  return {
    workspace: loadWorkspace(),
    schemaVersion: 1,
    dataDir: DATA,
    configured: !!Object.keys(cfg.members).length,
    members: cfg.members,
    rows,
    totals,
    lastSync: cfg.lastSync || null,
    awaiting: rows.filter((r) => /^No statement/i.test(r.status)).length,
  };
}
export function acquireLock() {
  ensureDir(DATA);
  const file = path.join(DATA, '.scupa-lock');
  const recovery = path.join(DATA, '.scupa-recovery');
  if (fs.existsSync(recovery))
    throw new ScupaError('BUSY', 'Archive recovery is in progress. Please try again shortly.');
  try {
    fs.writeFileSync(
      file,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
      { flag: 'wx', mode: 0o600 },
    );
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new ScupaError(
      'BUSY',
      'This archive is locked by another operation. Close other SCUPA windows, then open Archive help to check for an interrupted run.',
    );
  }
  if (fs.existsSync(recovery)) {
    fs.unlinkSync(file);
    throw new ScupaError('BUSY', 'Archive recovery is in progress. Please try again shortly.');
  }
  return () => fs.unlinkSync(file);
}
export function reparse({ dryRun = false, checkCancelled = () => {} } = {}) {
  checkCancelled();
  if (!Object.keys(loadConfig().members).length)
    throw new ScupaError('SETUP_REQUIRED', 'Set up your household first.');
  const result = parseRawDir({ checkCancelled });
  if (result.stats.errors?.length)
    throw new ScupaError(
      'PARSE_FAILED',
      'Some statements could not be safely parsed. Your master records are unchanged. Open Archive help to review the affected files.',
    );
  checkCancelled();
  const merged = mergeRecords(result.records, { dryRun });
  const changes = {
    added: merged.added.map((record) =>
      Object.fromEntries(HEADERS.map((field) => [field, record[field] ?? ''])),
    ),
    updated: merged.updated.map(({ rec, diffs }) => ({
      member: rec.member,
      claim_ref: rec.claim_ref,
      diffs,
    })),
  };
  return {
    added: merged.added.length,
    updated: merged.updated.length,
    changes,
    warnings: merged.warnings,
    parsed: result.stats,
    dryRun,
  };
}
export function spreadsheetCsv(rows) {
  // Neutralise formulas even when a cell has leading whitespace or a control character.
  const safe = rows.map((row) =>
    Object.fromEntries(
      HEADERS.map((h) => {
        let value = String(row[h] ?? '');
        if (/^[\s\x00-\x1f]*[=+\-@]/.test(value)) value = "'" + value;
        return [h, value];
      }),
    ),
  );
  return '\ufeff' + toCsv(safe, HEADERS);
}
export function exportCsv(file, query = {}) {
  if (!path.isAbsolute(file))
    throw new ScupaError('INVALID_INPUT', 'The export path must be absolute.');
  const relative = path.relative(DATA, path.resolve(file));
  if (
    !relative ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  ) {
    throw new ScupaError(
      'INVALID_INPUT',
      'Export outside the archive folder to protect the master records.',
    );
  }
  if (fs.existsSync(file)) throw new ScupaError('FILE_EXISTS', 'Choose a new export filename.');
  const rows = queryClaims(loadMaster(), query, loadWorkspace().followUps, loadConfig().members);
  fs.writeFileSync(file, spreadsheetCsv(rows), { flag: 'wx', mode: 0o600 });
  return { file, rows: rows.length };
}

function knownClaim(claimRef) {
  if (typeof claimRef !== 'string' || !/^CL\d{12}$/.test(claimRef))
    throw new ScupaError('INVALID_INPUT', 'Choose a claim in this archive.');
  const row = loadMaster().find((claim) => claim.claim_ref === claimRef);
  if (!row || !Object.hasOwn(loadConfig().members, row.member))
    throw new ScupaError('INVALID_INPUT', 'Choose a claim in this archive.');
  return row;
}
export function claimDetails({ claimRef }) {
  const row = knownClaim(claimRef);
  const directory = path.join(RAW, row.member, claimRef);
  const documents = [];
  let documentError = '';
  try {
    if (fs.existsSync(directory)) {
      if (fs.lstatSync(directory).isSymbolicLink())
        throw new Error('Linked archive documents are not supported.');
      for (const name of currentClaimFiles(directory)) {
        const file = `${row.member}/${claimRef}/${name}`;
        const absolute = resolveClaimPdf(file);
        validatePdf(fs.readFileSync(absolute));
        documents.push({
          file,
          name,
          sha256: documentHash(absolute),
          kind: /^supporting_/i.test(name) ? 'Supporting document' : 'Statement document',
        });
      }
    }
  } catch (error) {
    documentError = error.message;
  }
  const followUp = loadWorkspace().followUps[claimRef] || emptyFollowUp();
  return {
    row,
    followUp: {
      ...followUp,
      reviewed: assessmentReviewed(row, followUp),
      assessmentKey: assessmentKey(row),
    },
    documents,
    documentError,
  };
}
export function claimDocumentPath({ claimRef, file, sha256 }) {
  const row = knownClaim(claimRef);
  if (typeof file !== 'string' || !file.startsWith(`${row.member}/${claimRef}/`))
    throw new ScupaError('INVALID_INPUT', 'Choose a document belonging to this claim.');
  const absolute = resolveClaimPdf(file);
  if (typeof sha256 !== 'string' || documentHash(absolute) !== sha256)
    throw new ScupaError('INVALID_INPUT', 'The PDF has changed. Reopen the claim details.');
  validatePdf(fs.readFileSync(absolute));
  return absolute;
}
/** Caller holds the archive lock. */
export function updateFollowUp({ claimRef, followUp }) {
  const row = knownClaim(claimRef);
  if (followUp?.reviewed && followUp.assessmentKey !== assessmentKey(row))
    throw new ScupaError(
      'INVALID_INPUT',
      'This assessment has changed. Reopen the claim details before marking it reviewed.',
    );
  storeFollowUp(claimRef, { ...followUp, assessmentKey: assessmentKey(row) });
  return snapshot();
}
export function saveClaimView({ name, query }) {
  saveView(name, query);
  return snapshot();
}
export function removeClaimView({ id }) {
  removeView(id);
  return snapshot();
}
export function status() {
  const cfg = loadConfig();
  return {
    schemaVersion: 1,
    configured: !!Object.keys(cfg.members).length,
    dataDir: DATA,
    members: Object.entries(cfg.members).map(([id, m]) => ({ id, displayName: m.displayName })),
    claimCount: loadMaster().length,
    lastSync: cfg.lastSync || null,
    locked: inspectLock().state !== 'unlocked',
  };
}
