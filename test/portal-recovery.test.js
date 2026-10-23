import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REF, OTHER } from './fixtures.js';
import { BUPA_ORIGIN, HEADERS, CLAIM_STATUS } from '../src/core/model.js';
import { toCsv } from '../src/core/csv.js';

fs.mkdirSync('.cache/tests', { recursive: true });
process.env.SCUPA_DATA_DIR = fs.mkdtempSync(path.resolve('.cache/tests/portal-recovery-'));
const { fetchHousehold } = await import('../src/core/portal.js');
const { saveConfig, MASTER, RAW, atomicWrite } = await import('../src/core/util.js');

function fixture(expiry, { unknownMember = false, wrongRecovery = false, cancel = false } = {}) {
  saveConfig({
    schemaVersion: 1,
    baseUrl: BUPA_ORIGIN,
    members: {
      holder: { displayName: 'Example Person', self: true },
      second: { displayName: 'Second Person' },
    },
    watchlist: [],
  });
  atomicWrite(
    MASTER,
    toCsv(
      (unknownMember ? [REF] : [REF, OTHER]).map((claim_ref, index) => ({
        ...Object.fromEntries(HEADERS.map((field) => [field, ''])),
        claim_ref,
        member: index ? 'second' : 'holder',
        received_date: '2000-01-01',
        status: CLAIM_STATUS.awaiting,
      })),
      HEADERS,
    ),
  );
  const masterBefore = fs.readFileSync(MASTER);
  const controller = new AbortController();
  let selected = 'holder',
    url = BUPA_ORIGIN + '/my-claims';
  let armed = false,
    expired = false,
    nextListExpires = false,
    loginPage = false,
    closed = false,
    signIns = 0;
  const confirmations = [];
  const page = {
    url: () => url,
    isClosed: () => false,
    locator: () => ({ count: async () => Number(loginPage) }),
    async goto(destination) {
      const target = new URL(destination);
      selected = target.searchParams.get('memberid') || 'holder';
      url = target.href;
      loginPage = false;
      if (armed && !expired && expiry === 'navigation' && target.pathname === '/plan') {
        expired = true;
        loginPage = true;
        url = BUPA_ORIGIN + '/login';
      }
      if (
        armed &&
        !expired &&
        expiry === 'selected-list' &&
        target.pathname === '/my-claims' &&
        selected === 'second'
      ) {
        expired = true;
        nextListExpires = true;
      }
    },
    async evaluate(_fn, argument) {
      if (typeof argument === 'string' && argument.startsWith('/api/')) {
        if (argument.includes('GetAllClaimsActivity')) {
          if (nextListExpires) {
            nextListExpires = false;
            return { status: 401, url: BUPA_ORIGIN + argument, html: '' };
          }
          const claimId = selected === 'holder' || (wrongRecovery && signIns) ? REF : OTHER;
          return {
            status: 200,
            url: BUPA_ORIGIN + argument,
            html: JSON.stringify([{ claimId, recievedDate: '01/01/2000' }]),
          };
        }
        return { status: 200, url: BUPA_ORIGIN + argument, html: 'no attachments' };
      }
      if (argument === 'no attachments') return [];
      if (typeof argument === 'string') return JSON.parse(argument);
      return [
        { href: '/plan', text: 'Manage Plan' },
        { href: '/plan/dependants', text: 'Dependants' },
        { href: '/plan?memberid=second', text: 'Second Person' },
        { href: '/my-claims', text: 'My claims' },
        { href: '/my-claims?memberid=second', text: 'View all claims' },
      ];
    },
  };
  return {
    options: {
      signal: controller.signal,
      launchBrowser: async (settings) => {
        assert.equal(settings.headless, false);
        return {
          newContext: async () => ({ newPage: async () => page }),
          close: async () => {
            closed = true;
          },
        };
      },
      confirmMember: async (member) => {
        confirmations.push(member.memberId);
        if (member.memberId === 'second' && expiry === 'confirmation') {
          expired = true;
          nextListExpires = true;
        }
        return true;
      },
      emit: (event) => {
        if (event.phase === 'member' && event.message.includes('Second Person')) {
          armed = true;
          if (expiry === 'between-members') {
            expired = true;
            nextListExpires = true;
          }
        }
        if (event.phase === 'login' && /signed you out/.test(event.message)) {
          signIns++;
          if (cancel) controller.abort();
        }
      },
    },
    verify() {
      assert.equal(expired, true);
      assert.equal(signIns, 1);
      assert.equal(closed, true);
      assert.deepEqual(fs.readFileSync(MASTER), masterBefore);
      return confirmations;
    },
  };
}

for (const expiry of ['between-members', 'selected-list', 'navigation', 'confirmation'])
  test(`manual session recovery restores the member after expiry at ${expiry}`, async () => {
    const trial = fixture(expiry, { unknownMember: expiry === 'confirmation' });
    const result = await fetchHousehold(trial.options);
    assert.deepEqual(
      result.map((member) => member.claims),
      [1, 1],
    );
    const manifest = JSON.parse(fs.readFileSync(path.join(RAW, 'second', 'manifest.json'), 'utf8'));
    assert.equal(manifest.claims[0].claimId, OTHER);
    assert.deepEqual(trial.verify(), expiry === 'confirmation' ? ['second'] : []);
  });

test('expiry between members still refuses a foreign claims list after sign-in', async () => {
  const trial = fixture('between-members', { wrongRecovery: true });
  await assert.rejects(fetchHousehold(trial.options), /known refs/);
  trial.verify();
});

test('manual sign-in recovery between members remains cancellable', async () => {
  const trial = fixture('between-members', { cancel: true });
  await assert.rejects(fetchHousehold(trial.options), { code: 'CANCELLED' });
  trial.verify();
});
