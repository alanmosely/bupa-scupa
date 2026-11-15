import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { RAW, loadConfig } from './util.js';
import { ScupaError } from './errors.js';

const statementFile = /^statement_\d+_[A-Za-z0-9._-]+\.pdf$/i;
export const documentHash = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function readMetadata(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${path.basename(file)}: ${error.message}`, { cause: error });
  }
}

export function currentClaimFiles(directory) {
  if (fs.lstatSync(directory).isSymbolicLink())
    throw new Error('Linked archive directories are not supported.');
  const manifest = path.join(directory, 'current.json');
  const stat = fs.lstatSync(manifest, { throwIfNoEntry: false });
  // Older interrupted runs could write a checkpoint before their first selection.
  if (!stat && fs.existsSync(path.join(directory, 'download-progress.json'))) return [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const pdfs = entries.filter((file) => file.name.toLowerCase().endsWith('.pdf'));
  if (pdfs.some((file) => !file.isFile())) throw new Error('Archived PDFs must be regular files.');
  const files = pdfs.map((file) => file.name);
  if (!stat) return files;
  if (!stat.isFile()) throw new Error('current.json must be a regular file');
  const current = readMetadata(manifest);
  if (
    current?.schemaVersion !== 1 ||
    (current.legacy !== undefined && typeof current.legacy !== 'boolean') ||
    !Array.isArray(current.files) ||
    new Set(current.files).size !== current.files.length ||
    current.files.some((file) => !files.includes(file))
  )
    throw new Error('invalid or missing PDF entries in current.json');
  return current.files;
}

export function documentReviews(directory) {
  const file = path.join(directory, 'document-reviews.json');
  if (!fs.existsSync(file)) return { supporting: {}, assessments: {} };
  if (fs.lstatSync(file).isSymbolicLink())
    throw new Error('Linked document reviews are not supported.');
  const review = readMetadata(file);
  const assessments = review?.assessments === undefined ? {} : review.assessments;
  if (
    review?.schemaVersion !== 1 ||
    !review.supporting ||
    typeof review.supporting !== 'object' ||
    Array.isArray(review.supporting) ||
    [review.supporting, assessments].some(
      (decisions) =>
        !decisions ||
        typeof decisions !== 'object' ||
        Array.isArray(decisions) ||
        Object.entries(decisions).some(
          ([name, entry]) =>
            !statementFile.test(name) ||
            !/^[a-f0-9]{64}$/.test(entry?.sha256) ||
            typeof entry?.reviewedAt !== 'string',
        ),
    ) ||
    Object.keys(review.supporting).some((name) => Object.hasOwn(assessments, name))
  )
    throw new Error('Invalid document-reviews.json — review decisions cannot be trusted.');
  return { supporting: review.supporting, assessments };
}

/** A scan can move to another attachment slot without changing its bytes. */
export function hasSupportingReview(reviews, sha256) {
  return Object.values(reviews.supporting).some((entry) => entry.sha256 === sha256);
}

/** Resolve only a current statement PDF inside a known member's archive. */
export function resolveDocument(file) {
  if (typeof file !== 'string' || !statementFile.test(file.split('/')[2] || ''))
    throw new ScupaError('INVALID_INPUT', 'Choose a PDF listed in Archive help.');
  return resolveClaimPdf(file);
}

/** Current statements and supporting PDFs, with the same archive boundary as document reviews. */
export function resolveClaimPdf(file) {
  const parts = typeof file === 'string' ? file.split('/') : [];
  if (
    parts.length !== 3 ||
    !/^[A-Za-z0-9_-]+$/.test(parts[0]) ||
    !Object.hasOwn(loadConfig().members, parts[0]) ||
    !/^CL\d{12}$/.test(parts[1]) ||
    !/^(?:statement|supporting)_\d+_[A-Za-z0-9._-]+\.pdf$/i.test(parts[2])
  )
    throw new ScupaError('INVALID_INPUT', 'Choose a PDF listed in Archive help.');
  let absolute = RAW;
  for (const part of ['', ...parts]) {
    absolute = path.join(absolute, part);
    if (fs.lstatSync(absolute).isSymbolicLink())
      throw new ScupaError('INVALID_INPUT', 'Linked archive documents are not supported.');
  }
  if (!currentClaimFiles(path.dirname(absolute)).includes(parts[2]))
    throw new ScupaError('INVALID_INPUT', 'This PDF is no longer current. Recheck saved PDFs.');
  return absolute;
}
