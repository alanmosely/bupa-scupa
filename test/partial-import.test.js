import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Ajv from 'ajv';
import { API } from '../src/agent.js';
import { REF, OTHER, statement, convertedStatement, syntheticPdf } from './fixtures.js';
import { parseCsv, toCsv } from '../src/core/csv.js';
import { HEADERS } from '../src/core/model.js';
const validate = new Ajv({ strict: true }).compile(API.schemas.responses.parse);
const available = fs.existsSync('vendor/xpdf/pdftotext.exe');
if (process.env.SCUPA_REQUIRE_PDF_TESTS === '1') assert.ok(available);
function fixture() {
  fs.mkdirSync('.cache/tests', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('.cache/tests/partial-'));
  fs.writeFileSync(
    path.join(root, 'household.json'),
    JSON.stringify({
      schemaVersion: 1,
      baseUrl: 'https://membersworld.bupaglobal.com',
      members: {
        first: { displayName: 'Example Person', self: true },
        second: { displayName: 'Second Person' },
      },
      watchlist: [],
    }),
  );
  return root;
}
function pdf(root, member, ref, text) {
  const directory = path.join(root, 'raw', member, ref);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'statement_1_demo.pdf'), syntheticPdf(text));
}
function parse(root, args = []) {
  const result = spawnSync(
    process.execPath,
    ['src/agent.js', 'parse', '--data-dir', root, ...args],
    { encoding: 'utf8', windowsHide: true },
  );
  const value = JSON.parse(result.stdout);
  assert.ok(validate(value), JSON.stringify(validate.errors));
  return value;
}
test(
  'partial imports are schema-valid and unknown amounts do not block another member',
  { skip: !available },
  () => {
    const root = fixture();
    pdf(root, 'first', REF, statement());
    pdf(root, 'second', OTHER, statement({ ref: OTHER }).replace(/Total payment[^\n]+/, ''));
    const result = parse(root);
    assert.equal(result.ok, true);
    assert.equal(result.result.reviewRequired, 1);
    assert.equal(result.result.added, 2);
    assert.equal(result.result.changes.added.find((row) => row.claim_ref === REF).paid, '80.0');
    assert.equal(result.result.changes.added.find((row) => row.claim_ref === OTHER).paid, '');
    const master = path.join(root, 'master', 'claims.csv');
    const before = fs.readFileSync(master);
    const repeated = parse(root, ['--dry-run']);
    assert.equal(repeated.result.added, 0);
    assert.equal(repeated.result.updated, 0);
    assert.deepEqual(fs.readFileSync(master), before);
  },
);
test(
  'conflicting ownership still blocks the entire import even with deferred documents',
  { skip: !available },
  () => {
    const root = fixture();
    pdf(root, 'first', REF, statement());
    pdf(root, 'second', REF, statement().replace(/Total payment[^\n]+/, ''));
    const result = parse(root);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'PARSE_FAILED');
    assert.equal(fs.existsSync(path.join(root, 'master', 'claims.csv')), false);
  },
);

test('padded claim headings keep each invoice with its own claim', { skip: !available }, () => {
  const root = fixture();
  const second = statement({ ref: OTHER, claimed: '200.00', paid: '200.00' })
    .replace('For Claim', 'For  Claim')
    .replace('DEMO-1', 'DEMO-2');
  pdf(root, 'first', REF, statement({ paid: '100.00' }) + '\n' + second);
  const result = parse(root);
  assert.equal(result.ok, true);
  assert.equal(result.result.reviewRequired, 0);
  assert.deepEqual(
    result.result.changes.added.map(({ claim_ref, claimed, paid }) => ({
      claim_ref,
      claimed,
      paid,
    })),
    [
      { claim_ref: REF, claimed: '100.0', paid: '100.0' },
      { claim_ref: OTHER, claimed: '200.0', paid: '200.0' },
    ],
  );
});

test(
  'invalid claim headings defer the whole document before invoices can be combined',
  { skip: !available },
  () => {
    const root = fixture();
    const second = statement({ ref: OTHER, claimed: '200.00', paid: '200.00' })
      .replace(OTHER, OTHER + '9')
      .replace('DEMO-1', 'DEMO-2');
    pdf(root, 'first', REF, statement({ paid: '100.00' }) + '\n' + second);
    const result = parse(root);
    assert.equal(result.ok, true);
    assert.equal(result.result.reviewRequired, 1);
    assert.equal(result.result.changes.added[0].paid, '');
  },
);

test(
  'malformed claimed cells and conversion summaries defer only the affected claim',
  { skip: !available },
  () => {
    const texts = [
      ...['£100', '£100.00oops', '100,00', '100.005'].map((amount) =>
        statement().replace('£100.00    £80.00', `${amount}    £80.00`),
      ),
      ...[
        'Payment amount    GBP 64.005',
        'Payment   amount    GBP 64.005',
        'Payment amount    GBP €64.00',
      ].map((summary) => convertedStatement().replace('Payment amount    GBP 64.00', summary)),
    ];
    for (const text of texts) {
      const root = fixture();
      pdf(root, 'first', REF, text);
      pdf(root, 'second', OTHER, statement({ ref: OTHER }));
      const result = parse(root);
      assert.equal(result.ok, true);
      assert.equal(result.result.reviewRequired, 1);
      assert.equal(result.result.changes.added.find((row) => row.claim_ref === REF).paid, '');
      assert.equal(result.result.changes.added.find((row) => row.claim_ref === OTHER).paid, '80.0');
    }
  },
);

test(
  'missing assessed amounts and unknown master statuses block unrelated updates',
  { skip: !available },
  () => {
    for (const change of [{ paid: '' }, { claimed: '' }, { status: 'Unexpected status' }]) {
      const root = fixture();
      pdf(root, 'first', REF, statement());
      assert.equal(parse(root).ok, true);
      const master = path.join(root, 'master', 'claims.csv');
      const rows = parseCsv(fs.readFileSync(master, 'utf8'));
      const before = toCsv([{ ...rows[0], ...change }], HEADERS);
      fs.writeFileSync(master, before);
      pdf(root, 'second', OTHER, statement({ ref: OTHER }));
      assert.equal(parse(root).ok, false);
      assert.equal(fs.readFileSync(master, 'utf8'), before);
    }
  },
);

test(
  'linked raw and member directories block parsing before external PDFs are read',
  { skip: !available },
  () => {
    for (const level of ['raw', 'member', 'claim']) {
      const root = fixture();
      const external = fixture();
      pdf(external, 'first', REF, statement());
      const parts = level === 'raw' ? [] : level === 'member' ? ['first'] : ['first', REF];
      const destination = path.join(root, 'raw', ...parts);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.symlinkSync(
        path.join(external, 'raw', ...parts),
        destination,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const result = parse(root);
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'PARSE_FAILED');
      assert.equal(fs.existsSync(path.join(root, 'master', 'claims.csv')), false);
    }
  },
);
