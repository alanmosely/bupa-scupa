import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  queryClaims,
  emptyFollowUp,
  attentionReasons,
  assessmentKey,
  validateQuery,
} from '../src/core/claims.js';
import { HEADERS, CLAIM_STATUS } from '../src/core/model.js';
import { toCsv, parseCsv } from '../src/core/csv.js';
import { REF, OTHER, syntheticPdf, statement } from './fixtures.js';

fs.mkdirSync('.cache/tests', { recursive: true });
process.env.SCUPA_DATA_DIR = fs.mkdtempSync(path.resolve('.cache/tests/claims-'));
const service = await import('../src/core/service.js');
const { parseStatementText } = await import('../src/core/parse.js');
const util = await import('../src/core/util.js');
const merge = await import('../src/core/merge.js');
util.saveConfig({
  schemaVersion: 1,
  baseUrl: 'https://membersworld.bupaglobal.com',
  members: {
    demo: { displayName: 'Example Person', self: true },
    second: { displayName: 'Second Person' },
  },
  watchlist: [],
});
const row = (overrides = {}) => ({
  ...Object.fromEntries(HEADERS.map((key) => [key, ''])),
  member: 'demo',
  claim_ref: REF,
  received_date: '2000-01-01',
  treatment_date: '2000-01-02',
  payment_date: '2000-01-03',
  provider: 'Example Clinic',
  invoice: 'DEMO-1',
  currency: 'GBP',
  paid_currency: 'GBP',
  claimed: '100.0',
  paid: '80.0',
  status: CLAIM_STATUS.partial,
  ...overrides,
});
const rows = [
  row(),
  row({
    claim_ref: OTHER,
    member: 'second',
    provider: 'Other Clinic',
    status: CLAIM_STATUS.paid,
    paid: '100.0',
    received_date: '2000-02-01',
    treatment_date: '',
  }),
];
util.atomicWrite(util.MASTER, toCsv(rows, HEADERS));

test('date basis, missing dates, member search, provider and sort share one query', () => {
  assert.deepEqual(
    queryClaims(rows, { from: '2000-01-01', to: '2000-01-02', dateField: 'treatment_date' }).map(
      (r) => r.claim_ref,
    ),
    [REF],
  );
  assert.equal(
    queryClaims(rows, { search: 'Second Person' }, {}, util.loadConfig().members)[0].claim_ref,
    OTHER,
  );
  assert.equal(queryClaims(rows, { provider: 'Example Clinic', status: 'partial' }).length, 1);
  assert.deepEqual(
    queryClaims(rows, { sort: 'paid', direction: 'desc' }).map((r) => r.paid),
    ['100.0', '80.0'],
  );
  for (const query of [
    { from: '2000-02-30' },
    { from: '2000-03-01', to: '2000-01-01' },
    { sort: '__proto__' },
    { file: '../master.csv' },
  ])
    assert.throws(() => validateQuery(query));
});
test('attention distinguishes assessment review, age, due dates and reassessments', () => {
  const pending = row({ status: CLAIM_STATUS.awaiting });
  assert.deepEqual(attentionReasons(pending, emptyFollowUp(), '2000-01-06'), [
    'Awaiting statement · 5 days',
  ]);
  const reviewed = { ...emptyFollowUp(), reviewed: true, assessmentKey: assessmentKey(rows[0]) };
  assert.deepEqual(attentionReasons(rows[0], reviewed), []);
  assert.match(attentionReasons(row({ paid: '50.0' }), reviewed)[0], /review invoice/);
  assert.deepEqual(
    attentionReasons(
      rows[1],
      { ...emptyFollowUp(), followUpOn: '2000-01-01', pinned: true },
      '2000-01-06',
    ),
    ['Follow-up due', 'Pinned'],
  );
  assert.equal(queryClaims(rows, { view: 'attention' }).length, 1);
});

test('amount sorting breaks ties consistently for claims with missing amounts', () => {
  const missing = [OTHER, REF].map((claim_ref) =>
    row({ claim_ref, claimed: '', paid: '', currency: '', paid_currency: '' }),
  );
  for (const sort of ['claimed', 'paid'])
    for (const direction of ['asc', 'desc'])
      assert.deepEqual(
        queryClaims(missing, { sort, direction }).map((claim) => claim.claim_ref),
        [REF, OTHER].sort(),
      );
});
test('personal notes persist without changing the master or its CSV export', () => {
  const masterBefore = fs.readFileSync(util.MASTER);
  const followUp = {
    ...emptyFollowUp(),
    notes: '<b>Called Bupa</b>',
    chasedOn: '2000-01-06',
    reviewed: true,
    assessmentKey: service.claimDetails({ claimRef: REF }).followUp.assessmentKey,
  };
  const release = service.acquireLock();
  try {
    service.updateFollowUp({ claimRef: REF, followUp });
  } finally {
    release();
  }
  assert.deepEqual(fs.readFileSync(util.MASTER), masterBefore);
  assert.equal(service.claimDetails({ claimRef: REF }).followUp.notes, '<b>Called Bupa</b>');
  assert.equal(service.claimDetails({ claimRef: REF }).followUp.reviewed, true);
  const exported = path.join(path.dirname(util.DATA), path.basename(util.DATA) + '-filtered.csv');
  assert.equal(service.exportCsv(exported, { provider: 'Example Clinic' }).rows, 1);
  assert.equal(parseCsv(fs.readFileSync(exported, 'utf8'))[0].claim_ref, REF);
  assert.doesNotMatch(fs.readFileSync(exported, 'utf8'), /Called Bupa/);
  assert.throws(
    () => service.updateFollowUp({ claimRef: 'CL000101999999', followUp }),
    /Choose a claim/,
  );
  assert.throws(
    () => service.updateFollowUp({ claimRef: REF, followUp: { ...followUp, chasedOn: 'bad' } }),
    /valid follow-up/,
  );
});

test('an older claim drawer cannot mark a changed assessment reviewed', () => {
  const masterBefore = fs.readFileSync(util.MASTER);
  const workspaceFile = path.join(util.DATA, 'workspace.json');
  const workspaceBefore = fs.readFileSync(workspaceFile);
  const old = service.claimDetails({ claimRef: REF });
  const changed = rows.map((claim) =>
    claim.claim_ref === REF ? { ...claim, paid: '50.0' } : claim,
  );
  util.atomicWrite(util.MASTER, toCsv(changed, HEADERS));
  const release = service.acquireLock();
  try {
    assert.throws(
      () =>
        service.updateFollowUp({ claimRef: REF, followUp: { ...old.followUp, reviewed: true } }),
      /assessment has changed/,
    );
    assert.deepEqual(fs.readFileSync(workspaceFile), workspaceBefore);
    const current = service.claimDetails({ claimRef: REF });
    assert.equal(current.followUp.reviewed, false);
    service.updateFollowUp({ claimRef: REF, followUp: { ...current.followUp, reviewed: true } });
    assert.equal(service.claimDetails({ claimRef: REF }).followUp.reviewed, true);
  } finally {
    release();
    fs.writeFileSync(util.MASTER, masterBefore);
    fs.writeFileSync(workspaceFile, workspaceBefore);
  }
});
test('saved views persist and can be removed without changing assessments', () => {
  const query = { view: 'attention', status: 'partial', sort: 'provider', direction: 'asc' };
  const release = service.acquireLock();
  try {
    const saved = service.saveClaimView({ name: 'My checks', query }).workspace.savedViews.at(-1);
    assert.deepEqual(service.snapshot().workspace.savedViews.at(-1).query, query);
    service.removeClaimView({ id: saved.id });
    assert.equal(service.snapshot().workspace.savedViews.length, 0);
  } finally {
    release();
  }
});
test('claim document links stay within ownership, current files and unchanged content', () => {
  const directory = path.join(util.RAW, 'demo', REF);
  fs.mkdirSync(directory, { recursive: true });
  const filename = 'supporting_1_invoice.pdf';
  fs.writeFileSync(path.join(directory, filename), syntheticPdf('Synthetic provider invoice'));
  fs.writeFileSync(path.join(directory, 'statement_1_old.pdf'), syntheticPdf(statement()));
  fs.writeFileSync(
    path.join(directory, 'current.json'),
    JSON.stringify({ schemaVersion: 1, files: [filename] }),
  );
  const details = service.claimDetails({ claimRef: REF });
  assert.equal(details.documents.length, 1);
  const document = details.documents[0];
  assert.equal(
    service.claimDocumentPath({ claimRef: REF, ...document }),
    path.join(directory, filename),
  );
  assert.throws(
    () => service.claimDocumentPath({ claimRef: OTHER, ...document }),
    /belonging to this claim/,
  );
  assert.throws(() =>
    service.claimDocumentPath({ claimRef: REF, ...document, file: `demo/${REF}/../claims.csv` }),
  );
  fs.writeFileSync(path.join(directory, filename), syntheticPdf('Changed provider invoice'));
  assert.throws(() => service.claimDocumentPath({ claimRef: REF, ...document }), /PDF has changed/);
  assert.throws(() => service.reviewedDocumentPath(document), /Archive help/);
});
test('older CSV headers load without mutation and invoice metadata survives migration', () => {
  const file = path.join(util.DATA, 'legacy.csv');
  const oldHeaders = HEADERS.filter((header) => header !== 'invoice');
  fs.writeFileSync(file, toCsv(rows, oldHeaders));
  const before = fs.readFileSync(file);
  assert.equal(merge.loadMaster(file)[0].invoice, '');
  assert.deepEqual(fs.readFileSync(file), before);
  const previewHeaders = oldHeaders.filter((header) => header !== 'paid_currency');
  fs.writeFileSync(file, toCsv(rows, previewHeaders));
  assert.equal(merge.loadMaster(file)[0].paid_currency, 'GBP');
  const record = parseStatementText(statement(), 'demo')[0];
  const options = { masterPath: file, reportsDir: path.join(util.DATA, 'migration-reports') };
  merge.mergeRecords([record], options);
  assert.equal(merge.loadMaster(file)[0].invoice, 'DEMO-1');
  const backups = path.join(path.dirname(file), 'backups');
  assert.equal(fs.readdirSync(backups).length, 1);
  assert.equal(merge.mergeRecords([record], options).updated.length, 0);
  assert.equal(fs.readdirSync(backups).length, 1);
});
test('unreadable personal workspace refuses replacement and preserves assessments', () => {
  const file = path.join(util.DATA, 'workspace.json');
  const before = fs.readFileSync(file);
  const masterBefore = fs.readFileSync(util.MASTER);
  const corrupt = '{"schemaVersion":999,"followUps":{}}';
  fs.writeFileSync(file, corrupt);
  try {
    assert.throws(
      () => service.updateFollowUp({ claimRef: REF, followUp: emptyFollowUp() }),
      /Invalid workspace/,
    );
    assert.equal(fs.readFileSync(file, 'utf8'), corrupt);
    assert.deepEqual(fs.readFileSync(util.MASTER), masterBefore);
  } finally {
    fs.writeFileSync(file, before);
  }
});
