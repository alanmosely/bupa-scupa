// Synthetic portal only. Routes block all real network access.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { REF, OTHER, syntheticPdf, approveAssessment } from '../test/fixtures.js';
fs.mkdirSync('.cache/portal-tests', { recursive: true });
process.env.SCUPA_DATA_DIR = fs.mkdtempSync(path.resolve('.cache/portal-tests/archive-'));
process.env.SCUPA_PDFTOTEXT = path.resolve('vendor/xpdf/pdftotext.exe');
const { launchInstalledBrowser } = await import('../src/core/browser.js');
const { saveConfig, loadConfig, RAW } = await import('../src/core/util.js');
const { fetchHousehold, portalList } = await import('../src/core/portal.js');
const { MASTER } = await import('../src/core/util.js');
saveConfig({
  ...loadConfig(),
  members: {
    test_member: { displayName: 'Example Person', self: true },
    other_member: { displayName: 'Second Person' },
    empty_member: { displayName: 'Third Person' },
  },
});
let context;
let listResponse;
let detailsResponse;
let downloadStatements = false;
let downloadFailure = false;
let paid = '80.00';
const downloads = [];
async function launchBrowser(options) {
  const browser = await launchInstalledBrowser(options);
  const makeContext = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    context = await makeContext(options);
    // Browser routes do not intercept APIRequestContext downloads.
    context.request.get = async (href) => {
      const url = new URL(href);
      assert.equal(url.origin, 'https://membersworld.bupaglobal.com');
      assert.equal(url.pathname, '/api/sitecore/Plan/DownloadFile');
      const ref = url.searchParams.get('fileId');
      const failed = ref === 'fail';
      assert.ok(failed || [REF, OTHER].includes(ref));
      downloads.push(ref);
      return {
        ok: () => !failed,
        status: () => (failed ? 403 : 200),
        body: async () => syntheticPdf(statement({ ref, paid })),
        dispose: async () => {},
      };
    };
    let selected = 'test_member';
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://membersworld.bupaglobal.com') {
        await route.abort();
        return;
      }
      let html;
      if (url.pathname.endsWith('GetAllClaimsActivity'))
        html =
          listResponse ??
          (selected === 'empty_member'
            ? '<div>No claims</div>'
            : `<div class="claims-data" id="${selected === 'test_member' ? REF : OTHER}" onclick="show('01/01/2000')"></div>`);
      else if (url.pathname.endsWith('GetClaimDetails'))
        html = downloadStatements
          ? `<a href="/api/sitecore/Plan/DownloadFile?fileId=${url.searchParams.get('claimId')}" data-analytics-link="bupa-statement">Benefit statement</a>` +
            (downloadFailure
              ? '<a href="/api/sitecore/Plan/DownloadFile?fileId=fail" data-analytics-link="bupa-statement">Second statement</a>'
              : '')
          : (detailsResponse ?? '<div>Claim details: no attachments</div>');
      else {
        if (url.pathname === '/member/second') selected = 'other_member';
        if (url.pathname === '/member/empty') selected = 'empty_member';
        html =
          '<a href="/logout">Log out</a><a href="/plan">Manage Your Plan</a><a href="/plan/dependants">Dependants overview</a><a href="/member/first">Example Person</a><a href="/member/second">Second Person</a><a href="/member/empty">Third Person</a><a href="/my-claims">View all claims</a>';
      }
      await route.fulfill({ status: 200, contentType: 'text/html', body: html });
    });
    return context;
  };
  return browser;
}
const confirmations = [];
const fetched = await fetchHousehold({
  launchBrowser,
  confirmMember: async (member) => {
    confirmations.push(member.memberId);
    return true;
  },
});
assert.deepEqual(confirmations, ['test_member', 'other_member', 'empty_member']);
assert.equal(fetched.length, 3);
assert.equal(fetched[2].claims, 0);
assert.equal(fs.existsSync(path.join(RAW, 'test_member', REF)), true);
assert.equal(fs.existsSync(path.join(RAW, 'other_member', OTHER)), true);
assert.equal(fs.existsSync(MASTER), false);
await assert.rejects(
  () => fetchHousehold({ launchBrowser }),
  (e) => e.code === 'HUMAN_ACTION_REQUIRED',
);
const controller = new AbortController();
await assert.rejects(
  () =>
    fetchHousehold({
      launchBrowser,
      signal: controller.signal,
      confirmMember: async () => {
        controller.abort();
        return false;
      },
    }),
  (e) => e.code === 'CANCELLED',
);
const manifest = path.join(RAW, 'test_member', 'manifest.json');
const manifestBefore = fs.readFileSync(manifest);
for (const html of [
  '<h1>Service temporarily unavailable</h1>',
  '',
  '<div>No documents could be loaded due to an error</div>',
]) {
  detailsResponse = html;
  await assert.rejects(
    () => fetchHousehold({ launchBrowser, confirmMember: async () => true }),
    /unfamiliar claim details/,
  );
  assert.equal(fs.existsSync(MASTER), false);
  assert.deepEqual(fs.readFileSync(manifest), manifestBefore);
}
detailsResponse = undefined;
const { mergeRecords } = await import('../src/core/merge.js');
const { parseStatementText } = await import('../src/core/parse.js');
const { statement } = await import('../test/fixtures.js');
mergeRecords([
  ...parseStatementText(statement(), 'test_member'),
  ...parseStatementText(statement({ ref: OTHER }), 'other_member'),
]);
const cfg = loadConfig();
cfg.members.test_member.needsConfirmation = true;
saveConfig(cfg);
const reconfirmed = [];
await fetchHousehold({
  launchBrowser,
  confirmMember: async (member) => {
    reconfirmed.push(member.memberId);
    return true;
  },
});
assert.deepEqual(reconfirmed, ['test_member', 'empty_member']);
assert.equal(loadConfig().members.test_member.needsConfirmation, undefined);
downloadStatements = true;
const { reparse } = await import('../src/core/service.js');
const { loadMaster } = await import('../src/core/merge.js');
const directory = path.join(RAW, 'test_member', REF);
const currentFile = path.join(directory, 'current.json');
const originalFiles = [];
for (const payment of ['80.00', '100.00', '80.00']) {
  paid = payment;
  downloads.length = 0;
  const refreshed = await fetchHousehold({
    launchBrowser,
    fullRefresh: true,
    confirmMember: async () => true,
  });
  assert.deepEqual(
    refreshed.map((member) => member.claims),
    [1, 1, 0],
  );
  assert.deepEqual(downloads, [REF, OTHER]);
  originalFiles.push(JSON.parse(fs.readFileSync(currentFile, 'utf8')).files[0]);
  for (const member of ['test_member', 'other_member']) {
    const memberDir = path.join(RAW, member);
    for (const claim of fs.readdirSync(memberDir)) {
      const claimDir = path.join(memberDir, claim);
      if (!fs.statSync(claimDir).isDirectory()) continue;
      for (const file of JSON.parse(fs.readFileSync(path.join(claimDir, 'current.json'), 'utf8'))
        .files)
        approveAssessment(claimDir, file);
    }
  }
  reparse();
  assert.equal(loadMaster().find((row) => row.claim_ref === REF).paid, Number(payment).toFixed(1));
  assert.equal(reparse().updated, 0);
}
assert.equal(originalFiles[0], originalFiles[2]);
assert.notEqual(originalFiles[0], originalFiles[1]);
assert.equal(fs.readdirSync(directory).filter((file) => file.endsWith('.pdf')).length, 2);

const currentBefore = fs.readFileSync(currentFile);
const masterBefore = fs.readFileSync(MASTER);
downloadFailure = true;
paid = '90.00';
await assert.rejects(
  () => fetchHousehold({ launchBrowser, fullRefresh: true, confirmMember: async () => true }),
  /HTTP 403/,
);
assert.deepEqual(fs.readFileSync(currentFile), currentBefore);
assert.deepEqual(fs.readFileSync(MASTER), masterBefore);
assert.equal(reparse().updated, 0);
assert.deepEqual(fs.readFileSync(MASTER), masterBefore);
assert.equal(fs.readdirSync(directory).filter((file) => file.endsWith('.pdf')).length, 3);
downloadStatements = false;
downloadFailure = false;

const browser = await launchBrowser({ headless: false });
try {
  const page = await (await browser.newContext()).newPage();
  await page.goto('https://membersworld.bupaglobal.com/my-claims');
  for (const html of [
    '<h1>Claims activity temporarily unavailable</h1>',
    '<div>claims-data failed to load</div>',
    '<div>No claims could be loaded due to an error</div>',
  ]) {
    listResponse = html;
    await assert.rejects(() => portalList(page), /unfamiliar claims page/);
  }
  for (const html of ['<div>No claims</div>', '']) {
    listResponse = html;
    assert.deepEqual(await portalList(page), []);
  }
  await page.goto('https://membersworld.bupaglobal.com/plan');
  await assert.rejects(() => portalList(page), /unfamiliar claims page/);
} finally {
  listResponse = undefined;
  await browser.close();
}
console.log(
  'Synthetic portal smoke passed: member checks, zero claims, full refresh, restored PDF revisions, failed download preservation, cancellation, and refusal of unfamiliar responses. No real Bupa requests.',
);
