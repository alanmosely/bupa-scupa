import { spawnSync } from 'node:child_process';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  REF,
  OTHER,
  statement,
  convertedStatement,
  syntheticPdf,
  approveAssessment,
} from './fixtures.js';
fs.mkdirSync('.cache/tests', { recursive: true });
process.env.SCUPA_DATA_DIR = fs.mkdtempSync(path.resolve('.cache/tests/core-'));
const util = await import('../src/core/util.js');
const { parseStatementText, parseRawDir, pdfToText } = await import('../src/core/parse.js');
const { mergeRecords, loadMaster } = await import('../src/core/merge.js');
const { archivePdf, verifyMemberRefs, retry, resolveNavigationHref } =
  await import('../src/core/safety.js');
const {
  setup,
  acquireLock,
  spreadsheetCsv,
  exportCsv,
  reparse,
  updateHousehold,
  inspectLock,
  recoverLock,
  archiveHelp,
} = await import('../src/core/service.js');
const { parseCsv, toCsv } = await import('../src/core/csv.js');
const { uniqueMemberHref, selectClaims } = await import('../src/core/portal.js');
const pdfAvailable = fs.existsSync('vendor/xpdf/pdftotext.exe');
if (process.env.SCUPA_REQUIRE_PDF_TESTS === '1')
  assert.ok(
    pdfAvailable,
    'Provision the bundled PDF reader before the required extraction and cancellation tests.',
  );
let counter = 0;
const folder = () => {
  const p = path.join(util.DATA, 'case-' + ++counter);
  fs.mkdirSync(p);
  return p;
};
const opts = () => {
  const p = folder();
  return { masterPath: path.join(p, 'claims.csv'), reportsDir: path.join(p, 'reports') };
};
const record = (options) => parseStatementText(statement(options), 'test_member')[0];
beforeEach(() =>
  util.saveConfig({
    ...util.loadConfig(),
    members: {
      test_member: { displayName: 'Example Person', self: true },
      other_member: { displayName: 'Second Person' },
    },
    watchlist: [],
  }),
);

test('authoritative totals and partial payment', () => {
  const r = record();
  assert.equal(r.claimed, '100.0');
  assert.equal(r.paid, '80.0');
  assert.equal(r.status, 'Partially Paid');
  assert.equal(r.payment_date, '2000-01-02');
});
test('full payment, zero rejection and plan-rate exception', () => {
  assert.equal(record({ paid: '100.00' }).status, 'Paid in Full');
  assert.equal(record({ paid: '0.00' }).status, 'Rejected');
  assert.equal(
    record({ extra: 'Member is not liable to pay for the shortfall' }).status,
    'Paid at plan rate (member not liable for balance)',
  );
});
test('duplicate wording overrides apparent payment', () => {
  const r = record({ extra: "We won't pay this cost because we've reviewed it before" });
  assert.equal(r.paid, '0.0');
  assert.match(r.status, /^Duplicate/);
});
test('missing total refuses a master write', () => {
  const r = parseStatementText(statement().replace(/Total payment[^\n]+/, ''), 'test_member')[0];
  const o = opts();
  assert.throws(() => mergeRecords([r], o), /authoritative payment total/);
  assert.equal(fs.existsSync(o.masterPath), false);
});
test('multi-claim statements retain separate totals', () => {
  const rows = parseStatementText(
    statement() + '\n' + statement({ ref: OTHER, paid: '100.00' }),
    'test_member',
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].paid, '80.0');
  assert.equal(rows[1].paid, '100.0');
});

test('a single total row can contain multiple amount columns and a wrapped payee', () => {
  for (const total of [
    'Total payment made to you    £100.00    £20.00    £80.00',
    'Total payment made to your healthcare    £100.00    £20.00    £80.00\nprovider',
  ]) {
    const r = parseStatementText(
      statement().replace('Total payment made to you    £80.00', total),
      'test_member',
    )[0];
    assert.deepEqual(r.errors, []);
    assert.equal(r.paid, '80.0');
    assert.equal(r.paid_to, total.includes('healthcare') ? 'provider' : 'you');
    assert.equal(mergeRecords([r], opts()).added.length, 1);
  }
});
test('currency headers are honoured and uncertain currencies cannot merge', () => {
  const plain = statement().replaceAll('£', '');
  for (const code of ['GBP', 'EUR']) {
    const r = parseStatementText(`Currency: ${code}\n` + plain, 'test_member')[0];
    assert.equal(r.currency, code);
    assert.equal(r.warnings.length, 0);
  }
  for (const text of [
    plain,
    'Currency: USD\n' + plain,
    'Currency: BHD\n' + statement(),
    'Currency: EUR\n' + statement(),
    statement().replaceAll('£', '¥'),
  ]) {
    const r = parseStatementText(text, 'test_member')[0];
    const o = opts();
    assert.equal(r.currency, '');
    assert.ok(r.errors.some((error) => error.code.endsWith('_CURRENCY')));
    assert.throws(() => mergeRecords([r], o), /Invalid parsed/);
    assert.equal(fs.existsSync(o.masterPath), false);
  }
});
test('multi-claim documents determine currency per segment without mixing totals', () => {
  const rows = parseStatementText(
    statement() + '\n' + statement({ ref: OTHER }).replaceAll('£', '€'),
    'test_member',
  );
  assert.deepEqual(
    rows.map((r) => r.currency),
    ['GBP', 'EUR'],
  );
  const mixed = parseStatementText(
    convertedStatement() + '\n' + statement({ ref: OTHER, paid: '100.00' }),
    'test_member',
  );
  assert.deepEqual(
    mixed.map((r) => r.errors),
    [[], []],
  );
  assert.deepEqual(
    mixed.map((r) => [r.currency, r.paid_currency, r.claimed, r.paid]),
    [
      ['EUR', 'GBP', '100.0', '64.0'],
      ['GBP', 'GBP', '100.0', '100.0'],
    ],
  );
});
test('labelled conversions keep claim and payment currencies separate, including payment status', () => {
  for (const [from, to] of [
    ['EUR', 'GBP'],
    ['GBP', 'EUR'],
  ]) {
    for (const nonPayable of [true, false]) {
      const r = parseStatementText(convertedStatement({ from, to, nonPayable }), 'test_member')[0];
      assert.deepEqual(r.errors, []);
      assert.equal(r.currency, from);
      assert.equal(r.paid_currency, to);
      assert.equal(r.claimed, nonPayable ? '100.0' : '80.0');
      assert.equal(r.paid, '64.0');
      assert.equal(r.status, nonPayable ? 'Partially Paid' : 'Paid in Full');
      const o = opts();
      assert.equal(mergeRecords([r], o).added.length, 1);
      assert.equal(mergeRecords([r], o).updated.length, 0);
      const [saved] = loadMaster(o.masterPath);
      assert.equal(saved.paid_currency, to);
      const [exported] = parseCsv(spreadsheetCsv([saved]));
      assert.equal(exported.currency, from);
      assert.equal(exported.paid_currency, to);
    }
  }
});
test('conversion tables without a gross column and numerically equal currencies retain correct status', () => {
  const text = convertedStatement();
  const twoColumns = text
    .replace('                                          Amount excl.\n', '')
    .replace('tax/discount    ', '')
    .replace('                                          (EUR)\n', '')
    .replace('100.00    80.00    64.00', '80.00    64.00')
    .replace('20.00    20.00    16.00', '20.00    16.00');
  const simple = parseStatementText(twoColumns, 'test_member')[0];
  assert.deepEqual(simple.errors, []);
  assert.equal(simple.claimed, '100.0');
  assert.equal(simple.paid, '64.0');
  const equalNumbers = parseStatementText(
    text.replaceAll('64.00', '100.00').replaceAll('16.00', '25.00'),
    'test_member',
  )[0];
  assert.deepEqual(equalNumbers.errors, []);
  assert.equal(equalNumbers.claimed, equalNumbers.paid);
  assert.equal(equalNumbers.status, 'Partially Paid');
});
test('incomplete or conflicting conversion evidence preserves the master', () => {
  const text = convertedStatement();
  const original = record();
  for (const bad of [
    text.replace('Amount (EUR)    Amount (GBP)', 'Amount    Amount'),
    text.replace('100.00    80.00    64.00', '100.00    80.00'),
    text.replace('100.00    80.00    64.00', '100.00    £80.00    £64.00'),
    text.replace(
      'Total payment made to you    80.00    64.00',
      'Total payment made to you    £80.00    £64.00',
    ),
    text.replace(
      'Total payment made to you    80.00    64.00',
      'Total payment made to you    64.00',
    ),
    text.replace('Payment amount    GBP 64.00', 'Payment amount    GBP 99.00'),
    text.replace('Payment amount    GBP 64.00', 'Payment amount    EUR 64.00'),
    text.replaceAll('GBP', 'USD'),
    text.replaceAll('GBP', 'BHD'),
    text.replace(
      'Total payment made to you',
      'Treatment date    Benefit or deduction    Amount (GBP)    Amount (EUR)\nTotal payment made to you',
    ),
  ]) {
    const o = opts();
    mergeRecords([original], o);
    const before = fs.readFileSync(o.masterPath);
    const r = parseStatementText(bad, 'test_member')[0];
    assert.ok(r.errors.length, bad);
    assert.throws(() => mergeRecords([r], o), /Invalid parsed/);
    assert.deepEqual(fs.readFileSync(o.masterPath), before);
  }
});
test('legacy single-currency masters upgrade only on a successful write and retain a backup', () => {
  const o = opts();
  const legacyHeaders = util.HEADERS.filter((field) => field !== 'paid_currency');
  const before = toCsv([record()], legacyHeaders);
  fs.writeFileSync(o.masterPath, before);
  assert.equal(loadMaster(o.masterPath)[0].paid_currency, 'GBP');
  mergeRecords([record()], { ...o, dryRun: true });
  assert.equal(fs.readFileSync(o.masterPath, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(path.dirname(o.masterPath), 'backups')), false);
  const invalid = { ...record(), paid_currency: 'USD' };
  assert.throws(() => mergeRecords([invalid], o), /Invalid parsed/);
  assert.equal(fs.readFileSync(o.masterPath, 'utf8'), before);
  assert.throws(
    () => mergeRecords([{ ...record(), paid_currency: 'EUR' }], o),
    /payment currency changed/,
  );
  assert.equal(fs.readFileSync(o.masterPath, 'utf8'), before);
  mergeRecords([record()], o);
  assert.equal(fs.readFileSync(o.masterPath, 'utf8').split('\n')[0], util.HEADERS.join(','));
  const backups = path.join(path.dirname(o.masterPath), 'backups');
  assert.equal(fs.readdirSync(backups).length, 1);
  assert.equal(fs.readFileSync(path.join(backups, fs.readdirSync(backups)[0]), 'utf8'), before);
  mergeRecords([record()], o);
  assert.equal(fs.readdirSync(backups).length, 1);
});
test('unrecognised or conflicting header currency blocks archive parsing', () => {
  const raw = folder();
  const p = path.join(raw, 'test_member', REF);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, 'statement_1_demo.pdf'), 'fixture');
  for (const text of [
    'Currency: USD\n' + statement().replaceAll('£', ''),
    'Currency: EUR\n' + statement(),
  ]) {
    const result = parseRawDir({
      rawDir: raw,
      parsedPath: path.join(folder(), 'parsed.json'),
      extractText: () => text,
    });
    assert.ok(result.stats.errors.some((e) => e.includes('statement currency')));
  }
});
test('adjustment history is not added to current assessment', () => {
  const text =
    `For Claim ${REF}\n01/01/2000    Consultation    £90.00    £90.00\nTotal adjustment payment made to you £10.00\n` +
    statement().split('\n').slice(2).join('\n');
  const r = parseStatementText(text, 'test_member')[0];
  assert.equal(r.claimed, '100.0');
  assert.equal(r.paid, '80.0');
});
test('merge bootstraps and repeated input is idempotent', () => {
  const o = opts();
  assert.equal(mergeRecords([record()], o).added.length, 1);
  assert.equal(mergeRecords([record()], o).added.length, 0);
  assert.equal(loadMaster(o.masterPath).length, 1);
  assert.equal(fs.readdirSync(path.join(path.dirname(o.masterPath), 'backups')).length, 0);
});
test('reassessment backs up and advances payment date', () => {
  const o = opts();
  mergeRecords([record()], o);
  const r = mergeRecords([record({ paid: '100.00', date: '03/01/2000' })], o);
  assert.equal(r.updated.length, 1);
  assert.equal(loadMaster(o.masterPath)[0].payment_date, '2000-01-03');
  assert.equal(fs.readdirSync(path.join(path.dirname(o.masterPath), 'backups')).length, 1);
});

test('restored assessment keeps its payment date consistent with its amounts', () => {
  const o = opts();
  mergeRecords([record({ paid: '100.00', date: '03/01/2000' })], o);
  const result = mergeRecords([record()], o);
  assert.equal(result.updated.length, 1);
  const restored = loadMaster(o.masterPath)[0];
  assert.equal(restored.paid, '80.0');
  assert.equal(restored.payment_date, '2000-01-02');
  assert.equal(mergeRecords([record()], o).updated.length, 0);
});

test('reparse applies metadata corrections, preserves notes and is idempotent', () => {
  const o = opts();
  const original = { ...record(), notes: 'An existing audit note' };
  mergeRecords([original], o);
  const corrected = {
    ...original,
    provider: 'Corrected Example Clinic',
    treatment_date: '1999-12-31',
    benefit_categories: 'Dental treatment',
    is_dental: 'True',
  };
  const result = mergeRecords([corrected], o);
  assert.equal(result.updated.length, 1);
  for (const field of ['provider', 'treatment_date', 'benefit_categories', 'is_dental']) {
    assert.equal(result.rows[0][field], corrected[field]);
    assert.ok(result.updated[0].diffs.some((diff) => diff.field === field));
  }
  assert.match(result.rows[0].notes, /^An existing audit note \| reassessed/);
  const before = fs.readFileSync(o.masterPath);
  assert.equal(mergeRecords([corrected], o).updated.length, 0);
  assert.deepEqual(fs.readFileSync(o.masterPath), before);
  assert.equal(fs.readdirSync(path.join(path.dirname(o.masterPath), 'backups')).length, 1);
  mergeRecords([{ ...corrected, provider: '', treatment_date: '', benefit_categories: '' }], o);
  assert.deepEqual(fs.readFileSync(o.masterPath), before);
});

test('incomplete benefit rows block the whole batch without changing the master', () => {
  const raw = folder();
  const directory = path.join(raw, 'test_member', REF);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'statement_1_demo.pdf'), 'synthetic extractor input');
  const o = opts();
  mergeRecords([record()], o);
  const before = fs.readFileSync(o.masterPath);
  for (const row of [
    '01/01/2000 Dental treatment £50.00 £40.00',
    '01/01/2000    Dental treatment    £50.00 £40.00',
    '01/01/2000    Dental treatment',
    '1/1/2000    Dental treatment    £50.00    £40.00',
    '2000-01-01    Dental treatment    £50.00    £40.00',
    '01/01/2000    Dental treatment £50.00    £40.00',
  ]) {
    const text = statement().replace(
      'Total payment made to you    £80.00',
      row + '\nTotal payment made to you    £120.00',
    );
    const parsed = parseRawDir({
      rawDir: raw,
      parsedPath: path.join(folder(), 'parsed.json'),
      extractText: () => text,
    });
    assert.ok(parsed.stats.errors.some((error) => error.includes('UNPARSED_BENEFIT')));
    assert.ok(parsed.records[0].errors.some((error) => error.code === 'UNPARSED_BENEFIT'));
    // Wording is presentation only; neither warnings nor error prose control the gate.
    parsed.records[0].warnings = [];
    parsed.records[0].errors.forEach((error) => {
      error.message = 'Changed wording';
    });
    assert.throws(
      () => mergeRecords([record({ ref: OTHER }), ...parsed.records], o),
      /UNPARSED_BENEFIT/,
    );
    assert.deepEqual(fs.readFileSync(o.masterPath), before);
  }
});

test('valid multiple benefit rows retain every amount and category', () => {
  const text = statement().replace(
    'Total payment made to you    £80.00',
    '01/01/2000    Dental treatment    £50.00    £40.00\nTotal payment made to you    £120.00',
  );
  const r = parseStatementText(text, 'test_member')[0];
  assert.deepEqual(r.errors, []);
  assert.equal(r.claimed, '150.0');
  assert.equal(r.paid, '120.0');
  assert.equal(r.is_dental, 'True');
  assert.equal(mergeRecords([r], opts()).added.length, 1);
});

test('ambiguous totals cannot write even when a duplicate overrides payment', () => {
  const o = opts();
  for (const text of [
    statement() + '\nTotal payment made to your healthcare provider    £20.00',
    'Total payment made to you    £80.00\n' + statement(),
    statement({ extra: "We won't pay this cost because we've reviewed it before" }) +
      '\nTotal payment made to you    £0.00',
  ]) {
    const r = parseStatementText(text, 'test_member')[0];
    assert.ok(r.errors.some((error) => error.code === 'AMBIGUOUS_PAYMENT_TOTAL'));
    assert.throws(() => mergeRecords([r], o), /AMBIGUOUS_PAYMENT_TOTAL/);
    assert.equal(fs.existsSync(o.masterPath), false);
  }
});
test('wrong owner and changed currency cannot overwrite master', () => {
  const o = opts();
  mergeRecords([record()], o);
  const before = fs.readFileSync(o.masterPath);
  assert.throws(() => mergeRecords([{ ...record(), member: 'other_member' }], o), /belongs to/);
  assert.throws(() => mergeRecords([{ ...record(), currency: 'EUR' }], o), /currency changed/);
  assert.deepEqual(fs.readFileSync(o.masterPath), before);
});
test('dry run does not create master', () => {
  const o = opts();
  const result = mergeRecords([record()], { ...o, dryRun: true });
  assert.equal(result.added.length, 1);
  assert.equal(fs.existsSync(o.masterPath), false);
});
test('stub never downgrades paid assessment', () => {
  const o = opts();
  mergeRecords([record()], o);
  mergeRecords(
    [
      {
        ...record(),
        stub: true,
        claimed: '',
        paid: '',
        status: 'No statement in portal (unassessed?)',
      },
    ],
    o,
  );
  assert.equal(loadMaster(o.masterPath)[0].paid, '80.0');
});
test('invalid amounts and duplicate master rows fail closed', () => {
  const o = opts();
  assert.throws(() => mergeRecords([{ ...record(), paid: 'NaN' }], o), /Invalid parsed/);
  fs.writeFileSync(o.masterPath, toCsv([record(), record()], util.HEADERS));
  assert.throws(() => mergeRecords([], o), /duplicate master/);
});
test('CSV round trips quotes, commas and newlines and rejects malformed rows', () => {
  const r = { first: 'a,"b"\nc', second: 'x' };
  assert.deepEqual(parseCsv(toCsv([r], ['first', 'second'])), [r]);
  assert.throws(() => parseCsv('a,b\n"unclosed'), /Unterminated/);
  assert.throws(() => parseCsv('a,b\nonlyone\n'), /field count/);
});
test('export neutralises spreadsheet formulas without changing canonical rows', () => {
  const r = { ...record(), provider: '  =HYPERLINK("example")' };
  assert.match(spreadsheetCsv([r]), /' {2}=HYPERLINK/);
  assert.equal(r.provider.startsWith('  ='), true);
  assert.throws(() => exportCsv(util.MASTER), /outside/);
});
test('PDF revisions preserve original and identical-download modification time', () => {
  const p = folder();
  const a = syntheticPdf(statement());
  const b = syntheticPdf(statement({ paid: '100.00' }));
  const file = archivePdf(p, 'statement_1_demo.pdf', a);
  const modified = fs.statSync(path.join(p, file)).mtimeMs;
  assert.equal(archivePdf(p, file, a), file);
  assert.equal(fs.statSync(path.join(p, file)).mtimeMs, modified);
  assert.match(archivePdf(p, file, b), /revision/);
  assert.deepEqual(fs.readFileSync(path.join(p, file)), a);
  assert.throws(() => archivePdf(p, file, Buffer.from('<html>Login</html>')), /not a complete PDF/);
});
test(
  'current PDF selection follows restored revisions without changing archived files',
  { skip: !pdfAvailable },
  () => {
    process.env.SCUPA_PDFTOTEXT = path.resolve('vendor/xpdf/pdftotext.exe');
    const raw = folder();
    const directory = path.join(raw, 'test_member', REF);
    fs.mkdirSync(directory, { recursive: true });
    const o = opts();
    const a = syntheticPdf(statement());
    const b = syntheticPdf(statement({ paid: '100.00' }));
    const parse = () => parseRawDir({ rawDir: raw, parsedPath: path.join(raw, 'parsed.json') });
    const files = new Map();
    for (const [body, paid] of [
      [a, '80.0'],
      [b, '100.0'],
      [a, '80.0'],
      [b, '100.0'],
    ]) {
      const file = archivePdf(directory, 'statement_1_demo.pdf', body);
      if (!files.has(file)) {
        const date = new Date(body === a ? '2000-01-01' : '2000-01-03');
        fs.utimesSync(path.join(directory, file), date, date);
        files.set(file, body);
      }
      util.atomicWrite(
        path.join(directory, 'current.json'),
        JSON.stringify({ schemaVersion: 1, files: [file] }),
      );
      approveAssessment(directory, file);
      const parsed = parse();
      assert.deepEqual(parsed.stats.errors, []);
      assert.equal(parsed.records[0].paid, paid);
      mergeRecords(parsed.records, o);
      assert.equal(loadMaster(o.masterPath)[0].paid, paid);
      const before = fs.readFileSync(o.masterPath);
      assert.equal(mergeRecords(parse().records, o).updated.length, 0);
      assert.deepEqual(fs.readFileSync(o.masterPath), before);
    }
    assert.equal(files.size, 2);
    for (const [file, body] of files) {
      assert.deepEqual(fs.readFileSync(path.join(directory, file)), body);
      assert.equal(
        fs.statSync(path.join(directory, file)).mtimeMs,
        Date.parse(body === a ? '2000-01-01' : '2000-01-03'),
      );
    }
  },
);

test('invalid current-file metadata blocks parsing instead of falling back to history', () => {
  const raw = folder();
  const directory = path.join(raw, 'test_member', REF);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'statement_1_demo.pdf'), 'synthetic');
  for (const content of [
    '{broken',
    JSON.stringify({ schemaVersion: 2, files: [] }),
    JSON.stringify({ schemaVersion: 1, files: ['missing.pdf'] }),
    JSON.stringify({ schemaVersion: 1, files: ['../statement_1_demo.pdf'] }),
    JSON.stringify({ schemaVersion: 1, files: ['statement_1_demo.pdf', 'statement_1_demo.pdf'] }),
  ]) {
    fs.writeFileSync(path.join(directory, 'current.json'), content);
    const parsed = parseRawDir({
      rawDir: raw,
      parsedPath: path.join(raw, 'parsed.json'),
      extractText: () => {
        throw new Error('Must not fall back to historical PDFs');
      },
    });
    assert.equal(parsed.records.length, 0);
    assert.equal(parsed.stats.errors.length, 1);
    assert.match(parsed.stats.errors[0], /current\.json/);
  }
});

test('full refresh includes older assessed claims while normal sync retains its overlap and stubs', () => {
  const claims = [REF, OTHER].map((claimId) => ({ claimId, recievedDate: '01/01/2000' }));
  // Both synthetic references predate this incremental cutoff.
  assert.deepEqual(selectClaims(claims, '000201', new Set([OTHER])), [claims[1]]);
  assert.deepEqual(selectClaims(claims, '000201', new Set([OTHER]), true), claims);
  assert.deepEqual(selectClaims(claims, '000101'), claims);
  assert.deepEqual(selectClaims([], '000201', new Set(), true), []);
});

test('member verification refuses foreign and unknown known-member lists', () => {
  const sets = { test_member: new Set([REF]), other_member: new Set([OTHER]) };
  assert.equal(verifyMemberRefs('test_member', [REF], sets), true);
  assert.throws(() => verifyMemberRefs('test_member', [REF, OTHER], sets), /known refs/);
  assert.throws(() => verifyMemberRefs('test_member', [], sets), /no known/);
  assert.equal(verifyMemberRefs('new_member', [], sets), false);
});
test('navigation is same-origin and tolerates UK spelling and locale prefix', () => {
  assert.equal(
    resolveNavigationHref(
      [{ href: '/en/plan/dependants', text: 'Your dependants overview' }],
      '/plan/dependants',
      'https://membersworld.bupaglobal.com',
    ),
    '/en/plan/dependants',
  );
  assert.equal(
    resolveNavigationHref(
      [{ href: 'https://evil.example/plan', text: 'Manage plan' }],
      '/plan',
      'https://membersworld.bupaglobal.com',
    ),
    null,
  );
});
test('exact member links reject ambiguous and substring matches', () => {
  const links = [
    { href: '/member/1', text: 'Example Person' },
    { href: '/member/2', text: 'Example Person Junior' },
  ];
  assert.match(uniqueMemberHref(links, 'Example Person'), /member\/1$/);
  assert.throws(
    () =>
      uniqueMemberHref([...links, { href: '/member/3', text: 'Example Person' }], 'Example Person'),
    /uniquely/,
  );
  assert.throws(() => uniqueMemberHref(links, 'Example'), /uniquely/);
  const card = {
    href: '/en/plan?memberid=synthetic',
    text: 'Second Person (Partner) View plan',
    memberCardTitle: 'Second Person (Partner)',
  };
  assert.match(uniqueMemberHref([card], 'Second Person'), /memberid=synthetic$/);
  assert.throws(() => uniqueMemberHref([card], 'Second'), /uniquely/);
  assert.throws(
    () => uniqueMemberHref([card, { ...card, href: '/en/plan?memberid=other' }], 'Second Person'),
    /uniquely/,
  );
});
test('exclusive operation lock prevents simultaneous writes', () => {
  const release = acquireLock();
  assert.throws(acquireLock, (e) => e.code === 'BUSY');
  release();
  const again = acquireLock();
  again();
});
test('setup refuses changing an existing household', () => {
  assert.throws(
    () => setup(['Example Person']),
    (e) => e.code === 'ALREADY_CONFIGURED',
  );
});
test('retries stop for permanent errors', async () => {
  let calls = 0;
  await assert.rejects(() =>
    retry(
      () => {
        calls++;
        throw Object.assign(new Error('Permanent'), { retryable: false });
      },
      { delayMs: 1 },
    ),
  );
  assert.equal(calls, 1);
});
test('parser recognises supporting document titles but blocks scans and broken statements', () => {
  const raw = folder();
  const p = path.join(raw, 'test_member', REF);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, 'statement_1_document.pdf'), 'fixture');
  for (const text of [
    'Invoice number DEMO-1\nInvoice total 100.00',
    'Example Clinic    Tax Invoice # DEMO-1\nTotal £100.00',
    'Invoice\nService    Qty    Unit Price\nConsultation    1    £100.00',
    'Example Supplier    INVOICE\nTotal (GBP) 100.00',
    'RECEIPT\nTotal amount received with thanks: £100',
    'Order Details\nOrder Summary\nGrand Total: £100.00',
    'Example Shop\nOrder summary\nTotal £100.00',
  ]) {
    const supporting = parseRawDir({
      rawDir: raw,
      parsedPath: path.join(folder(), 'parsed.json'),
      extractText: () => text,
    });
    assert.equal(supporting.stats.errors.length, 0, text);
    assert.equal(supporting.records[0].stub, true);
  }
  for (const text of [
    '\f',
    'Please upload your invoice for assessment.',
    'Claim statement\nInvoice total £100.00',
    'For Claim\nOrder summary\nTotal £100.00',
    `For Claim ${REF}\nTotal payment made to you £0.00`,
  ]) {
    const broken = parseRawDir({
      rawDir: raw,
      parsedPath: path.join(folder(), 'parsed.json'),
      extractText: () => text,
    });
    assert.ok(broken.stats.errors.length, text);
  }
});
test('real bundled PDF extraction preserves table amounts', { skip: !pdfAvailable }, () => {
  const p = path.join(folder(), 'synthetic.pdf');
  fs.writeFileSync(p, syntheticPdf(statement()));
  const text = pdfToText(path.resolve('vendor/xpdf/pdftotext.exe'), p);
  const r = parseStatementText(text, 'test_member')[0];
  assert.ok(r);
  assert.equal(r.claimed, '100.0');
  assert.equal(r.paid, '80.0');
  assert.equal(r.warnings.length, 0);
});
test('cancellation after extraction blocks the master merge', { skip: !pdfAvailable }, () => {
  process.env.SCUPA_PDFTOTEXT = path.resolve('vendor/xpdf/pdftotext.exe');
  const directory = path.join(util.RAW, 'test_member', REF);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'statement_1_demo.pdf'), syntheticPdf(statement()));
  approveAssessment(directory, 'statement_1_demo.pdf');
  mergeRecords([record()], { masterPath: util.MASTER, reportsDir: util.REPORTS });
  const before = fs.readFileSync(util.MASTER);
  let steps = 0;
  assert.throws(
    () =>
      reparse({
        checkCancelled: () => {
          if (++steps >= 5) throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' });
        },
      }),
    (e) => e.code === 'CANCELLED',
  );
  assert.deepEqual(fs.readFileSync(util.MASTER), before);
});

test(
  'unsafe PDF totals keep the master intact and persist useful diagnostics',
  { skip: !pdfAvailable },
  () => {
    process.env.SCUPA_PDFTOTEXT = path.resolve('vendor/xpdf/pdftotext.exe');
    const directory = path.join(util.RAW, 'test_member', REF);
    fs.mkdirSync(directory, { recursive: true });
    const pdf = syntheticPdf(
      statement() + '\nTotal payment made to your healthcare provider    £20.00',
    );
    const file = path.join(directory, 'statement_1_demo.pdf');
    fs.writeFileSync(file, pdf);
    const before = fs.readFileSync(util.MASTER);
    for (const dryRun of [true, false]) {
      assert.throws(
        () => reparse({ dryRun }),
        (error) => error.code === 'PARSE_FAILED',
      );
      assert.deepEqual(fs.readFileSync(util.MASTER), before);
      assert.deepEqual(fs.readFileSync(file), pdf);
      assert.ok(archiveHelp().issues.some((issue) => issue.includes('AMBIGUOUS_PAYMENT_TOTAL')));
    }
  },
);

test('name corrections preserve IDs and master data, back up config and require confirmation', () => {
  const before = util.loadConfig();
  const master = fs.existsSync(util.MASTER) ? fs.readFileSync(util.MASTER) : null;
  updateHousehold([
    { id: 'test_member', displayName: 'Corrected Example' },
    { id: 'other_member', displayName: 'Second Person' },
  ]);
  const after = util.loadConfig();
  assert.deepEqual(Object.keys(after.members), Object.keys(before.members));
  assert.equal(after.members.test_member.self, true);
  assert.equal(after.members.test_member.needsConfirmation, true);
  assert.equal(after.members.other_member.needsConfirmation, undefined);
  const backups = fs.readdirSync(path.join(util.DATA, 'household-backups'));
  assert.ok(
    backups.some((file) =>
      fs
        .readFileSync(path.join(util.DATA, 'household-backups', file), 'utf8')
        .includes('Example Person'),
    ),
  );
  if (master) assert.deepEqual(fs.readFileSync(util.MASTER), master);
  for (const edits of [
    [],
    [
      { id: 'new_member', displayName: 'New Person' },
      { id: 'other_member', displayName: 'Second Person' },
    ],
    [
      { id: 'test_member', displayName: 'Same' },
      { id: 'other_member', displayName: 'Same' },
    ],
  ]) {
    assert.throws(
      () => updateHousehold(edits),
      (error) => error.code === 'INVALID_INPUT',
    );
    assert.deepEqual(util.loadConfig(), after);
  }
});
test('recovery refuses active, malformed and guarded locks but releases a dead process lock', () => {
  const lock = path.join(util.DATA, '.scupa-lock');
  const guard = path.join(util.DATA, '.scupa-recovery');
  const release = acquireLock();
  assert.equal(inspectLock().state, 'active');
  assert.throws(recoverLock, (error) => error.code === 'BUSY');
  assert.equal(fs.existsSync(lock), true);
  release();
  fs.writeFileSync(lock, '{}');
  assert.equal(inspectLock().recoverable, false);
  assert.throws(recoverLock, (error) => error.code === 'BUSY');
  fs.writeFileSync(guard, 'interrupted recovery');
  assert.throws(acquireLock, (error) => error.code === 'BUSY');
  assert.throws(recoverLock, (error) => error.code === 'BUSY');
  fs.unlinkSync(guard);
  const child = spawnSync(process.execPath, ['-e', ''], { windowsHide: true });
  assert.equal(child.status, 0);
  fs.writeFileSync(lock, JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString() }));
  assert.equal(inspectLock().state, 'stale');
  const rawBefore = fs.readdirSync(util.RAW);
  assert.deepEqual(recoverLock(), { recovered: true });
  assert.equal(fs.existsSync(lock), false);
  assert.deepEqual(fs.readdirSync(util.RAW), rawBefore);
  assert.equal(archiveHelp().lock.state, 'unlocked');
});
