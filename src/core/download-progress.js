import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWrite } from './util.js';
import { validatePdf } from './safety.js';
import { BUPA_ORIGIN } from './model.js';

const maxAge = 24 * 60 * 60 * 1000;
const hash = (body) => crypto.createHash('sha256').update(body).digest('hex');
const safeName = /^(?:statement|supporting)_\d+_[A-Za-z0-9._-]+\.pdf$/;

/**
 * A short-lived download checkpoint, independent of payment approval and merge.
 * @param {string} directory
 * @param {Array<{href: string, filename: string}>} files
 * @param {{lastSync?: string, fullRefresh?: boolean, now?: number}} [options]
 */
export function downloadProgress(directory, files, options = {}) {
  const { lastSync, fullRefresh = false, now = Date.now() } = options;
  if (fs.lstatSync(directory).isSymbolicLink())
    throw new Error('Linked download folders are not supported.');
  const checkpoint = path.join(directory, 'download-progress.json');
  const after = lastSync === undefined ? 0 : Date.parse(lastSync);
  const recent = (value) => {
    const time = Date.parse(value);
    return time > after && time <= now && now - time <= maxAge;
  };
  const regular = (file) => {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Not a regular file');
    return stat;
  };
  const readPdf = (name) => {
    if (!safeName.test(name)) throw new Error('Invalid PDF filename');
    const file = path.join(directory, name);
    if (regular(file).size > 64 * 1024 * 1024) throw new Error('PDF too large');
    const body = fs.readFileSync(file);
    validatePdf(body);
    return body;
  };
  // Store a one-way identifier, never the authenticated download URL.
  const source = (file) => {
    const url = new URL(file.href);
    if (
      url.origin !== BUPA_ORIGIN ||
      url.pathname !== '/api/sitecore/Plan/DownloadFile' ||
      !url.searchParams.get('fileId')
    )
      throw new Error('Unexpected document link.');
    return hash(url.searchParams.get('fileId'));
  };
  const sources = new Set(files.map(source));
  let entries = [];
  try {
    regular(checkpoint);
    const saved = JSON.parse(fs.readFileSync(checkpoint, 'utf8'));
    if (saved.schemaVersion === 1 && Array.isArray(saved.files))
      entries = saved.files.filter((entry) => sources.has(entry.source));
  } catch {
    /* Missing or damaged progress means download again. */
  }
  if (fullRefresh) {
    entries = [];
    atomicWrite(checkpoint, JSON.stringify({ schemaVersion: 1, files: [] }, null, 2));
  }

  // Older versions committed current.json only after the entire claim completed.
  // Adopt a recent interrupted claim only when its complete filename set matches
  // the freshly fetched attachment list. Never adopt loose or partial PDFs.
  let legacy = [];
  if (!fullRefresh && !fs.existsSync(checkpoint)) {
    try {
      const current = path.join(directory, 'current.json');
      const stat = regular(current);
      const saved = JSON.parse(fs.readFileSync(current, 'utf8'));
      if (
        saved.schemaVersion === 1 &&
        recent(stat.mtime.toISOString()) &&
        Array.isArray(saved.files) &&
        saved.files.length === files.length &&
        new Set(saved.files).size === saved.files.length
      ) {
        const matches = files.map((file) =>
          saved.files.filter(
            (name) =>
              typeof name === 'string' &&
              (name === file.filename ||
                (name.startsWith(file.filename.slice(0, -4) + '__revision_') &&
                  /^[a-f0-9]{32}\.pdf$/.test(name.slice(file.filename.length - 4 + 11)))),
          ),
        );
        if (
          matches.every((names) => names.length === 1) &&
          new Set(matches.flat()).size === files.length
        ) {
          legacy = files.map((file, index) => {
            const name = matches[index][0];
            const body = readPdf(name);
            return {
              source: source(file),
              filename: file.filename,
              file: name,
              sha256: hash(body),
              bytes: body.length,
              downloadedAt: stat.mtime.toISOString(),
            };
          });
        }
      }
    } catch {
      /* An incomplete legacy claim must be downloaded again. */
    }
  }
  const save = (file, name, downloadedAt = new Date().toISOString()) => {
    const body = readPdf(name);
    const id = source(file);
    entries = entries.filter((entry) => entry.source !== id);
    entries.push({
      source: id,
      filename: file.filename,
      file: name,
      sha256: hash(body),
      bytes: body.length,
      downloadedAt,
    });
    atomicWrite(checkpoint, JSON.stringify({ schemaVersion: 1, files: entries }, null, 2));
  };
  return {
    save,
    reuse(file) {
      if (fullRefresh) return null;
      const entry = [...entries, ...legacy].find(
        (entry) =>
          entry.source === source(file) &&
          entry.filename === file.filename &&
          recent(entry.downloadedAt),
      );
      if (!entry) return null;
      try {
        const body = readPdf(entry.file);
        if (body.length !== entry.bytes || hash(body) !== entry.sha256) return null;
        save(file, entry.file, entry.downloadedAt);
        return entry.file;
      } catch {
        return null;
      }
    },
  };
}
