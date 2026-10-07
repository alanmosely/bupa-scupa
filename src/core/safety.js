import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite, md5 } from './util.js';

export function resolveNavigationHref(links, needle, baseUrl) {
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
    const matches = needle.startsWith('/')
      ? pathname(url.pathname) === pathname(needle)
      : norm(link.text).includes(want) ||
        norm(link.title).includes(want) ||
        norm(link.href).includes(want);
    if (matches) return link.href;
  }
  return null;
}

export function validatePdf(body) {
  if (
    !Buffer.isBuffer(body) ||
    !body.subarray(0, 1024).includes(Buffer.from('%PDF-')) ||
    !body.subarray(-4096).includes(Buffer.from('%%EOF'))
  ) {
    throw new Error('Download is not a complete PDF (possible login page or truncated response)');
  }
}

// Changed content gets a new filename; identical downloads leave the archive alone.
export function archivePdf(directory, filename, body) {
  validatePdf(body);
  const destination = path.join(directory, filename);
  if (!fs.existsSync(destination)) {
    atomicWrite(destination, body);
    return filename;
  }
  if (fs.readFileSync(destination).equals(body)) return filename;
  const revision = `${path.basename(filename, '.pdf')}__revision_${md5(body)}.pdf`;
  const revisionPath = path.join(directory, revision);
  if (!fs.existsSync(revisionPath)) atomicWrite(revisionPath, body);
  return revision;
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

export async function retry(operation, { attempts = 3, delayMs = 500 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || error.retryable === false) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}
