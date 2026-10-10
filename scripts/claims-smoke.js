import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { HEADERS, CLAIM_STATUS } from '../src/core/model.js';
import { toCsv, parseCsv } from '../src/core/csv.js';
import { syntheticPdf } from '../test/fixtures.js';

// Every claim, person, document and note in this smoke is synthetic.
fs.mkdirSync('.cache/smoke', { recursive: true });
const archive = fs.mkdtempSync(path.resolve('.cache/smoke/claims-'));
const screenshots =
  process.env.SCUPA_SCREENSHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'scupa-screens-'));
fs.mkdirSync(screenshots, { recursive: true });
const exported = path.join(path.dirname(archive), path.basename(archive) + '-export.csv');
fs.writeFileSync(
  path.join(archive, 'household.json'),
  JSON.stringify({
    schemaVersion: 1,
    baseUrl: 'https://membersworld.bupaglobal.com',
    members: {
      demo: { displayName: 'Example Person', self: true },
      second: { displayName: 'Second Person' },
    },
    lastSync: '2026-10-10T09:30:00.000Z',
    watchlist: [],
  }),
);
const blank = Object.fromEntries(HEADERS.map((key) => [key, '']));
const claim = (index, overrides = {}) => ({
  ...blank,
  member: 'demo',
  claim_ref: `CL000101${String(index).padStart(6, '0')}`,
  received_date: '2026-10-10',
  treatment_date: '2026-10-05',
  payment_date: '2026-10-08',
  provider: 'Northbank Clinic',
  invoice: `DEMO-${index}`,
  currency: 'GBP',
  paid_currency: 'GBP',
  claimed: '150.0',
  paid: '150.0',
  paid_to: 'member',
  benefit_categories: 'Specialist consultation',
  status: CLAIM_STATUS.paid,
  ...overrides,
});
const rows = [
  claim(1, {
    status: CLAIM_STATUS.awaiting,
    claimed: '',
    paid: '',
    currency: '',
    paid_currency: '',
    payment_date: '',
    provider: '',
    received_date: '2026-09-18',
    treatment_date: '',
    invoice: '',
    benefit_categories: '',
  }),
  claim(2, {
    member: 'second',
    provider: 'Elm Physiotherapy',
    status: CLAIM_STATUS.rejected,
    paid: '0.0',
    received_date: '2026-10-09',
  }),
  claim(3, {
    provider: 'Harbour Dental',
    status: CLAIM_STATUS.partial,
    claimed: '137.0',
    paid: '115.0',
    received_date: '2026-10-07',
    invoice: 'DEMO-DENTAL-3',
    benefit_categories: 'Dental treatment',
    notes:
      'Assessment received. Check provider invoice before treating the difference as an amount owed.',
  }),
  claim(4, {
    provider: 'Harbour Dental',
    received_date: '2026-09-21',
    treatment_date: '2026-09-19',
    claimed: '220.0',
    paid: '220.0',
    benefit_categories: 'Dental treatment',
  }),
  claim(5, {
    member: 'second',
    provider: 'Northbank Clinic',
    claimed: '90.0',
    paid: '90.0',
    received_date: '2026-10-03',
  }),
  claim(6, {
    provider: 'Example European Clinic',
    currency: 'EUR',
    paid_currency: 'EUR',
    claimed: '180.0',
    paid: '180.0',
    received_date: '2026-09-30',
  }),
];
fs.mkdirSync(path.join(archive, 'master'));
const master = path.join(archive, 'master', 'claims.csv');
fs.writeFileSync(master, toCsv(rows, HEADERS));
const masterBefore = fs.readFileSync(master);
const partial = rows[2].claim_ref;
const directory = path.join(archive, 'raw', 'demo', partial);
fs.mkdirSync(directory, { recursive: true });
for (const filename of ['statement_1_assessment.pdf', 'supporting_1_dental_invoice.pdf'])
  fs.writeFileSync(
    path.join(directory, filename),
    syntheticPdf('Synthetic example document for interface testing.'),
  );
fs.writeFileSync(
  path.join(directory, 'current.json'),
  JSON.stringify({
    schemaVersion: 1,
    files: ['statement_1_assessment.pdf', 'supporting_1_dental_invoice.pdf'],
  }),
);
const launch = () =>
  electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      SCUPA_DATA_DIR: archive,
      SCUPA_APP_DIR: path.join(archive, 'app-preferences'),
    },
    timeout: 60000,
  });
let app = await launch();
const errors = [];
try {
  let page = await app.firstWindow();
  // Follow-up labels and screenshots must remain stable after the fixture dates pass.
  await page.clock.setFixedTime('2026-10-10T12:00:00Z');
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type())) errors.push(msg.text());
  });
  await app.evaluate(({ BrowserWindow, dialog, shell }, exported) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1360, 1000);
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: exported });
    globalThis.openedPdf = '';
    shell.openPath = async (file) => {
      globalThis.openedPdf = file;
      return '';
    };
  }, exported);
  await page.waitForFunction(() => !document.getElementById('sync').disabled);
  assert.equal(await page.title(), 'BUPA SCUPA');
  assert.match(page.url(), /src\/ui\/index.html$/);
  assert.equal(await page.locator('#claims tr').count(), 6);
  assert.equal(await page.locator('#attention-count').textContent(), '3');
  assert.equal(await page.locator('#advanced-filters').isVisible(), false);
  assert.equal(await page.locator('#saved-view').isVisible(), false);
  assert.equal(await page.locator('#filter-summary').isVisible(), false);
  await page.screenshot({ path: path.join(screenshots, '01-all-claims.png'), fullPage: true });
  if (process.env.SCUPA_PUBLIC_SCREENSHOT === '1') {
    await page.locator('#archive-path').evaluate((element) => {
      element.textContent = 'C:\\Users\\Example\\Documents\\BUPA SCUPA';
    });
    await page.screenshot({ path: path.resolve('docs/images/dashboard.png'), fullPage: true });
    await page.locator('#archive-path').evaluate((element, archive) => {
      element.textContent = archive;
    }, archive);
  }
  await page.getByRole('button', { name: `View claim ${partial}`, exact: true }).click();
  await page.locator('#claim-dialog').waitFor({ state: 'visible' });
  assert.match(await page.locator('#detail-fields').textContent(), /DEMO-DENTAL-3/);
  assert.equal(await page.locator('#follow-up-form').isVisible(), false);
  await page
    .getByRole('button', { name: /Supporting document supporting_1_dental_invoice/ })
    .click();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('#detail-documents button')].some((button) => button.disabled),
  );
  assert.equal(
    await app.evaluate(() => globalThis.openedPdf),
    path.join(directory, 'supporting_1_dental_invoice.pdf'),
  );
  await page.locator('#follow-up-details summary').click();
  await page
    .locator('#follow-up-notes')
    .fill(
      'Called Bupa to check the dental assessment. Compare the invoice and statement before chasing the balance.',
    );
  await page.locator('#chased-on').fill('2026-10-09');
  await page.locator('#follow-up-on').fill('2026-10-16');
  await page.locator('#follow-up-pinned').check();
  await page.locator('#save-follow-up').click();
  await page.getByText('Follow-up saved.', { exact: true }).waitFor();
  assert.deepEqual(fs.readFileSync(master), masterBefore);
  assert.equal(await page.locator('#detail-notes b').count(), 0);
  const titleBox = await page.locator('#detail-provider').boundingBox();
  assert.ok(
    titleBox && titleBox.y >= 0,
    'The detail title remains visible after scrolling to save',
  );
  await page.screenshot({ path: path.join(screenshots, '06-follow-up.png') });
  await page.locator('#follow-up-details summary').click();
  assert.match(
    await page.locator('#follow-up-summary').textContent(),
    /Follow up 16 Oct.*Notes saved/,
  );
  await page.locator('#claim-dialog').evaluate((dialog) => {
    dialog.scrollTop = 0;
  });
  await page.screenshot({ path: path.join(screenshots, '02-claim-details.png') });
  await page.locator('#close-claim').click();
  await page.waitForFunction(
    (claimRef) => document.activeElement?.getAttribute('aria-label') === `View claim ${claimRef}`,
    partial,
  );
  await page.locator('#attention-tab').click();
  assert.equal(await page.locator('#claims tr').count(), 3);
  assert.match(await page.locator('#claims').textContent(), /Awaiting statement/);
  assert.match(await page.locator('#claims').textContent(), /Follow up 16 Oct/);
  await page.screenshot({ path: path.join(screenshots, '03-needs-attention.png'), fullPage: true });
  await page.getByRole('button', { name: `View claim ${rows[1].claim_ref}`, exact: true }).click();
  await page.locator('#claim-dialog').waitFor({ state: 'visible' });
  await page.locator('#follow-up-details summary').click();
  await page.locator('#follow-up-reviewed').check();
  await page.locator('#save-follow-up').click();
  await page.getByText('Follow-up saved.', { exact: true }).waitFor();
  await page.locator('#close-claim').click();
  assert.equal(await page.locator('#attention-count').textContent(), '2');
  await page.locator('#all-tab').click();
  await page.locator('#more-filters').click();
  assert.equal(await page.locator('#more-filters').getAttribute('aria-expanded'), 'true');
  await page.locator('#provider').selectOption('Harbour Dental');
  await page.locator('#date-field').selectOption('treatment_date');
  await page.locator('#date-from').fill('2026-10-01');
  await page.locator('#date-to').fill('2026-10-10');
  assert.equal(await page.locator('#claims tr').count(), 1);
  await page.locator('button.column-sort[data-sort="claimed"]').click();
  assert.equal(
    await page.locator('th[data-sort="claimed"]').getAttribute('aria-sort'),
    'ascending',
  );
  await page.screenshot({ path: path.join(screenshots, '07-more-filters.png'), fullPage: true });
  await page.locator('#more-filters').click();
  assert.equal(await page.locator('#advanced-filters').isVisible(), false);
  assert.match(await page.locator('#active-filters').textContent(), /Harbour Dental.*Treatment/);
  assert.equal(await page.locator('#advanced-count').textContent(), '2');
  await page.locator('#view-menu summary').click();
  await page.locator('#save-view').click();
  await page.locator('#view-name').fill('Dental claims · October');
  await page.locator('#confirm-save-view').click();
  await page.getByText('View saved.', { exact: true }).waitFor();
  assert.equal(await page.locator('#view-menu-title').textContent(), 'Dental claims · October');
  await page.locator('#view-menu summary').click();
  await page.screenshot({ path: path.join(screenshots, '08-saved-views.png'), fullPage: true });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#saved-view').isVisible(), false);
  await page.locator('#export').click();
  await page.getByText('Exported 1 claim', { exact: false }).waitFor();
  assert.deepEqual(
    parseCsv(fs.readFileSync(exported, 'utf8')).map((row) => row.claim_ref),
    [partial],
  );
  assert.doesNotMatch(fs.readFileSync(exported, 'utf8'), /Called Bupa/);
  await page.screenshot({ path: path.join(screenshots, '04-filtered-claims.png'), fullPage: true });
  await page.locator('#more-filters').click();
  await page.locator('#date-from').fill('2026-11-01');
  assert.equal(await page.locator('#filter-error').isVisible(), true);
  assert.equal(await page.locator('#export').isDisabled(), true);
  await page.locator('#clear-filters').click();
  await page.locator('#more-filters').click();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(860, 760),
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await page.screenshot({ path: path.join(screenshots, '05-small-window.png'), fullPage: true });
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.clock.setFixedTime('2026-10-10T12:00:00Z');
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => !document.getElementById('sync').disabled);
  await page.locator('#view-menu summary').click();
  await page.locator('#saved-view').selectOption({ label: 'Dental claims · October' });
  assert.equal(await page.locator('#saved-view').isVisible(), false);
  assert.equal(await page.locator('#advanced-filters').isVisible(), false);
  assert.equal(await page.locator('#claims tr').count(), 1);
  assert.equal(await page.locator('#date-from').inputValue(), '2026-10-01');
  await page.locator('#view-menu summary').click();
  await page.locator('#saved-view').selectOption('');
  assert.equal(await page.locator('#view-menu-title').textContent(), 'Views');
  assert.equal(await page.locator('#claims tr').count(), 1);
  await page.locator('#view-menu summary').click();
  await page.locator('#saved-view').selectOption({ label: 'Dental claims · October' });
  await page.getByRole('button', { name: `View claim ${partial}`, exact: true }).click();
  await page.locator('#claim-dialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#follow-up-form').isVisible(), false);
  assert.match(await page.locator('#follow-up-summary').textContent(), /Notes saved/);
  await page.locator('#follow-up-details summary').click();
  assert.match(await page.locator('#follow-up-notes').inputValue(), /Called Bupa/);
  await page.locator('#close-claim').click();
  await page.locator('#view-menu summary').click();
  await page.locator('#remove-view').click();
  await page.getByText('Saved view removed.', { exact: true }).waitFor();
  assert.equal(await page.locator('#saved-view option').count(), 1);
  const formerView = await page.evaluate(() =>
    window.scupa.call('save-view', {
      name: 'Previous provider',
      query: { provider: 'Former Example Clinic' },
    }),
  );
  assert.equal(formerView.ok, true);
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('sync').disabled);
  await page.locator('#view-menu summary').click();
  await page.locator('#saved-view').selectOption({ label: 'Previous provider' });
  assert.equal(await page.locator('#provider').inputValue(), 'Former Example Clinic');
  assert.equal(await page.locator('#claims tr').count(), 0);
  assert.equal(await page.locator('#export').isDisabled(), true);
  assert.match(await page.locator('#active-filters').textContent(), /Former Example Clinic/);
  await page.locator('#clear-filters').click();
  assert.equal(await page.locator('#claims tr').count(), 6);
  assert.deepEqual(fs.readFileSync(master), masterBefore);
  assert.deepEqual(errors, []);
  console.log(
    `Claims desktop smoke passed: compact default controls, expandable filters and follow-ups, saved-view menu, details, PDF links, attention/review, persistence across restarts, missing-provider saved filters, column sort, matching CSV export, invalid ranges and 860px layout. Screenshots: ${screenshots}`,
  );
} finally {
  await app.close();
}
