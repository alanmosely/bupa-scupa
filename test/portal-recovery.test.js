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
const { parseRawDir } = await import('../src/core/parse.js');
const { loadMaster, mergeRecords } = await import('../src/core/merge.js');
const OLDER_UNSEEN = 'CL000101000003';

function fixture(
  expiry,
  {
    unknownMember = false,
    wrongRecovery = false,
    cancel = false,
    olderUnseen = false,
    emptyClaims = false,
    navigationFailure = null,
  } = {},
) {
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
      (emptyClaims ? [] : unknownMember ? [REF] : [REF, OTHER]).map((claim_ref, index) => ({
        ...Object.fromEntries(HEADERS.map((field) => [field, ''])),
        claim_ref,
        member: index ? 'second' : 'holder',
        received_date: '2000-01-01',
        ...(olderUnseen && claim_ref === REF
          ? {
              status: CLAIM_STATUS.paid,
              currency: 'GBP',
              paid_currency: 'GBP',
              claimed: '80.0',
              paid: '80.0',
            }
          : { status: CLAIM_STATUS.awaiting }),
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
  const detailRequests = [];
  const navigationFailures = [];
  const page = {
    url: () => url,
    isClosed: () => false,
    locator: () => ({ count: async () => Number(loginPage) }),
    async goto(destination) {
      const target = new URL(destination);
      selected = target.searchParams.get('memberid') || 'holder';
      url = target.href;
      loginPage = false;
      if (
        navigationFailure &&
        (!navigationFailure.once || !navigationFailures.length) &&
        (navigationFailure.initial ? !armed : armed && target.pathname === '/plan')
      ) {
        navigationFailures.push(target.pathname);
        return {
          status: () => navigationFailure.status,
          url: () => target.href,
          headers: () => ({ 'retry-after': navigationFailure.retryAfter }),
        };
      }
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
          const refs = emptyClaims
            ? []
            : claimId === REF && olderUnseen
              ? [REF, OLDER_UNSEEN]
              : [claimId];
          return {
            status: 200,
            url: BUPA_ORIGIN + argument,
            html: JSON.stringify(refs.map((claimId) => ({ claimId, recievedDate: '01/01/2000' }))),
          };
        }
        detailRequests.push(new URL(argument, BUPA_ORIGIN).searchParams.get('claimId'));
        return { status: 200, url: BUPA_ORIGIN + argument, html: 'no attachments' };
      }
      if (argument?.html === 'no attachments') return [];
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
        if (
          navigationFailure?.cancel &&
          event.phase === 'download' &&
          /Waiting/.test(event.message)
        )
          controller.abort();
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
    detailRequests,
    confirmations,
    navigationFailures,
    verifyClosed: () => assert.equal(closed, true),
    verify() {
      assert.equal(expired, true);
      assert.equal(signIns, 1);
      assert.equal(closed, true);
      assert.deepEqual(fs.readFileSync(MASTER), masterBefore);
      return confirmations;
    },
  };
}

test('page navigation respects long server cooldowns during initial login and member selection', async () => {
  for (const initial of [true, false]) {
    for (const status of [429, 503]) {
      const trial = fixture(null, { navigationFailure: { initial, status, retryAfter: '120' } });
      await assert.rejects(fetchHousehold(trial.options), {
        code: status === 429 ? 'BUPA_RATE_LIMITED' : 'BUPA_REQUEST_FAILED',
        retryAfterMs: 120000,
      });
      assert.equal(trial.navigationFailures.length, 1);
      trial.verifyClosed();
    }
  }
});

test('a page navigation cooldown remains cancellable', async () => {
  const trial = fixture(null, {
    navigationFailure: { initial: true, status: 429, retryAfter: '10', cancel: true },
  });
  await assert.rejects(fetchHousehold(trial.options), { code: 'CANCELLED' });
  assert.equal(trial.navigationFailures.length, 1);
  trial.verifyClosed();
});

test('a temporary navigation failure retries and restores the selected member', async () => {
  const trial = fixture(null, {
    navigationFailure: { initial: false, status: 503, retryAfter: '0.01', once: true },
  });
  const result = await fetchHousehold(trial.options);
  assert.deepEqual(
    result.map((member) => member.claims),
    [1, 1],
  );
  assert.deepEqual(trial.navigationFailures, ['/plan']);
  assert.deepEqual(trial.detailRequests, [REF, OTHER]);
  trial.verifyClosed();
});

test('sync refuses linked raw and member ancestors before writing claim files', async () => {
  for (const linked of [RAW, path.join(RAW, 'holder')]) {
    const trial = fixture(null);
    fs.mkdirSync(linked, { recursive: true });
    const preserved = linked + '-junction-test';
    fs.renameSync(linked, preserved);
    try {
      fs.symlinkSync(preserved, linked, process.platform === 'win32' ? 'junction' : 'dir');
      await assert.rejects(fetchHousehold(trial.options), /Linked download folders/);
      trial.verifyClosed();
    } finally {
      if (fs.lstatSync(linked, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(linked);
      fs.renameSync(preserved, linked);
    }
  }
});

test('zero-claim sync refuses linked ancestors before writing the member manifest', async () => {
  for (const linked of [RAW, path.join(RAW, 'holder')]) {
    const trial = fixture(null, { emptyClaims: true });
    fs.mkdirSync(linked, { recursive: true });
    const preserved = linked + '-empty-junction-test';
    fs.renameSync(linked, preserved);
    try {
      fs.symlinkSync(preserved, linked, process.platform === 'win32' ? 'junction' : 'dir');
      await assert.rejects(fetchHousehold(trial.options), /Linked download folders/);
      trial.verifyClosed();
    } finally {
      if (fs.lstatSync(linked, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(linked);
      fs.renameSync(preserved, linked);
    }
  }
});

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

test('normal sync archives an older untracked reference only after verifying the member', async () => {
  const trial = fixture(null, { olderUnseen: true });
  await fetchHousehold(trial.options);
  assert.deepEqual(trial.detailRequests, [OLDER_UNSEEN, OTHER]);
  assert.deepEqual(trial.confirmations, []);

  const before = loadMaster().find((row) => row.claim_ref === REF);
  const parsed = parseRawDir({ extractText: () => assert.fail('No PDFs were returned') });
  assert.deepEqual(parsed.fatalErrors, []);
  const result = mergeRecords(parsed.records);
  assert.deepEqual(
    result.added.map((row) => row.claim_ref),
    [OLDER_UNSEEN],
  );
  const after = loadMaster();
  assert.deepEqual(
    after.find((row) => row.claim_ref === REF),
    before,
  );
  assert.equal(after.find((row) => row.claim_ref === OLDER_UNSEEN)?.member, 'holder');
  assert.equal(after.find((row) => row.claim_ref === OLDER_UNSEEN)?.status, CLAIM_STATUS.awaiting);
});
