// Synthetic portal; every request is intercepted. No Bupa login or personal data.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { REF, OTHER } from '../test/fixtures.js';
fs.mkdirSync('.cache/discovery-tests', { recursive: true });
process.env.SCUPA_DATA_DIR = fs.mkdtempSync(path.resolve('.cache/discovery-tests/archive-'));
const { launchInstalledBrowser } = await import('../src/core/browser.js');
const { fetchHousehold } = await import('../src/core/portal.js');
const { loadConfig, RAW } = await import('../src/core/util.js');
let ambiguous = false;
const browsers = [];
async function launchBrowser(options) {
  const browser = await launchInstalledBrowser(options);
  browsers.push(browser);
  const create = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const context = await create(options);
    let selected = 'holder';
    let currentPath = '';
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://membersworld.bupaglobal.com') return route.abort();
      const api = url.pathname.startsWith('/api/');
      if (!api) {
        selected = url.searchParams.get('memberid') || 'holder';
        currentPath = url.pathname;
      }
      const claimsQuery = selected === 'holder' ? '' : '?memberid=' + selected;
      const nav =
        '<a href="/logout">Log out</a><a href="/plan">Manage Your Plan</a><a href="/plan/dependants">Dependants overview</a>' +
        `<a href="/en/my-claims${claimsQuery}">View all claims</a>`;
      // Synthetic markup shaped like the live portal. The holder is not a dependant card.
      const members =
        '<main><a class="m-card-sum-header" href="/en/plan?memberid=second"><h2 class="m-card-sum-title">Second Person (Partner)</h2></a>' +
        '<a class="m-card-sum-header" href="/en/plan?memberid=third"><h2 class="m-card-sum-title">Third Person (Daughter)</h2></a></main>';
      let body = nav + (url.pathname === '/plan/dependants' ? members : '<main>Plan</main>');
      if (url.pathname === '/my-profile')
        body =
          nav +
          '<main><ul><li class="a-list-lval-item"><h3 class="a-list-lval-key">Name</h3><p class="a-list-lval-value">Example Person</p></li></ul></main>';
      if (url.pathname === '/plan/dependants' && ambiguous)
        body = nav + '<main>Unrecognised layout</main>';
      if (url.pathname.endsWith('GetAllClaimsActivity'))
        body = !/\/my-claims$/.test(currentPath)
          ? ''
          : selected === 'third'
            ? '<div>No claims</div>'
            : `<div class="claims-data" id="${selected === 'holder' ? REF : OTHER}" onclick="show('01/01/2000')"></div>`;
      if (url.pathname.endsWith('GetClaimDetails')) body = '<div>No attachments</div>';
      await route.fulfill({ status: 200, contentType: 'text/html', body });
    });
    return context;
  };
  return browser;
}
await assert.rejects(() => fetchHousehold({ launchBrowser }), { code: 'HUMAN_ACTION_REQUIRED' });
assert.deepEqual(loadConfig().members, {});
await assert.rejects(() => fetchHousehold({ launchBrowser, confirmHousehold: async () => false }), {
  code: 'CANCELLED',
});
assert.deepEqual(loadConfig().members, {});
ambiguous = true;
await assert.rejects(() => fetchHousehold({ launchBrowser, confirmHousehold: async () => true }), {
  code: 'DISCOVERY_UNAVAILABLE',
});
assert.deepEqual(loadConfig().members, {});
assert.equal(fs.existsSync(RAW), false);
ambiguous = false;
const confirmed = [];
const result = await fetchHousehold({
  launchBrowser,
  confirmHousehold: async (names) => {
    assert.deepEqual(names, ['Example Person', 'Second Person', 'Third Person']);
    assert.deepEqual(loadConfig().members, {});
    return true;
  },
  confirmMember: async (member) => {
    confirmed.push(member.displayName);
    return true;
  },
});
assert.deepEqual(confirmed, ['Example Person', 'Second Person', 'Third Person']);
assert.deepEqual(
  result.map((member) => member.claims),
  [1, 1, 0],
);
const ids = Object.keys(loadConfig().members);
assert.equal(fs.existsSync(path.join(RAW, ids[0], REF)), true);
assert.equal(fs.existsSync(path.join(RAW, ids[1], OTHER)), true);
assert.equal(Object.values(loadConfig().members)[0].self, true);
assert.equal(
  browsers.every((browser) => !browser.isConnected()),
  true,
);
console.log(
  'Discovery smoke passed: first-run discovery, human confirmation, refusal, cancellation, zero-claim members and browser cleanup. No real Bupa requests.',
);
