import path from 'node:path';
import { launchInstalledBrowser } from './browser.js';
import { RAW, loadConfig, saveConfig, sinceFromRef, ensureDir, atomicWrite } from './util.js';
import { loadMaster } from './merge.js';
import { archivePdf, verifyMemberRefs, retry, resolveNavigationHref } from './safety.js';
import { ScupaError } from './errors.js';
import { BUPA_ORIGIN } from './model.js';
import { discoverHousehold, memberCardName } from './discovery.js';
import { setup } from './service.js';

const ORIGIN = BUPA_ORIGIN;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (signal) => {
  if (signal?.aborted)
    throw new ScupaError('CANCELLED', 'Sync cancelled. Downloaded PDFs have been kept.');
};

export async function portalList(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/sitecore/Plan/GetAllClaimsActivity?months=36', {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(30000),
    });
    if (
      !response.ok ||
      new URL(response.url).origin !== location.origin ||
      /login|sign.?in/i.test(new URL(response.url).pathname)
    )
      throw new Error('Bupa session is not available.');
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const logout = [...document.querySelectorAll('a[href], button')].some((el) =>
      /log\s*out|sign\s*out/i.test((el.textContent || '') + ' ' + (el.getAttribute('href') || '')),
    );
    const emptyAuthenticated =
      !html.trim() &&
      logout &&
      /\/my-claims\/?$/i.test(location.pathname) &&
      !document.querySelector('input[type="password"]');
    const rows = doc.querySelectorAll('div.claims-data');
    const explicitlyEmpty = [...doc.querySelectorAll('p, div, span')].some((el) =>
      /^(?:you have )?no (?:new |recent )?claims(?: (?:to display|found|available))?[.!]?$/i.test(
        (el.textContent || '').replace(/\s+/g, ' ').trim(),
      ),
    );
    if (
      doc.querySelector('input[type="password"]') ||
      (!rows.length && !emptyAuthenticated && !explicitlyEmpty)
    )
      throw new Error('Bupa returned an unfamiliar claims page. No records have been imported.');
    const claims = new Map();
    for (const row of rows) {
      if (!/^CL\d{12}$/.test(row.id))
        throw new Error('Bupa returned an unexpected claim reference.');
      const date = (row.getAttribute('onclick') || '').match(/'([^']+)'\)/);
      if (!date) throw new Error('Bupa returned a claim without its received date.');
      claims.set(row.id, { claimId: row.id, recievedDate: date[1] });
    }
    return [...claims.values()];
  });
}
export function uniqueMemberHref(links, name) {
  const norm = (s) =>
    String(s || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('en-GB');
  const matches = links.filter(
    (a) =>
      norm(a.text) === norm(name) ||
      norm(a.title) === norm(name) ||
      (a.memberCardTitle && norm(memberCardName(a.memberCardTitle)) === norm(name)),
  );
  const hrefs = [
    ...new Set(
      matches
        .map((a) => {
          try {
            const url = new URL(a.href, ORIGIN);
            return url.origin === ORIGIN && !a.href.startsWith('#') ? url.href : null;
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    ),
  ];
  if (hrefs.length !== 1)
    throw new ScupaError(
      'MEMBER_NOT_FOUND',
      'The member link could not be identified uniquely. Check the exact portal display name in household.json.',
    );
  return hrefs[0];
}
async function links(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('a[href]')].map((a) => ({
      href: a.getAttribute('href'),
      text: a.textContent,
      title: a.getAttribute('title'),
      memberCardTitle: a.matches('.m-card-sum-header')
        ? a.querySelector('h2.m-card-sum-title')?.textContent
        : null,
    })),
  );
}
async function navigate(page, needle) {
  const href = resolveNavigationHref(await links(page), needle, ORIGIN);
  if (!href)
    throw new ScupaError(
      'PORTAL_CHANGED',
      'Bupa navigation has changed. No claims have been imported.',
    );
  await page.goto(new URL(href, ORIGIN).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pause(800);
}
async function selectMember(page, member) {
  await page.goto(ORIGIN + '/my-claims', { waitUntil: 'domcontentloaded' });
  await navigate(page, '/plan');
  const overview = resolveNavigationHref(await links(page), '/plan/dependants', ORIGIN);
  if (overview) {
    await page.goto(new URL(overview, ORIGIN).href, { waitUntil: 'domcontentloaded' });
    await pause(800);
  }
  await page.goto(uniqueMemberHref(await links(page), member.displayName), {
    waitUntil: 'domcontentloaded',
  });
  await pause(800);
  await navigate(page, '/my-claims');
}
async function attachments(page, claim) {
  return page.evaluate(async (claim) => {
    const response = await fetch(
      '/api/sitecore/Plan/GetClaimDetails?' + new URLSearchParams(claim),
      { credentials: 'same-origin', signal: AbortSignal.timeout(30000) },
    );
    if (
      !response.ok ||
      new URL(response.url).origin !== location.origin ||
      /login|sign.?in/i.test(new URL(response.url).pathname)
    )
      throw new Error('Bupa session expired.');
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    if (doc.querySelector('input[type="password"]')) throw new Error('Bupa session expired.');
    const result = new Map();
    for (const a of doc.querySelectorAll('a[href*="/api/sitecore/Plan/DownloadFile"]')) {
      const url = new URL(a.getAttribute('href') || '', location.origin);
      if (url.origin !== location.origin || !url.searchParams.get('fileId'))
        throw new Error('Unexpected document link.');
      const key = url.searchParams.get('fileId');
      if (result.has(key)) continue;
      const tag = a.getAttribute('data-analytics-link') || '';
      let kind = tag.includes('bupa-statement')
        ? 'statement'
        : tag.includes('claim-form')
          ? 'form'
          : 'supporting';
      const label =
        (a.textContent || 'document')
          .replace(/\s*PDF\s*[\d.]+\s*[km]b\s*$/i, '')
          .trim()
          .replace(/[^A-Za-z0-9._-]+/g, '_')
          .slice(0, 60) || 'document';
      if (/invoice|receipt/i.test(label)) kind = 'supporting';
      result.set(key, { href: url.href, kind, label });
    }
    const explicitlyEmpty = [...doc.querySelectorAll('p, div, span')].some((el) =>
      /^(?:claim details:\s*)?no (?:attachments|documents)(?: (?:available|found|to display))?[.!]?$/i.test(
        (el.textContent || '').replace(/\s+/g, ' ').trim(),
      ),
    );
    if (!result.size && !explicitlyEmpty)
      throw new Error('Bupa returned unfamiliar claim details. No documents have been imported.');
    return [...result.values()];
  }, claim);
}
export function selectClaims(claims, since, awaiting = new Set(), fullRefresh = false) {
  return claims.filter(
    (claim) => fullRefresh || claim.claimId.slice(2, 8) >= since || awaiting.has(claim.claimId),
  );
}

/** @param {{fullRefresh?: boolean, signal?: AbortSignal, emit?: (event: {phase: string, message: string, current?: number, total?: number}) => void, confirmHousehold?: (names: string[]) => Promise<boolean>, confirmMember?: (member: {memberId: string, displayName: string, claimCount: number}) => Promise<boolean>, launchBrowser?: (options: import("playwright-core").LaunchOptions) => Promise<import("playwright-core").Browser>}} options */
export async function fetchHousehold({
  fullRefresh = false,
  signal,
  emit = () => {},
  confirmHousehold,
  confirmMember,
  launchBrowser = (options) => launchInstalledBrowser(options, { signal }),
}) {
  let cfg = loadConfig();
  if (cfg.baseUrl !== ORIGIN)
    throw new ScupaError('INVALID_CONFIG', 'SCUPA supports Bupa Global MembersWorld only.');
  check(signal);
  const browser = await launchBrowser({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--disable-save-password-bubble'],
    timeout: 60000,
  });
  const onAbort = () => {
    browser.close().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    check(signal);
    const context = await browser.newContext({ viewport: null, acceptDownloads: false });
    const page = await context.newPage();
    emit({
      phase: 'login',
      message: fullRefresh
        ? 'Full refresh: sign in to Bupa, including MFA. All available claims will be checked. Keep the browser open.'
        : 'Sign in to Bupa in the browser window, including MFA. Keep it open.',
    });
    await page.goto(ORIGIN + '/my-claims', { waitUntil: 'domcontentloaded' }).catch(() => {});
    const deadline = Date.now() + 10 * 60 * 1000;
    let authenticated = false;
    while (Date.now() < deadline) {
      check(signal);
      if (page.isClosed())
        throw new ScupaError(
          'BROWSER_CLOSED',
          'The Bupa browser was closed. Start sync again and keep it open.',
        );
      try {
        if (new URL(page.url()).origin === ORIGIN) {
          await portalList(page);
          authenticated = true;
          break;
        }
      } catch {
        /* Login is performed by the human. */
      }
      await pause(2500);
    }
    if (!authenticated)
      throw new ScupaError('LOGIN_TIMEOUT', 'Login timed out after 10 minutes. Start sync again.');
    const discovered = !Object.keys(cfg.members).length;
    if (discovered) {
      emit({ phase: 'setup', message: 'Reading your household from Bupa…' });
      const names = await discoverHousehold(page);
      check(signal);
      if (!confirmHousehold)
        throw new ScupaError(
          'HUMAN_ACTION_REQUIRED',
          'Confirm the discovered household in the desktop app.',
        );
      if (!(await confirmHousehold(names)))
        throw new ScupaError('CANCELLED', 'Household discovery cancelled. No household was saved.');
      check(signal);
      setup(names);
      cfg = loadConfig();
    }
    const byMember = {};
    const latest = {};
    const stubs = {};
    for (const row of loadMaster()) {
      (byMember[row.member] ??= new Set()).add(row.claim_ref);
      if (!latest[row.member] || row.claim_ref > latest[row.member])
        latest[row.member] = row.claim_ref;
      if (/^No statement/i.test(row.status)) (stubs[row.member] ??= new Set()).add(row.claim_ref);
    }
    const summaries = [];
    for (const [id, member] of Object.entries(cfg.members)) {
      check(signal);
      emit({ phase: 'member', message: `Checking ${member.displayName}…` });
      // Discovery ends on the dependants overview, where the claims API may
      // return an empty response. Open the actual holder's claims page first.
      if (member.self)
        await page.goto(ORIGIN + '/my-claims', { waitUntil: 'domcontentloaded', timeout: 30000 });
      const current = await retry(() => portalList(page));
      const alreadySelected =
        byMember[id]?.size && current.some((c) => byMember[id].has(c.claimId));
      // The account holder is not listed among dependant cards. The query-free
      // claims route returns to their profile; child links must retain memberid.
      if (!member.self && !alreadySelected) await selectMember(page, member);
      const all = await retry(() => portalList(page));
      const known = verifyMemberRefs(
        id,
        all.map((c) => c.claimId),
        byMember,
      );
      if (!known || member.needsConfirmation) {
        if (!confirmMember)
          throw new ScupaError(
            'HUMAN_ACTION_REQUIRED',
            'Confirm the selected member in the desktop app before the first import.',
          );
        const accepted = await confirmMember({
          memberId: id,
          displayName: member.displayName,
          claimCount: all.length,
        });
        check(signal);
        if (!accepted) throw new ScupaError('CANCELLED', 'Member verification was cancelled.');
        // Check the snapshot again in case the user changed profiles while reviewing it.
        const after = await portalList(page);
        if (JSON.stringify(after) !== JSON.stringify(all))
          throw new ScupaError(
            'PROFILE_CHANGED',
            'The claims list changed during confirmation. Start again.',
          );
        verifyMemberRefs(
          id,
          after.map((c) => c.claimId),
          byMember,
        );
        if (member.needsConfirmation) {
          delete member.needsConfirmation;
          saveConfig(cfg);
        }
      }
      byMember[id] = new Set(all.map((c) => c.claimId));
      const since = fullRefresh ? '000000' : sinceFromRef(latest[id], 14);
      const selected = selectClaims(all, since, stubs[id], fullRefresh);
      /** @type {{member: string, since: string, exportedAt: string, claims: Array<{claimId: string, recievedDate: string, files: string[]}>}} */
      const manifest = { member: id, since, exportedAt: new Date().toISOString(), claims: [] };
      for (const [index, claim] of selected.entries()) {
        check(signal);
        emit({
          phase: 'download',
          message: `${member.displayName}: claim ${index + 1} of ${selected.length}`,
          current: index + 1,
          total: selected.length,
        });
        const files = await retry(() => attachments(page, claim));
        const directory = path.join(RAW, id, claim.claimId);
        ensureDir(directory);
        const saved = [];
        const counts = { statement: 0, supporting: 0, form: 0 };
        for (const file of files) {
          if (file.kind === 'form') continue;
          check(signal);
          counts[file.kind]++;
          saved.push(
            await retry(async () => {
              const response = await context.request.get(file.href, {
                timeout: 30000,
                maxRedirects: 0,
              });
              try {
                if (!response.ok()) {
                  const error = Object.assign(
                    new Error('Document download failed: HTTP ' + response.status()),
                    { retryable: response.status() === 429 || response.status() >= 500 },
                  );
                  throw error;
                }
                const body = await response.body();
                check(signal);
                if (body.length > 64 * 1024 * 1024)
                  throw new Error('Document exceeds the 64 MB safety limit.');
                return archivePdf(
                  directory,
                  `${file.kind}_${counts[file.kind]}_${file.label}.pdf`,
                  body,
                );
              } finally {
                await response.dispose();
              }
            }),
          );
        }
        check(signal);
        // Commit only a complete claim download. Older PDFs remain in the archive,
        // but must not override a revision the portal has since restored or removed.
        atomicWrite(
          path.join(directory, 'current.json'),
          JSON.stringify({ schemaVersion: 1, files: saved }, null, 2),
        );
        manifest.claims.push({ ...claim, files: saved });
      }
      ensureDir(path.join(RAW, id));
      atomicWrite(path.join(RAW, id, 'manifest.json'), JSON.stringify(manifest, null, 2));
      summaries.push({ member: id, claims: selected.length });
    }
    return summaries;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await browser.close();
  }
}
