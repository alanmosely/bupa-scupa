import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { syntheticPdf, statement, convertedStatement, REF, OTHER } from '../test/fixtures.js';

fs.mkdirSync('.cache/smoke', { recursive: true });
const archive = fs.mkdtempSync(path.resolve('.cache/smoke/archive-'));
const packaged = process.argv.includes('--packaged');
const executablePath = packaged ? path.resolve('dist/win-unpacked/BUPA SCUPA.exe') : undefined;
const app = await electron.launch({
  ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }),
  env: {
    ...process.env,
    SCUPA_DATA_DIR: archive,
    SCUPA_APP_DIR: path.join(archive, 'app-preferences'),
  },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: 'Start with your Bupa login' }).waitFor();
  assert.equal(await page.locator('#sync').isEnabled(), true);
  assert.equal(
    await page
      .locator('.brand .logo')
      .evaluate((image) => image.complete && image.naturalWidth > 0),
    true,
    'Clean Sweep header icon loads from local packaged assets',
  );
  assert.equal(await page.locator('#setup-archive-path').textContent(), archive);
  assert.match(await page.locator('#setup').textContent(), /does\s+not encrypt/i);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await page.locator('#setup summary').click();
  await page.locator('#names').fill('Example Person\nSecond Person');
  await page.locator('#save-setup').click();
  await page.getByText('Household saved.', { exact: false }).waitFor({ state: 'visible' });
  const household = JSON.parse(fs.readFileSync(path.join(archive, 'household.json'), 'utf8'));
  const member = Object.keys(household.members)[0];
  const directory = path.join(archive, 'raw', member, REF);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'statement_1_demo.pdf'), syntheticPdf(statement()));
  await page.locator('.archive-settings summary').click();
  assert.equal(
    await page.getByRole('button', { name: 'Refresh all claims', exact: true }).isEnabled(),
    true,
  );
  await page.locator('#reparse').click();
  await page.getByText('Done. 1 claims added, 0 updated.').waitFor();
  await page.waitForFunction(() => document.getElementById('claim-count').textContent === '1');
  assert.equal(await page.locator('#claim-count').textContent(), '1');
  assert.match(await page.locator('#paid-total').textContent(), /80\.00/);
  await page.locator('#search').fill('No matching provider');
  assert.equal(await page.locator('#claims tr').count(), 0);
  await page.locator('#search').fill('Example Clinic');
  assert.equal(await page.locator('#claims tr').count(), 1);
  await page.locator('#status').selectOption('awaiting');
  assert.equal(await page.locator('#claims tr').count(), 0);
  await page.locator('#status').selectOption('');
  const masterBeforeEdit = fs.readFileSync(path.join(archive, 'master', 'claims.csv'));
  await page.locator('#edit-household').click();
  await page.locator('#household-fields input').first().fill('Corrected Example');
  await page.locator('#save-household').click();
  await page.getByText('Household names saved.', { exact: false }).waitFor();
  const corrected = JSON.parse(fs.readFileSync(path.join(archive, 'household.json'), 'utf8'));
  assert.equal(corrected.members[member].displayName, 'Corrected Example');
  assert.equal(corrected.members[member].needsConfirmation, true);
  assert.deepEqual(fs.readFileSync(path.join(archive, 'master', 'claims.csv')), masterBeforeEdit);
  await page.locator('#privacy').click();
  assert.equal(await page.locator('#privacy-path').textContent(), archive);
  await page.locator('#close-privacy').click();
  const child = spawnSync(process.execPath, ['-e', ''], { windowsHide: true });
  fs.writeFileSync(
    path.join(archive, '.scupa-lock'),
    JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString() }),
  );
  await page.locator('#archive-help').click();
  await page.locator('#recover-lock').click();
  await page.getByText('Interrupted run recovered.', { exact: false }).waitFor();
  assert.equal(fs.existsSync(path.join(archive, '.scupa-lock')), false);
  await page.locator('#close-help').click();
  const convertedDirectory = path.join(archive, 'raw', member, OTHER);
  fs.mkdirSync(convertedDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(convertedDirectory, 'statement_1_converted.pdf'),
    syntheticPdf(convertedStatement({ ref: OTHER })),
  );
  await page.locator('#reparse').click();
  await page.waitForFunction(() => document.getElementById('claim-count').textContent === '2');
  const convertedRow = page.locator('#claims tr').filter({ hasText: OTHER });
  assert.equal(await convertedRow.locator('td').nth(2).textContent(), '€100.00');
  assert.equal(await convertedRow.locator('td').nth(3).textContent(), '£64.00');
  assert.equal(await convertedRow.locator('.status-chip').textContent(), 'Partially Paid');
  assert.equal(await page.locator('#paid-total').textContent(), '£144.00');
  // Native dialogs are answered only for this synthetic archive.
  await app.evaluate(({ dialog, shell }) => {
    globalThis.reviewAnswer = 0;
    globalThis.openedPdf = '';
    dialog.showMessageBox = async (_window, options) => {
      if (options.title !== 'Mark as supporting document') throw new Error('Unexpected dialog');
      return { response: globalThis.reviewAnswer, checkboxChecked: false };
    };
    shell.openPath = async (file) => {
      globalThis.openedPdf = file;
      return '';
    };
  });
  const scan = path.join(directory, 'statement_2_scan.pdf');
  const scanBytes = syntheticPdf('');
  fs.writeFileSync(scan, scanBytes);
  const reviewFile = path.join(directory, 'document-reviews.json');
  const masterBeforeReview = fs.readFileSync(path.join(archive, 'master', 'claims.csv'));
  await page.locator('#reparse').click();
  await page.getByText('Some statements could not be safely parsed.', { exact: false }).waitFor();
  await page.locator('#error-help').click();
  await page.getByRole('button', { name: 'View PDF', exact: true }).click();
  await page.getByText('PDF opened. Review every page before marking it as supporting.').waitFor();
  assert.equal(await app.evaluate(() => globalThis.openedPdf), scan);
  await page.getByRole('button', { name: 'Mark as supporting document', exact: true }).click();
  await page.getByText('Review decisions are shown below.', { exact: false }).waitFor();
  assert.equal(fs.existsSync(reviewFile), false, 'Cancelling the review records no decision');
  await app.evaluate(() => {
    globalThis.reviewAnswer = 1;
  });
  await page.getByRole('button', { name: 'Mark as supporting document', exact: true }).click();
  await page.getByRole('button', { name: 'Undo supporting classification', exact: true }).waitFor();
  await page.screenshot({ path: '.cache/smoke/document-review.png', fullPage: true });
  assert.deepEqual(fs.readFileSync(scan), scanBytes);
  assert.deepEqual(fs.readFileSync(path.join(archive, 'master', 'claims.csv')), masterBeforeReview);
  await page.getByRole('button', { name: 'Undo supporting classification', exact: true }).click();
  await page.getByRole('button', { name: 'Mark as supporting document', exact: true }).waitFor();
  assert.deepEqual(JSON.parse(fs.readFileSync(reviewFile, 'utf8')).supporting, {});
  await page.getByRole('button', { name: 'Mark as supporting document', exact: true }).click();
  await page.getByRole('button', { name: 'Undo supporting classification', exact: true }).waitFor();
  await page.locator('#close-help').click();
  await page.locator('#reparse').click();
  await page.getByText('Done. 0 claims added, 0 updated.').waitFor();
  assert.deepEqual(fs.readFileSync(path.join(archive, 'master', 'claims.csv')), masterBeforeReview);
  assert.deepEqual(fs.readFileSync(scan), scanBytes);
  await page.screenshot({ path: '.cache/smoke/dashboard.png', fullPage: true });
  if (process.argv.includes('--cancel-parse')) {
    const master = path.join(archive, 'master', 'claims.csv');
    const before = fs.readFileSync(master);
    const filesBeforeCancel = fs.readdirSync(directory).length;
    for (let i = 3; i <= 52; i++)
      fs.writeFileSync(
        path.join(directory, `statement_${i}_revision.pdf`),
        syntheticPdf(statement({ paid: '100.00', date: '03/01/2000' })),
      );
    await page.locator('#reparse').click();
    await page.locator('#cancel').click();
    await page.getByText('cancelled.', { exact: false }).waitFor();
    await page.waitForFunction(() => !document.getElementById('reparse').disabled);
    assert.deepEqual(fs.readFileSync(master), before);
    assert.equal(fs.existsSync(path.join(archive, '.scupa-lock')), false);
    assert.equal(fs.readdirSync(directory).length, filesBeforeCancel + 50);
    console.log(
      'Cancellation during saved-PDF parsing prevents the reassessment merge and preserves every PDF.',
    );
  }
  if (process.argv.includes('--browser')) {
    const master = path.join(archive, 'master', 'claims.csv');
    const before = fs.readFileSync(master);
    for (const button of ['#sync', '#full-sync']) {
      await page.locator(button).click();
      await page
        .getByText(
          button === '#sync'
            ? 'Sign in to Bupa in the browser window, including MFA. Keep it open.'
            : 'Full refresh: sign in to Bupa, including MFA. All available claims will be checked. Keep the browser open.',
        )
        .waitFor();
      assert.equal(await page.locator('#full-sync').isEnabled(), false);
      await page.locator('#cancel').click();
      await page.getByText('Sync cancelled.', { exact: false }).waitFor();
      await page.waitForFunction(() => !document.getElementById('sync').disabled);
      assert.equal(fs.existsSync(path.join(archive, '.scupa-lock')), false);
      assert.deepEqual(fs.readFileSync(master), before);
      assert.equal(await page.locator('#claim-count').textContent(), '2');
    }
    console.log(
      'Incremental sync and full refresh opened the browser and cancelled safely before login. Master unchanged.',
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    'Desktop smoke passed: setup, offline bundled PDF parsing, document review and undo, separate claim/payment currencies, totals, search, filters, renderer isolation. ' +
      (packaged ? 'Packaged executable.' : 'Development executable.'),
  );
} catch (error) {
  const page = await app.firstWindow();
  console.error(
    'Desktop state:',
    await page.locator('#message, #progress-detail').allTextContents(),
  );
  throw error;
} finally {
  await app.close();
}
