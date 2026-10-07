import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { REF, statement, syntheticPdf } from './fixtures.js';

fs.mkdirSync('.cache/tests', { recursive: true });
process.env.SCUPA_DATA_DIR = fs.mkdtempSync(path.resolve('.cache/tests/documents-'));
process.env.SCUPA_PDFTOTEXT = path.resolve('vendor/xpdf/pdftotext.exe');
const pdfAvailable = fs.existsSync(process.env.SCUPA_PDFTOTEXT);
if (process.env.SCUPA_REQUIRE_PDF_TESTS === '1') assert.ok(pdfAvailable);
const service = await import('../src/core/service.js');
const { DATA, RAW, MASTER, saveConfig } = await import('../src/core/util.js');
const { BUPA_ORIGIN } = await import('../src/core/model.js');
const { documentHash, resolveDocument } = await import('../src/core/documents.js');
const directory = path.join(RAW, 'demo', REF);
fs.mkdirSync(directory, { recursive: true });
const file = `demo/${REF}/statement_2_scan.pdf`;
const scan = path.join(RAW, file);
const reviews = path.join(directory, 'document-reviews.json');
const current = path.join(directory, 'current.json');
const blank = syntheticPdf('');
const saveCurrent = (files) =>
  fs.writeFileSync(current, JSON.stringify({ schemaVersion: 1, files }));
const decision = (supporting = true) => ({ file, sha256: documentHash(scan), supporting });
const review = (options) => {
  const release = service.acquireLock();
  try {
    service.reviewSupportingDocument(options);
  } finally {
    release();
  }
};
beforeEach(() => {
  saveConfig({
    schemaVersion: 1,
    baseUrl: BUPA_ORIGIN,
    members: { demo: { displayName: 'Example Person', self: true } },
    watchlist: [],
  });
  fs.writeFileSync(path.join(directory, 'statement_1_demo.pdf'), syntheticPdf(statement()));
  fs.writeFileSync(scan, blank);
  fs.writeFileSync(reviews, JSON.stringify({ schemaVersion: 1, supporting: {} }));
  saveCurrent(['statement_1_demo.pdf', 'statement_2_scan.pdf']);
});

test(
  'reviewed scans preserve PDFs and amounts, work offline, and can be undone',
  { skip: !pdfAvailable },
  () => {
    assert.throws(
      () => service.reparse(),
      (error) => error.code === 'PARSE_FAILED',
    );
    const [document] = service.archiveHelp().documents;
    assert.deepEqual(document, { file, sha256: documentHash(scan), supporting: false });
    assert.equal(service.reviewedDocumentPath(document), scan);
    review(decision());
    assert.equal(service.archiveHelp().documents[0].supporting, true);
    assert.deepEqual(fs.readFileSync(scan), blank);
    assert.deepEqual(service.reparse().parsed.errors, []);
    assert.equal(service.snapshot().rows[0].paid, '80.0');
    assert.equal(service.reparse().updated, 0);
    const master = fs.readFileSync(MASTER);
    review(decision(false));
    assert.throws(
      () => service.reparse(),
      (error) => error.code === 'PARSE_FAILED',
    );
    assert.deepEqual(fs.readFileSync(MASTER), master);
    review(decision());
    // A supporting scan on its own does not create a zero-value assessment.
    saveCurrent(['statement_2_scan.pdf']);
    assert.equal(service.reparse({ dryRun: true }).parsed.stubs, 1);
    assert.deepEqual(fs.readFileSync(MASTER), master);
  },
);

test(
  'review decisions never carry over to changed bytes or another filename',
  { skip: !pdfAvailable },
  () => {
    const original = decision();
    review(original);
    const changed = Buffer.concat([blank, Buffer.from('\n% changed scan\n')]);
    fs.writeFileSync(scan, changed);
    assert.throws(() => service.reviewedDocumentPath(original), /changed/);
    assert.throws(() => review(original), /changed/);
    assert.throws(
      () => service.reparse(),
      (error) => error.code === 'PARSE_FAILED',
    );
    assert.equal(service.archiveHelp().documents[0].supporting, false);
    fs.writeFileSync(path.join(directory, 'statement_2_scan__revision_demo.pdf'), blank);
    saveCurrent(['statement_1_demo.pdf', 'statement_2_scan__revision_demo.pdf']);
    assert.throws(
      () => service.reparse(),
      (error) => error.code === 'PARSE_FAILED',
    );
    assert.throws(() => review(decision()), /no longer current/);
  },
);

test(
  'readable statements, extraction failures, invalid reviews and arbitrary paths stay blocked',
  { skip: !pdfAvailable },
  () => {
    for (const content of [
      statement(),
      `For Claim ${REF}\nUnreadable benefit table`,
      'Claim statement',
    ]) {
      fs.writeFileSync(scan, syntheticPdf(content));
      assert.throws(() => review(decision()), /Only image-only/);
    }
    fs.writeFileSync(scan, blank);
    review(decision());
    fs.writeFileSync(scan, Buffer.from('%PDF-broken\n%%EOF'));
    assert.throws(() => review(decision()), /pdftotext failed/);
    assert.throws(
      () => service.reparse(),
      (error) => error.code === 'PARSE_FAILED',
    );
    fs.writeFileSync(scan, blank);
    fs.writeFileSync(reviews, '{broken');
    assert.throws(
      () => service.reparse(),
      (error) => error.code === 'PARSE_FAILED',
    );
    for (const bad of [
      '../household.json',
      `demo/${REF}/../../household.json`,
      `other/${REF}/statement_2_scan.pdf`,
      file + ':stream',
      file.replaceAll('/', '\\'),
    ]) {
      assert.throws(
        () => resolveDocument(bad),
        (error) => error.code === 'INVALID_INPUT',
      );
    }
    assert.equal(fs.existsSync(path.join(DATA, '.scupa-lock')), false);
  },
);
