import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, toCsv } from './csv.js';
import { CLAIM_STATUS } from './model.js';
import {
  MASTER,
  REPORTS,
  HEADERS,
  loadConfig,
  memberOrder,
  ensureDir,
  todayIso,
  nowStamp,
  atomicWrite,
} from './util.js';

const STATUS_CANON = new Map(
  Object.values(CLAIM_STATUS).map((status) => [status.toLowerCase(), status]),
);

export function normalizeRow(row) {
  // Earlier previews stored one currency for both amounts.
  row.paid_currency ??= row.currency;
  row.invoice ??= '';
  const canon = STATUS_CANON.get((row.status || '').trim().toLowerCase());
  if (canon) row.status = canon;
  if (/^your healthcare provider$/i.test(row.paid_to || '')) row.paid_to = 'provider';
  return row;
}

export function loadMaster(masterPath = MASTER) {
  if (!fs.existsSync(masterPath)) return [];
  const text = fs.readFileSync(masterPath, 'utf8');
  const header = text.replace(/^\ufeff/, '').split(/\r?\n/)[0];
  const supported = [
    HEADERS,
    HEADERS.filter((field) => field !== 'paid_currency'),
    HEADERS.filter((field) => field !== 'invoice'),
    HEADERS.filter((field) => field !== 'invoice' && field !== 'paid_currency'),
  ];
  if (!supported.some((fields) => header === fields.join(',')))
    throw new Error('Unexpected master CSV schema. Records have not been changed.');
  return parseCsv(text).map(normalizeRow);
}

const isStubStatus = (s) => /^no statement in portal/i.test(s || '');
const nearly = (a, b) => {
  const [x, y] = [parseFloat(a), parseFloat(b)];
  if (Number.isNaN(x) && Number.isNaN(y)) return true;
  if (Number.isNaN(x) || Number.isNaN(y)) return false;
  return Math.abs(x - y) < 0.005;
};

const appendNote = (existing, note) => (existing ? `${existing} | ${note}` : note);
const validAmount = (value) =>
  typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value));

export function mergeRecords(
  records,
  { masterPath = MASTER, reportsDir = REPORTS, dryRun = false } = {},
) {
  if (!Array.isArray(records))
    throw new Error('Parsed records must be an array — refusing to rewrite master');
  const cfg = loadConfig();
  const rows = loadMaster(masterPath);
  const refs = new Set();
  for (const row of rows) {
    if (
      !/^CL\d{12}$/.test(row.claim_ref) ||
      !Object.hasOwn(cfg.members, row.member) ||
      refs.has(row.claim_ref)
    ) {
      throw new Error(
        `Invalid or duplicate master claim ${row.claim_ref} — refusing to rewrite master`,
      );
    }
    refs.add(row.claim_ref);
  }
  const byRef = new Map(rows.map((r) => [r.claim_ref, r]));
  const added = [];
  const updated = [];
  const warnings = [];

  for (const input of records) {
    const rec = { ...input, paid_currency: input.paid_currency ?? input.currency ?? '' };
    if (rec.errors?.length) {
      throw new Error(
        `Invalid parsed claim ${rec.claim_ref}: ${rec.errors.map((error) => `[${error.code}] ${error.message}`).join('; ')} — refusing to rewrite master`,
      );
    }
    if (
      !/^CL\d{12}$/.test(rec.claim_ref) ||
      !Object.hasOwn(cfg.members, rec.member) ||
      !STATUS_CANON.has((rec.status || '').toLowerCase()) ||
      (!rec.stub &&
        (!validAmount(rec.claimed) ||
          !validAmount(rec.paid) ||
          !['GBP', 'EUR'].includes(rec.currency) ||
          !['GBP', 'EUR'].includes(rec.paid_currency)))
    ) {
      throw new Error(`Invalid parsed claim ${rec.claim_ref} — refusing to rewrite master`);
    }
    for (const w of rec.warnings || []) warnings.push(`${rec.claim_ref}: ${w}`);
    const existing = byRef.get(rec.claim_ref);
    if (existing && existing.member !== rec.member) {
      throw new Error(
        `Claim ${rec.claim_ref} belongs to ${existing.member}, not ${rec.member} — refusing to rewrite master`,
      );
    }
    if (existing && !rec.stub && existing.currency && existing.currency !== rec.currency) {
      throw new Error(
        `Claim ${rec.claim_ref} currency changed from ${existing.currency} to ${rec.currency} — check manually before merging`,
      );
    }
    if (
      existing &&
      !rec.stub &&
      existing.paid_currency &&
      existing.paid_currency !== rec.paid_currency
    ) {
      throw new Error(
        `Claim ${rec.claim_ref} payment currency changed from ${existing.paid_currency} to ${rec.paid_currency} — check manually before merging`,
      );
    }
    const row = Object.fromEntries(HEADERS.map((h) => [h, rec[h] ?? '']));

    if (!existing) {
      byRef.set(rec.claim_ref, normalizeRow(row));
      added.push(rec);
      continue;
    }
    if (rec.stub) continue; // never downgrade real data to a stub

    if (isStubStatus(existing.status)) {
      row.notes = appendNote(row.notes, `statement arrived ${todayIso()} (was unassessed)`);
      byRef.set(rec.claim_ref, normalizeRow(row));
      updated.push({
        rec,
        diffs: HEADERS.filter((field) => (existing[field] ?? '') !== row[field]).map((field) => ({
          field,
          from: existing[field] ?? '',
          to: row[field],
        })),
      });
      continue;
    }

    const diffs = [];
    for (const f of ['claimed', 'paid']) {
      if (!nearly(existing[f], rec[f])) diffs.push({ field: f, from: existing[f], to: rec[f] });
    }
    // Identity and audit notes stay intact. Missing metadata does not erase known values.
    for (const f of [
      'received_date',
      'treatment_date',
      'currency',
      'paid_currency',
      'status',
      'payment_date',
      'paid_to',
      'benefit_categories',
      'is_dental',
      'provider',
      'invoice',
    ]) {
      if ((existing[f] || '') !== (rec[f] || '') && (rec[f] || '') !== '') {
        diffs.push({ field: f, from: existing[f], to: rec[f] });
      }
    }
    if (diffs.length) {
      for (const d of diffs) existing[d.field] = rec[d.field];
      existing.notes = appendNote(
        existing.notes,
        `reassessed ${todayIso()}: ${diffs.map((d) => `${d.field} ${d.from || '(empty)'}→${d.to}`).join(', ')}`,
      );
      updated.push({ rec, diffs });
    }
  }

  const order = Object.fromEntries(memberOrder(cfg).map((m, i) => [m, i]));
  const sorted = [...byRef.values()].sort(
    (a, b) =>
      (order[a.member] ?? 99) - (order[b.member] ?? 99) ||
      a.received_date.localeCompare(b.received_date) ||
      a.claim_ref.localeCompare(b.claim_ref),
  );

  if (!dryRun) {
    const csv = toCsv(sorted, HEADERS);
    if (!fs.existsSync(masterPath) || csv !== fs.readFileSync(masterPath, 'utf8')) {
      const backupDir = path.join(path.dirname(masterPath), 'backups');
      ensureDir(backupDir);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      if (fs.existsSync(masterPath))
        fs.copyFileSync(
          masterPath,
          path.join(backupDir, `${path.basename(masterPath)}.${stamp}.${process.pid}.bak`),
          fs.constants.COPYFILE_EXCL,
        );
      atomicWrite(masterPath, csv);
    }
  }

  const watch = checkWatchlist(cfg, records, byRef);
  const summary = buildSummary({ added, updated, warnings, watch, total: sorted.length });
  if (!dryRun && (added.length || updated.length)) {
    ensureDir(reportsDir);
    atomicWrite(path.join(reportsDir, `changes_${nowStamp()}_${Date.now()}.md`), summary);
  }
  return { added, updated, warnings, watch, summary, rows: sorted };
}

function checkWatchlist(cfg, records, byRef) {
  const results = [];
  for (const w of cfg.watchlist || []) {
    if (w.kind === 'invoice') {
      const hit = records.find(
        (r) => (r.invoice || '') === w.match || (r.files || []).some((f) => f.includes(w.match)),
      );
      results.push({
        ...w,
        result: !hit
          ? 'not seen yet'
          : hit.stub
            ? `SUBMITTED as ${hit.claim_ref} (${hit.member}) — awaiting assessment`
            : `APPEARED as ${hit.claim_ref} (${hit.member}, claimed ${hit.currency} ${hit.claimed}, paid ${hit.paid_currency} ${hit.paid}, ${hit.status})`,
      });
    } else if (w.kind === 'claim') {
      const row = byRef.get(w.match);
      results.push({
        ...w,
        result: !row
          ? 'ref not in master'
          : isStubStatus(row.status)
            ? 'still no statement — chase Bupa'
            : `RESOLVED: now "${row.status}" (paid ${row.paid_currency} ${row.paid})`,
      });
    }
  }
  return results;
}

function buildSummary({ added, updated, warnings, watch, total }) {
  const L = [`# Bupa merge — ${todayIso()}`, ''];
  L.push(
    `Master now holds **${total} claims**. ${added.length} added, ${updated.length} updated.`,
    '',
  );
  if (added.length) {
    L.push('## New claims');
    for (const r of added) {
      L.push(
        `- ${r.member} ${r.claim_ref} — ${r.provider || '?'} — claimed ${r.currency} ${r.claimed || '?'}, paid ${r.paid_currency} ${r.paid || '?'} (${r.status})`,
      );
    }
    L.push('');
  }
  if (updated.length) {
    L.push('## Updated (reassessments / statements arrived)');
    for (const { rec, diffs } of updated) {
      L.push(
        `- ${rec.member} ${rec.claim_ref}: ${diffs.map((d) => `${d.field} ${d.from || '(empty)'}→${d.to}`).join(', ')}`,
      );
    }
    L.push('');
  }
  const flagged = added.filter((r) => r.status === 'Partially Paid');
  if (flagged.length) {
    L.push('## Check before calling these shortfalls');
    for (const r of flagged) {
      L.push(
        `- ${r.member} ${r.claim_ref} (${r.provider}): claimed ${r.currency} ${r.claimed}; paid ${r.paid_currency} ${r.paid} — review the statement and invoice before treating any difference as an amount owed.`,
      );
    }
    L.push('');
  }
  if (watch.length) {
    L.push('## Watchlist');
    for (const w of watch) L.push(`- [${w.match}] ${w.result} — ${w.note}`);
    L.push('');
  }
  if (warnings.length) {
    L.push('## Parse warnings');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  return L.join('\n');
}
