import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { REF, OTHER, statement, syntheticPdf, approveAssessment } from './fixtures.js';

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
    service.reviewDocument({
      file: options.file,
      sha256: options.sha256,
      classification: options.classification ?? (options.supporting ? 'supporting' : null),
    });
  } finally {
    release();
  }
};
test(
  'unreviewed provider PDFs cannot change payments, with or without invoice headings',
  { skip: !pdfAvailable },
  () => {
    saveCurrent(['statement_1_demo.pdf']);
    service.reparse();
    const master = fs.readFileSync(MASTER);
    for (const heading of ['INVOICE\n', 'RECEIPT\n', '']) {
      fs.writeFileSync(
        scan,
        syntheticPdf(
          heading +
            statement({ paid: '100.00' }) +
            '\n' +
            statement({ ref: OTHER, paid: '100.00' }),
        ),
      );
      saveCurrent(['statement_2_scan.pdf']);
      assert.throws(
        () => service.reparse(),
        (error) => error.code === 'PARSE_FAILED',
      );
      assert.deepEqual(fs.readFileSync(MASTER), master);
    }
  },
);
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
  approveAssessment(directory, 'statement_1_demo.pdf');
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
    const document = service.archiveHelp().documents.find((doc) => doc.file === file);
    assert.deepEqual(document, {
      file,
      sha256: documentHash(scan),
      supporting: false,
      assessment: false,
      readable: false,
    });
    assert.equal(service.reviewedDocumentPath(document), scan);
    review(decision());
    assert.equal(service.archiveHelp().documents.find((doc) => doc.file === file).supporting, true);
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
  'assessment approval binds valid single- and multi-claim PDFs to their exact bytes',
  { skip: !pdfAvailable },
  () => {
    const text = statement() + '\n' + statement({ ref: OTHER, paid: '100.00' });
    fs.writeFileSync(scan, syntheticPdf(text));
    saveCurrent(['statement_2_scan.pdf']);
    assert.throws(
      () => service.reparse(),
      (error) => error.code === 'PARSE_FAILED',
    );
    const document = { file, sha256: documentHash(scan), classification: 'assessment' };
    review(document);
    assert.equal(service.archiveHelp().documents[0].assessment, true);
    assert.deepEqual(service.reparse().parsed.errors, []);
    assert.equal(service.snapshot().rows.length, 2);
    assert.equal(service.reparse().updated, 0);
    const master = fs.readFileSync(MASTER);
    fs.writeFileSync(scan, syntheticPdf(text.replace('£80.00', '£90.00')));
    assert.throws(() => review(document), /changed/);
    assert.throws(
      () => service.reparse(),
      (error) => error.code === 'PARSE_FAILED',
    );
    assert.deepEqual(fs.readFileSync(MASTER), master);
    fs.writeFileSync(scan, syntheticPdf(text));
    assert.equal(service.reparse().updated, 0, 'Restored approved bytes stay approved');
    review({ ...document, supporting: false, classification: undefined });
    assert.throws(
      () => service.reparse(),
      (error) => error.code === 'PARSE_FAILED',
    );
    assert.deepEqual(fs.readFileSync(MASTER), master);
  },
);

test(
  'cached text and supporting decisions cannot authorise another assessment PDF',
  { skip: !pdfAvailable },
  () => {
    fs.writeFileSync(scan, syntheticPdf(statement()));
    const masterBefore = fs.existsSync(MASTER) ? fs.readFileSync(MASTER) : null;
    assert.throws(
      () => service.reparse(),
      (error) => error.code === 'PARSE_FAILED',
    );
    assert.equal(
      masterBefore ? fs.readFileSync(MASTER).equals(masterBefore) : !fs.existsSync(MASTER),
      true,
    );
    const parsed = JSON.parse(fs.readFileSync(path.join(DATA, 'parsed.json'), 'utf8'));
    assert.ok(parsed.stats.errors.some((message) => message.includes('UNREVIEWED_ASSESSMENT')));
    fs.writeFileSync(
      reviews,
      JSON.stringify({
        schemaVersion: 1,
        supporting: {
          'statement_2_scan.pdf': { sha256: documentHash(scan), reviewedAt: '2000-01-02' },
        },
      }),
    );
    saveCurrent(['statement_2_scan.pdf']);
    assert.throws(
      () => service.reparse(),
      (error) => error.code === 'PARSE_FAILED',
    );
    for (const content of ['', 'Claim statement', statement().replace(/Total payment[^\n]+/, '')]) {
      fs.writeFileSync(scan, syntheticPdf(content));
      assert.throws(
        () => review({ file, sha256: documentHash(scan), classification: 'assessment' }),
        /Only readable, valid/,
      );
    }
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
    assert.equal(
      service.archiveHelp().documents.find((doc) => doc.file === file).supporting,
      false,
    );
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
  'assessment decisions never transfer to new filenames or conflicting metadata',
  { skip: !pdfAvailable },
  () => {
    fs.writeFileSync(scan, syntheticPdf(statement()));
    review({ file, sha256: documentHash(scan), classification: 'assessment' });
    saveCurrent(['statement_2_scan.pdf']);
    service.reparse();
    const master = fs.readFileSync(MASTER);
    const renamed = 'statement_2_scan__revision_demo.pdf';
    fs.copyFileSync(scan, path.join(directory, renamed));
    saveCurrent([renamed]);
    assert.throws(
      () => service.reparse(),
      (error) => error.code === 'PARSE_FAILED',
    );
    assert.deepEqual(fs.readFileSync(MASTER), master);
    saveCurrent(['statement_2_scan.pdf']);
    const entry = { sha256: documentHash(scan), reviewedAt: '2000-01-02' };
    for (const invalid of [null, [], { 'statement_2_scan.pdf': { ...entry, sha256: 'invalid' } }]) {
      fs.writeFileSync(
        reviews,
        JSON.stringify({ schemaVersion: 1, supporting: {}, assessments: invalid }),
      );
      assert.throws(
        () => service.reparse(),
        (error) => error.code === 'PARSE_FAILED',
      );
      assert.deepEqual(fs.readFileSync(MASTER), master);
    }
    fs.writeFileSync(
      reviews,
      JSON.stringify({
        schemaVersion: 1,
        supporting: { 'statement_2_scan.pdf': entry },
        assessments: { 'statement_2_scan.pdf': entry },
      }),
    );
    assert.throws(
      () => service.reparse(),
      (error) => error.code === 'PARSE_FAILED',
    );
    assert.deepEqual(fs.readFileSync(MASTER), master);
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
