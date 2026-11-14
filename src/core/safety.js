import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite, md5 } from './util.js';
import { ScupaError } from './errors.js';
import { BUPA_ORIGIN } from './model.js';
import { setTimeout as sleep } from 'node:timers/promises';

/** @param {string | null} [memberId] */
export function resolveNavigationHref(links, needle, baseUrl, memberId = null) {
  const norm = (value) =>
    (value || '')
      .toLowerCase()
      .replace(/dependant/g, 'dependent')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const pathname = (value) =>
    value
      .replace(/^\/en(?=\/)/i, '')
      .replace(/\/$/, '')
      .replace(/dependent/gi, 'dependant');
  const want = norm(needle);
  if (!want) return null;
  for (const link of links) {
    if (!link.href || link.href.startsWith('#')) continue;
    let url;
    try {
      url = new URL(link.href, baseUrl);
    } catch {
      continue;
    }
    if (url.origin !== new URL(baseUrl).origin) continue;
    if (memberId !== null) {
      const ids = [...url.searchParams].filter(([key]) => /^memberid$/i.test(key));
      if (ids.length !== 1 || ids[0][1] !== memberId) continue;
    }
    const matches = needle.startsWith('/')
      ? pathname(url.pathname) === pathname(needle)
      : norm(link.text).includes(want) ||
        norm(link.title).includes(want) ||
        norm(link.href).includes(want);
    if (matches) return link.href;
  }
  return null;
}

const pdfHeaderLine = /^%PDF-\d\.\d[\r\n]/;

export function validatePdf(body) {
  if (Buffer.isBuffer(body) && pdfHeaderLine.test(body.subarray(0, 16).toString('latin1'))) {
    const tail = body.subarray(-4096).toString('latin1');
    const trailer =
      /(?:^|[\r\n])startxref[ \t]*[\r\n]+[ \t]*(\d+)[ \t]*[\r\n]+%%EOF[\x00\t\n\f\r ]*$/.exec(tail);
    const offset = Number(trailer?.[1]);
    if (trailer && offset > 0 && offset < body.length - tail.length + trailer.index) {
      const xref = body.subarray(offset, offset + 4096).toString('latin1');
      // PDFs can use either a cross-reference table or a cross-reference stream.
      const stream = /^\d+\s+\d+\s+obj\s*<<([\s\S]*?)>>\s*stream[\r\n]/.exec(xref);
      if (
        /^xref\s+\d+\s+\d+\s+\d{10}[ \t]+\d{5}[ \t]+[nf]\b/.test(xref) ||
        (stream && /\/Type\s*\/XRef(?:[\s/<[>]|$)/.test(stream[1]))
      )
        return;
    }
  }
  throw new Error('Download is not a complete PDF (possible login page or truncated response)');
}

/** Safe diagnostics only: never return document text, URLs or authentication data. */
export function describeDownload(body, status, contentType = '') {
  const prefix = body.subarray(0, 1024);
  const text = prefix.toString('utf8');
  const pdfHeader = pdfHeaderLine.test(prefix.toString('latin1'));
  const pdfTrailer = /(?:^|[\r\n])%%EOF[\x00\t\n\f\r ]*$/.test(
    body.subarray(-4096).toString('latin1'),
  );
  const format = !body.length
    ? 'empty'
    : pdfHeader
      ? 'pdf'
      : /^\s*(?:<!doctype\s+html|<html|<head|<body|<script|<form)/i.test(text)
        ? 'html'
        : body[0] === 0xff && body[1] === 0xd8
          ? 'jpeg'
          : body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            ? 'png'
            : body[0] === 0x50 && body[1] === 0x4b
              ? 'zip'
              : /^\s*[{[]/.test(text)
                ? 'json'
                : body[0] === 31 && body[1] === 139
                  ? 'gzip'
                  : 'other';
  const mime = String(contentType).split(';')[0].trim().toLowerCase();
  return {
    status,
    bytes: body.length,
    format,
    pdfHeader,
    pdfTrailer,
    contentType: [
      'application/pdf',
      'application/octet-stream',
      'text/html',
      'text/plain',
      'application/json',
      'image/jpeg',
      'image/png',
    ].includes(mime)
      ? mime
      : 'other',
  };
}

// Changed content gets a new filename; identical downloads leave the archive alone.
export function archivePdf(directory, filename, body) {
  validatePdf(body);
  const revision = `${path.basename(filename, '.pdf')}__revision_${md5(body)}`;
  for (let index = 0; ; index++) {
    const name = index === 0 ? filename : `${revision}${index === 1 ? '' : `_${index}`}.pdf`;
    const destination = path.join(directory, name);
    const stat = fs.lstatSync(destination, { throwIfNoEntry: false });
    if (!stat) {
      atomicWrite(destination, body);
      return name;
    }
    if (stat.isFile() && stat.size === body.length && fs.readFileSync(destination).equals(body))
      return name;
  }
}

export function verifyMemberRefs(target, refs, byMember) {
  const foreign = Object.entries(byMember).filter(
    ([member, set]) => member !== target && refs.some((ref) => set.has(ref)),
  );
  if (foreign.length) {
    throw new Error(
      `Claims list contains known refs for ${foreign.map(([member]) => member).join(', ')} — refusing import for ${target}`,
    );
  }
  const known = byMember[target];
  if (known?.size && !refs.some((ref) => known.has(ref))) {
    throw new Error(`Claims list has no known ${target} refs — refusing unverifiable import`);
  }
  return Boolean(known?.size);
}

/**
 * Interpret HTTP failures without exposing portal URLs, response text or cookies.
 * @param {{status: number, url: string, loginPage?: boolean, retryAfter?: string | null}} response
 */
export function validatePortalResponse(
  { status, url, loginPage = false, retryAfter = null },
  request,
) {
  const destination = new URL(url, BUPA_ORIGIN);
  if (
    status === 401 ||
    destination.origin !== BUPA_ORIGIN ||
    /login|sign.?in/i.test(destination.pathname) ||
    loginPage
  )
    throw Object.assign(
      new ScupaError(
        'SESSION_EXPIRED',
        'Bupa signed you out. Sign in again in the browser to continue. Downloaded PDFs have been kept.',
      ),
      { retryable: false },
    );
  if (status >= 200 && status < 300) return;
  const limited = status === 429;
  const retryable = limited || (status >= 500 && status < 600);
  let retryAfterMs = 0;
  if (retryAfter) {
    retryAfterMs = /^\d+(?:\.\d+)?$/.test(retryAfter.trim())
      ? Number(retryAfter) * 1000
      : Math.max(0, Date.parse(retryAfter) - Date.now()) || 0;
  }
  throw Object.assign(
    new ScupaError(
      limited ? 'BUPA_RATE_LIMITED' : 'BUPA_REQUEST_FAILED',
      `Bupa ${limited ? 'limited' : 'could not complete'} the ${request} request (HTTP ${status}). Downloaded PDFs have been kept. Please try sync again later.`,
    ),
    { retryable, retryAfterMs: retryAfterMs || (limited ? 5000 : 0) },
  );
}

/** @param {{attempts?: number, delayMs?: number, signal?: AbortSignal, onRetry?: (error: any, delay: number) => void, wait?: (ms: number, signal?: AbortSignal) => Promise<unknown>}} [options] */
export async function retry(operation, options = {}) {
  const {
    attempts = 3,
    delayMs = 500,
    signal,
    onRetry = () => {},
    wait = (ms, signal) => sleep(ms, undefined, { signal }),
  } = options;
  for (let attempt = 1; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || error.retryable === false) throw error;
      const delay = Math.max(delayMs * 2 ** (attempt - 1), error.retryAfterMs || 0);
      // Do not retry earlier than the server requested, or keep a job waiting
      // indefinitely when it asks for a long cooldown.
      if (delay > 60000) throw error;
      onRetry(error, delay);
      await wait(delay, signal);
    }
  }
}
