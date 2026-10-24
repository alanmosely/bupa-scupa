import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REF, OTHER, statement, syntheticPdf } from './fixtures.js';
import { assessmentKey, assessmentReviewed, emptyFollowUp } from '../src/core/claims.js';

fs.mkdirSync('.cache/tests', { recursive: true });
process.env.SCUPA_DATA_DIR = fs.mkdtempSync(path.resolve('.cache/tests/reassessment-'));
process.env.SCUPA_PDFTOTEXT = path.resolve('vendor/xpdf/pdftotext.exe');
const pdfAvailable = fs.existsSync(process.env.SCUPA_PDFTOTEXT);
if (process.env.SCUPA_REQUIRE_PDF_TESTS === '1') assert.ok(pdfAvailable);
const service = await import('../src/core/service.js');
const util = await import('../src/core/util.js');
const { parseStatementText } = await import('../src/core/parse.js');
const { mergeRecords } = await import('../src/core/merge.js');
const { documentHash } = await import('../src/core/documents.js');
util.saveConfig({
  schemaVersion: 1,
  baseUrl: 'https://membersworld.bupaglobal.com',
  members: {
    demo: { displayName: 'Example Person', self: true },
    second: { displayName: 'Second Person' },
  },
  watchlist: [],
});

test('changed assessment reasons are reported, backed up and retained without repeat updates', () => {
  const directory = fs.mkdtempSync(path.join(util.DATA, 'reasons-'));
  const options = {
    masterPath: path.join(directory, 'claims.csv'),
    reportsDir: path.join(directory, 'reports'),
  };
  const original = parseStatementText(
    statement({ paid: '0.00', extra: 'We cannot pay because a referral is missing.' }),
    'demo',
  )[0];
  mergeRecords([original], options);
  const reviewed = { ...emptyFollowUp(), reviewed: true, assessmentKey: assessmentKey(original) };
  let previous = original.notes;
  for (const reason of [
    'We cannot pay because your annual allowance is exhausted.',
    'We cannot pay because the "referral" is missing. | Please provide it.',
    original.notes,
    '',
  ]) {
    const record = { ...original, notes: reason };
    const before = fs.readFileSync(options.masterPath);
    const preview = mergeRecords([record], { ...options, dryRun: true });
    assert.deepEqual(fs.readFileSync(options.masterPath), before);
    assert.deepEqual(preview.updated[0].diffs, [{ field: 'notes', from: previous, to: reason }]);
    const result = mergeRecords([record], options);
    assert.equal(result.updated.length, 1);
    assert.match(result.rows[0].notes, /a referral is missing/);
    assert.ok(result.rows[0].notes.endsWith(JSON.stringify(reason)));
    assert.equal(assessmentReviewed(result.rows[0], reviewed), false);
    const after = fs.readFileSync(options.masterPath);
    assert.equal(mergeRecords([record], options).updated.length, 0);
    assert.deepEqual(fs.readFileSync(options.masterPath), after);
    previous = reason;
  }
  assert.equal(fs.readdirSync(path.join(directory, 'backups')).length, 4);
});

test(
  'related multi-claim statements can be opened only with current bytes and real claim ownership',
  { skip: !pdfAvailable },
  () => {
    const directory = path.join(util.RAW, 'demo', REF);
    fs.mkdirSync(directory, { recursive: true });
    const name = 'statement_1_combined.pdf';
    const file = `demo/${REF}/${name}`;
    const absolute = path.join(directory, name);
    const body = syntheticPdf(statement() + '\n' + statement({ ref: OTHER, paid: '100.00' }));
    fs.writeFileSync(absolute, body);
    const current = path.join(directory, 'current.json');
    util.atomicWrite(current, JSON.stringify({ schemaVersion: 1, files: [name] }));
    service.reparse();
    const details = service.claimDetails({ claimRef: OTHER });
    assert.equal(details.row.paid, '100.0');
    assert.equal(details.documentError, '');
    assert.equal(details.documents.length, 1);
    const document = details.documents[0];
    assert.equal(document.kind, 'Related statement document');
    assert.equal(service.claimDocumentPath({ claimRef: OTHER, ...document }), absolute);
    const parsedBefore = fs.readFileSync(util.PARSED, 'utf8');
    fs.writeFileSync(absolute, syntheticPdf(statement({ ref: OTHER, paid: '50.00' })));
    assert.throws(
      () => service.claimDocumentPath({ claimRef: OTHER, ...document }),
      /PDF has changed/,
    );
    fs.writeFileSync(absolute, body);
    util.atomicWrite(current, JSON.stringify({ schemaVersion: 1, files: [] }));
    assert.throws(
      () => service.claimDocumentPath({ claimRef: OTHER, ...document }),
      /no longer current/,
    );
    util.atomicWrite(current, JSON.stringify({ schemaVersion: 1, files: [name] }));

    // An edited index must not invent a reference in an unrelated PDF.
    fs.writeFileSync(absolute, syntheticPdf(statement()));
    const forged = JSON.parse(parsedBefore);
    forged.documents[0].sha256 = documentHash(absolute);
    fs.writeFileSync(util.PARSED, JSON.stringify(forged));
    assert.throws(
      () => service.claimDocumentPath({ claimRef: OTHER, file, sha256: documentHash(absolute) }),
      /belonging to this claim/,
    );
    fs.writeFileSync(absolute, body);

    // Even a PDF mentioning the ref cannot be opened through another member.
    const foreignDir = path.join(util.RAW, 'second', REF);
    fs.mkdirSync(foreignDir, { recursive: true });
    const foreignFile = `second/${REF}/${name}`;
    fs.writeFileSync(path.join(foreignDir, name), body);
    const foreign = {
      file: foreignFile,
      sha256: documentHash(path.join(foreignDir, name)),
      claimRefs: [OTHER],
    };
    forged.documents = [foreign];
    fs.writeFileSync(util.PARSED, JSON.stringify(forged));
    assert.throws(
      () => service.claimDocumentPath({ claimRef: OTHER, ...foreign }),
      /belonging to this claim/,
    );
    fs.writeFileSync(util.PARSED, parsedBefore);
    assert.deepEqual(fs.readFileSync(absolute), body);
    assert.equal(service.claimDetails({ claimRef: OTHER }).documents.length, 1);
  },
);
