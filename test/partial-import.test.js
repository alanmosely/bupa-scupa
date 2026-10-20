import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Ajv from 'ajv';
import { API } from '../src/agent.js';
import { REF, OTHER, statement, syntheticPdf } from './fixtures.js';
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
