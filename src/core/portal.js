import path from 'node:path';
import fs from 'node:fs';
import { launchInstalledBrowser } from './browser.js';
import {
  RAW,
  REPORTS,
  loadConfig,
  saveConfig,
  sinceFromRef,
  ensureDir,
  atomicWrite,
} from './util.js';
import { loadMaster } from './merge.js';
import {
  archivePdf,
  verifyMemberRefs,
  retry,
  resolveNavigationHref,
  validatePortalResponse,
  validatePdf,
  describeDownload,
} from './safety.js';
import { ScupaError } from './errors.js';
import { BUPA_ORIGIN } from './model.js';
import { discoverHousehold, memberCardName } from './discovery.js';
import { setup, pendingClaims } from './service.js';
import { downloadProgress } from './download-progress.js';

const ORIGIN = BUPA_ORIGIN;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (signal) => {
  if (signal?.aborted)
    throw new ScupaError('CANCELLED', 'Sync cancelled. Downloaded PDFs have been kept.');
};

async function portalHtml(page, endpoint, request) {
  // Keep a gap between requests, including claim-details calls. First imports
  // can otherwise send hundreds of requests in a burst.
  await pause(250);
  const response = await page.evaluate(async (endpoint) => {
    const response = await fetch(endpoint, {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(30000),
    });
    const html = response.ok ? await response.text() : '';
    return {
      status: response.status,
      url: response.url,
      retryAfter: response.headers.get('retry-after'),
      loginPage: !!new DOMParser()
        .parseFromString(html, 'text/html')
        .querySelector('input[type="password"]'),
      html,
    };
  }, endpoint);
  validatePortalResponse(response, request);
  return response.html;
}

export async function portalList(page) {
  const html = await portalHtml(
    page,
    '/api/sitecore/Plan/GetAllClaimsActivity?months=36',
    'claims list',
  );
  return page.evaluate((html) => {
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
  }, html);
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
/** @param {string | null} [memberId] */
async function navigate(page, needle, memberId = null) {
  const href = resolveNavigationHref(await links(page), needle, ORIGIN, memberId);
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
  const memberHref = uniqueMemberHref(await links(page), member.displayName);
  const ids = [...new URL(memberHref).searchParams].filter(([key]) => /^memberid$/i.test(key));
  if (ids.length > 1 || (ids.length === 1 && !ids[0][1]))
    throw new ScupaError('PORTAL_CHANGED', 'Bupa returned an ambiguous member link.');
  await page.goto(memberHref, {
    waitUntil: 'domcontentloaded',
  });
  await pause(800);
  // Global desktop/mobile claims links return to the holder. Use the claims
  // link carrying the ID from the uniquely identified dependant card instead.
  // Older path-based member links retain their server-side selection behavior.
  await navigate(page, '/my-claims', ids[0]?.[1] ?? null);
}
async function attachments(page, claim) {
  const html = await portalHtml(
    page,
    '/api/sitecore/Plan/GetClaimDetails?' + new URLSearchParams(claim),
    'claim details',
  );
  return page.evaluate((html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
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
  }, html);
}

/**
 * Validate both transports before any response can enter the PDF archive.
 * @param {{onInvalid?: (details: object) => void, onFallback?: () => void}} [options]
 */
export async function downloadPdf(page, context, href, options = {}) {
  const { onInvalid = () => {}, onFallback = () => {} } = options;
  const target = new URL(href);
  if (
    target.origin !== ORIGIN ||
    target.pathname !== '/api/sitecore/Plan/DownloadFile' ||
    !target.searchParams.get('fileId')
  )
    throw Object.assign(
      new ScupaError('INVALID_DOWNLOAD', 'Refusing an unexpected document link.'),
      { retryable: false },
    );
  const limit = 64 * 1024 * 1024;
  const inspect = (body, metadata, transport) => {
    if (body.length > limit)
      throw Object.assign(
        new ScupaError('INVALID_DOWNLOAD', 'Document exceeds the 64 MB safety limit.'),
        { retryable: false },
      );
    const details = describeDownload(body, metadata.status, metadata.contentType);
    try {
      validatePdf(body);
      return null;
    } catch {
      onInvalid({ transport, ...details });
    }
    // Some login responses carry an incorrect or missing Content-Type.
    validatePortalResponse(
      {
        ...metadata,
        loginPage: /<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(
          body.subarray(0, 65536).toString(),
        ),
      },
      'document download',
    );
    return details;
  };
  const response = await context.request.get(href, { timeout: 30000, maxRedirects: 0 });
  try {
    const headers = response.headers();
    const metadata = {
      status: response.status(),
      url: headers.location || response.url(),
      retryAfter: headers['retry-after'],
      contentType: headers['content-type'] || '',
    };
    validatePortalResponse(metadata, 'document download');
    const body = await response.body();
    if (!inspect(body, metadata, 'request-context')) return body;
  } finally {
    await response.dispose();
  }
  onFallback();
  const result = await page.evaluate(
    async ({ href, limit }) => {
      const response = await fetch(href, {
        credentials: 'same-origin',
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(30000),
      });
      if (Number(response.headers.get('content-length')) > limit) return { tooLarge: true };
      const reader = response.body?.getReader();
      const chunks = [];
      let length = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > limit) {
            await reader.cancel();
            return { tooLarge: true };
          }
          chunks.push(value);
        }
      }
      let binary = '';
      for (const chunk of chunks)
        for (let i = 0; i < chunk.length; i += 32768)
          binary += String.fromCharCode(...chunk.subarray(i, i + 32768));
      return {
        tooLarge: false,
        base64: window.btoa(binary),
        status: response.status,
        url: response.url || href,
        retryAfter: response.headers.get('retry-after'),
        contentType: response.headers.get('content-type') || '',
        loginPage: response.type === 'opaqueredirect',
      };
    },
    { href, limit },
  );
  if (result.tooLarge)
    throw Object.assign(
      new ScupaError('INVALID_DOWNLOAD', 'Document exceeds the 64 MB safety limit.'),
      { retryable: false },
    );
  validatePortalResponse(result, 'browser document download');
  const body = Buffer.from(result.base64, 'base64');
  const invalid = inspect(body, result, 'browser-fetch');
  if (invalid)
    throw Object.assign(
      new ScupaError(
        'INVALID_PDF_DOWNLOAD',
        `Bupa returned an invalid PDF through both download methods (HTTP ${invalid.status}; ${invalid.contentType}; ${invalid.format}; ${invalid.bytes} bytes). Downloaded PDFs have been kept. Diagnostic details were saved in the archive reports folder.`,
      ),
      { retryable: true, retryAfterMs: 5000 },
    );
  return body;
}

async function waitForLogin(page, signal) {
  const deadline = Date.now() + 10 * 60 * 1000;
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
        return;
      }
    } catch {
      /* Login and MFA are performed by the human. */
    }
    await pause(2500);
  }
  throw new ScupaError('LOGIN_TIMEOUT', 'Login timed out after 10 minutes. Start sync again.');
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
    await waitForLogin(page, signal);
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
    for (const item of pendingClaims()) (stubs[item.member] ??= new Set()).add(item.claim_ref);
    let signIns = 0;
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
      const request = async (operation, claimId) => {
        const attempt = () =>
          retry(operation, {
            attempts: 4,
            delayMs: 2000,
            signal,
            onRetry: (error, delay) =>
              emit({
                phase: 'download',
                message: `Bupa ${error.code === 'BUPA_RATE_LIMITED' ? 'is limiting requests' : 'is temporarily unavailable'}. Waiting ${Math.ceil(delay / 1000)} seconds before retrying…`,
              }),
          });
        try {
          return await attempt();
        } catch (error) {
          if (error.code !== 'SESSION_EXPIRED' || signIns >= 2) throw error;
          signIns++;
          emit({
            phase: 'login',
            message:
              'Bupa signed you out. Sign in again, including MFA, in the same browser. Sync will resume after your member is verified.',
          });
          check(signal);
          await page.goto(ORIGIN + '/my-claims', { waitUntil: 'domcontentloaded', timeout: 30000 });
          await waitForLogin(page, signal);
          if (!member.self) await selectMember(page, member);
          const resumed = await retry(() => portalList(page), { signal });
          verifyMemberRefs(
            id,
            resumed.map((c) => c.claimId),
            byMember,
          );
          if (!resumed.some((c) => c.claimId === claimId))
            throw new ScupaError(
              'PROFILE_CHANGED',
              'The claim is no longer listed after signing in again. Start sync again. Downloaded PDFs have been kept.',
            );
          check(signal);
          return await attempt();
        }
      };
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
        const attachmentsFound = await request(() => attachments(page, claim), claim.claimId);
        const directory = path.join(RAW, id, claim.claimId);
        ensureDir(directory);
        const saved = [];
        const counts = { statement: 0, supporting: 0, form: 0 };
        const files = attachmentsFound
          .filter((file) => file.kind !== 'form')
          .map((file) => {
            counts[file.kind]++;
            return {
              ...file,
              document: counts[file.kind],
              filename: `${file.kind}_${counts[file.kind]}_${file.label}.pdf`,
            };
          });
        const progress = downloadProgress(directory, files, {
          lastSync: cfg.lastSync,
          fullRefresh,
        });
        for (const file of files) {
          check(signal);
          const reused = progress.reuse(file);
          if (reused) {
            saved.push(reused);
            emit({
              phase: 'download',
              message: `${member.displayName}: claim ${index + 1} of ${selected.length} — resuming with a verified saved PDF`,
              current: index + 1,
              total: selected.length,
            });
            continue;
          }
          saved.push(
            await request(async () => {
              await pause(250);
              check(signal);
              const body = await downloadPdf(page, context, file.href, {
                onInvalid: (details) => {
                  // A rejected body may contain an SSO token. Retain only typed
                  // metadata in the private archive, never headers or body text.
                  try {
                    ensureDir(REPORTS);
                    fs.appendFileSync(
                      path.join(REPORTS, 'download-errors.jsonl'),
                      JSON.stringify({
                        schemaVersion: 1,
                        at: new Date().toISOString(),
                        member: id,
                        claim: claim.claimId,
                        kind: file.kind,
                        document: file.document,
                        ...details,
                      }) + '\n',
                      { mode: 0o600 },
                    );
                  } catch {
                    /* Diagnostics must not replace the download error. */
                  }
                },
                onFallback: () =>
                  emit({
                    phase: 'download',
                    message:
                      'Bupa returned an incomplete document. Retrying it through the Bupa browser…',
                  }),
              });
              check(signal);
              const name = archivePdf(directory, file.filename, body);
              progress.save(file, name);
              return name;
            }, claim.claimId),
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
