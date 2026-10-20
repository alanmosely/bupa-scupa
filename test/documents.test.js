import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { REF, OTHER, statement, syntheticPdf } from './fixtures.js';

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
const unfamiliar = (text) => text.replaceAll('Bupa Global\ninfo@bupaglobal.com\n', '');
const saveCurrent = (files) =>
  fs.writeFileSync(current, JSON.stringify({ schemaVersion: 1, files }));
const review = (classification, document = { file, sha256: documentHash(scan) }) => {
  const release = service.acquireLock();
  try {
    service.reviewDocument({ ...document, classification });
  } finally {
    release();
  }
};
const pending = () => {
  const result = service.reparse();
  assert.ok(result.reviewRequired > 0);
  assert.ok(service.archiveHelp().issues.length > 0);
  return result;
};
beforeEach(() => {
  saveConfig({
    schemaVersion: 1,
    baseUrl: BUPA_ORIGIN,
    members: { demo: { displayName: 'Example Person', self: true } },
    watchlist: [],
  });
  for (const name of [MASTER, path.join(DATA, 'parsed.json')])
    if (fs.existsSync(name)) fs.unlinkSync(name);
  fs.writeFileSync(path.join(directory, 'statement_1_demo.pdf'), syntheticPdf(statement()));
  fs.writeFileSync(scan, blank);
  fs.writeFileSync(reviews, JSON.stringify({ schemaVersion: 1, supporting: {} }));
  saveCurrent(['statement_1_demo.pdf']);
  const otherCurrent = path.join(RAW, 'demo', OTHER, 'current.json');
  if (fs.existsSync(otherCurrent))
    fs.writeFileSync(otherCurrent, JSON.stringify({ schemaVersion: 1, files: [] }));
});

test(
  'standard Bupa statements and reassessments import without manual approval',
  { skip: !pdfAvailable },
  () => {
    assert.equal(service.reparse().reviewRequired, 0);
    assert.equal(service.snapshot().rows.find((row) => row.claim_ref === REF).paid, '80.0');
    assert.equal(service.archiveHelp().documents[0].automatic, true);
    fs.writeFileSync(
      path.join(directory, 'statement_1_demo.pdf'),
      syntheticPdf(statement({ paid: '100.00', date: '03/01/2000' })),
    );
    assert.equal(service.reparse().updated, 1);
    assert.equal(service.snapshot().rows.find((row) => row.claim_ref === REF).paid, '100.0');
    assert.deepEqual(JSON.parse(fs.readFileSync(reviews, 'utf8')), {
      schemaVersion: 1,
      supporting: {},
    });
  },
);

test(
  'provider statement-shaped PDFs need review, including invoice headings and cached text',
  { skip: !pdfAvailable },
  () => {
    service.reparse();
    for (const heading of ['INVOICE\n', 'RECEIPT\n', '']) {
      fs.writeFileSync(scan, syntheticPdf(heading + unfamiliar(statement({ paid: '100.00' }))));
      saveCurrent(['statement_2_scan.pdf']);
      pending();
      assert.equal(service.snapshot().rows.find((row) => row.claim_ref === REF).paid, '80.0');
    }
    fs.writeFileSync(scan, syntheticPdf('INVOICE\n' + statement({ paid: '100.00' })));
    pending();
    assert.equal(service.snapshot().rows.find((row) => row.claim_ref === REF).paid, '80.0');
  },
);

test(
  'unreadable documents do not block unrelated claims or change existing payments',
  { skip: !pdfAvailable },
  () => {
    service.reparse();
    saveCurrent(['statement_1_demo.pdf', 'statement_2_scan.pdf']);
    const otherDir = path.join(RAW, 'demo', OTHER);
    fs.mkdirSync(otherDir, { recursive: true });
    fs.writeFileSync(
      path.join(otherDir, 'statement_1_other.pdf'),
      syntheticPdf(statement({ ref: OTHER })),
    );
    fs.writeFileSync(
      path.join(otherDir, 'current.json'),
      JSON.stringify({ schemaVersion: 1, files: ['statement_1_other.pdf'] }),
    );
    const result = pending();
    assert.equal(result.reviewRequired, 1);
    assert.equal(service.snapshot().rows.length, 2);
    assert.equal(service.snapshot().rows.find((row) => row.claim_ref === OTHER).paid, '80.0');
    assert.equal(service.snapshot().rows.find((row) => row.claim_ref === REF).paid, '80.0');
    assert.deepEqual(service.pendingClaims(), [{ member: 'demo', claim_ref: REF }]);
    assert.deepEqual(fs.readFileSync(scan), blank);
    review('supporting');
    assert.equal(service.reparse().reviewRequired, 0);
    review(null);
    pending();
  },
);

test(
  'new claims with ambiguous totals appear with unknown amounts instead of false zeroes',
  { skip: !pdfAvailable },
  () => {
    fs.writeFileSync(
      path.join(directory, 'statement_1_demo.pdf'),
      syntheticPdf(statement() + '\nTotal payment made to your healthcare provider    £20.00'),
    );
    pending();
    const row = service.snapshot().rows.find((row) => row.claim_ref === REF);
    assert.equal(row.paid, '');
    assert.equal(row.claimed, '');
    assert.match(row.notes, /Statement needs attention/);
    assert.ok(
      service.archiveHelp().issues.some((issue) => issue.includes('AMBIGUOUS_PAYMENT_TOTAL')),
    );
  },
);

test(
  'unfamiliar assessments can be confirmed once, bound to exact bytes and filenames',
  { skip: !pdfAvailable },
  () => {
    fs.writeFileSync(scan, syntheticPdf(unfamiliar(statement())));
    saveCurrent(['statement_2_scan.pdf']);
    pending();
    const document = { file, sha256: documentHash(scan) };
    review('assessment', document);
    assert.equal(service.reparse().reviewRequired, 0);
    fs.writeFileSync(scan, syntheticPdf(unfamiliar(statement({ paid: '100.00' }))));
    assert.throws(() => review('assessment', document), /changed/);
    pending();
    assert.equal(service.snapshot().rows.find((row) => row.claim_ref === REF).paid, '80.0');
    fs.writeFileSync(scan, syntheticPdf(unfamiliar(statement())));
    assert.equal(service.reparse().reviewRequired, 0);
    const renamed = 'statement_2_scan__revision_demo.pdf';
    fs.copyFileSync(scan, path.join(directory, renamed));
    saveCurrent([renamed]);
    pending();
    assert.throws(() => review('assessment', document), /no longer current/);
  },
);

test('a malformed segment defers the whole multi-claim document', { skip: !pdfAvailable }, () => {
  fs.writeFileSync(
    scan,
    syntheticPdf(statement() + '\n' + statement({ ref: OTHER }).replace(/Total payment[^\n]+/, '')),
  );
  saveCurrent(['statement_2_scan.pdf']);
  const result = pending();
  assert.equal(result.reviewRequired, 2);
  assert.ok(service.snapshot().rows.every((row) => row.paid === ''));
});

test(
  'supporting decisions cannot authorise readable assessments or unsafe totals',
  { skip: !pdfAvailable },
  () => {
    fs.writeFileSync(scan, syntheticPdf(unfamiliar(statement())));
    saveCurrent(['statement_2_scan.pdf']);
    fs.writeFileSync(
      reviews,
      JSON.stringify({
        schemaVersion: 1,
        supporting: {
          'statement_2_scan.pdf': { sha256: documentHash(scan), reviewedAt: '2000-01-02' },
        },
      }),
    );
    pending();
    for (const content of ['', 'Claim statement', statement().replace(/Total payment[^\n]+/, '')]) {
      fs.writeFileSync(scan, syntheticPdf(content));
      assert.throws(() => review('assessment'), /Only readable, valid/);
    }
    fs.writeFileSync(scan, syntheticPdf(statement()));
    assert.throws(() => review('supporting'), /Only image-only/);
  },
);

test(
  'invalid archive metadata and arbitrary paths still block unsafe writes',
  { skip: !pdfAvailable },
  () => {
    service.reparse();
    const master = fs.readFileSync(MASTER);
    saveCurrent(['statement_1_demo.pdf', 'missing.pdf']);
    assert.throws(() => service.reparse(), { code: 'PARSE_FAILED' });
    assert.deepEqual(fs.readFileSync(MASTER), master);
    saveCurrent(['statement_1_demo.pdf']);
    fs.writeFileSync(reviews, '{broken');
    assert.throws(() => service.reparse(), { code: 'PARSE_FAILED' });
    assert.deepEqual(fs.readFileSync(MASTER), master);
    for (const bad of [
      '../household.json',
      `demo/${REF}/../../household.json`,
      `other/${REF}/statement_2_scan.pdf`,
      file + ':stream',
      file.replaceAll('/', '\\'),
    ])
      assert.throws(() => resolveDocument(bad), { code: 'INVALID_INPUT' });
    assert.equal(fs.existsSync(path.join(DATA, '.scupa-lock')), false);
  },
);
