// electron-builder 26.15.3's portable template initialises its plugin directory
// in .onGUIInit, which silent launches skip. Prepare the directory before any
// runtime path is constructed, including the direct-file extraction mode.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const template = path.join(root, 'node_modules/app-builder-lib/templates/nsis/portable.nsi');
const portable = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build
  .portable;
if (portable.unpackDirName !== true || portable.useZip !== true)
  throw new Error(
    'Portable builds require direct extraction and a private directory for each launch.',
  );
const originalSha256 = '80fa75cf8cb68f4999eb92afc9f37f8e5b605cb1c3a077821bbc350a9b907a48';
const initialise =
  'Function .onInit\n  InitPluginsDir\n  StrCmp $PLUGINSDIR "" 0 +3\n    SetErrorLevel 3\n    Quit\n';
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
const current = fs.readFileSync(template, 'utf8');
// Permit only the locked upstream source or this exact, reversible patch.
const original =
  current.startsWith('!include') && current.includes(initialise)
    ? current.replace(initialise, 'Function .onInit\n')
    : current;
if (hash(original) !== originalSha256)
  throw new Error(
    'Unexpected portable launcher template; review the pinned builder before patching.',
  );
const patched = original.replace('Function .onInit\n', initialise);
if (patched === original) throw new Error('Portable launcher initialisation was not prepared.');
if (current !== patched) fs.writeFileSync(template, patched);
console.log(
  'Verified portable template: silent startup initialises a private runtime directory and fails closed if unavailable.',
);
