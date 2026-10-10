// Inspect the exact artifacts intended for publication, not the surrounding workspace.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import yauzl from 'yauzl';
import * as asar from '@electron/asar';
import { files, checkProject, checkContent } from './check.js';
import { VERSION } from '../src/version.js';
import { verifyFfmpegSource } from './ffmpeg-source.js';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.equal(VERSION, pkg.version, 'Application and package versions agree');
checkProject();
const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
async function entries(file, visit) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry) => {
        if (entry.fileName.endsWith('/')) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return reject(streamError);
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('error', reject);
          stream.on('end', () => {
            try {
              visit(entry.fileName, Buffer.concat(chunks));
              zip.readEntry();
            } catch (failure) {
              zip.close();
              reject(failure);
            }
          });
        });
      });
      zip.readEntry();
    });
  });
}
const sourceFiles = new Set(files().map((file) => file.replaceAll(path.sep, '/')));
await entries(`dist/bupa-scupa-${VERSION}-source.zip`, (name, content) => {
  const prefix = `bupa-scupa-${VERSION}/`;
  assert.ok(name.startsWith(prefix));
  const relative = name.slice(prefix.length);
  assert.ok(sourceFiles.delete(relative), 'Unexpected or repeated source file: ' + relative);
  assert.equal(hash(content), hash(fs.readFileSync(relative)), 'Stale source file: ' + relative);
});
assert.equal(sourceFiles.size, 0, 'Source ZIP contains every public file');
const unpacked = 'dist/win-unpacked';
await verifyFfmpegSource(path.join(unpacked, 'resources/ffmpeg'), unpacked);
const archive = path.join(unpacked, 'resources/app.asar');
assert.equal(
  hash(asar.extractFile(archive, 'NOTICE')),
  hash(fs.readFileSync('NOTICE')),
  'Stale packaged third-party notices',
);
for (const name of asar.listPackage(archive)) {
  assert.ok(
    !/(?:^|[/\\])(?:data|private|raw|master|reports|test|\.cache)(?:[/\\]|$)/i.test(name),
    'Private/development path in app: ' + name,
  );
  assert.ok(!/(?:household|parsed)\.json$/i.test(name), 'Private config in app');
  if (/^[/\\]src[/\\]/.test(name) && /\.(?:js|cjs|html|css|ts)$/.test(name)) {
    const relative = name.slice(1).replaceAll('\\', '/');
    const content = asar.extractFile(archive, path.normalize(relative));
    checkContent(relative, content.toString('utf8'));
    assert.equal(
      hash(content),
      hash(fs.readFileSync(relative)),
      'Stale packaged application file: ' + relative,
    );
  }
}
const packaged = JSON.parse(asar.extractFile(archive, 'package.json').toString());
assert.equal(packaged.version, VERSION);
for (const name of ['LICENSE', 'NOTICE', 'ThirdPartyNotices.txt'])
  assert.ok(asar.extractFile(archive, path.join('node_modules', 'playwright-core', name)).length);
const required = [
  'LICENSE.electron.txt',
  'LICENSES.chromium.html',
  ...fs
    .readdirSync(path.join(unpacked, 'resources/ffmpeg'))
    .map((file) => 'resources/ffmpeg/' + file),
  'resources/xpdf/COPYING',
  'resources/xpdf/COPYING3',
  'resources/xpdf/README',
  'resources/xpdf/INSTALL',
  'resources/xpdf/xpdf-4.06.tar.gz',
  'resources/xpdf/BUILD.json',
];
for (const file of required)
  assert.ok(fs.statSync(path.join(unpacked, file)).size > 0, 'Missing notice/source: ' + file);
const lock = JSON.parse(fs.readFileSync('vendor-lock.json', 'utf8'));
assert.equal(
  hash(fs.readFileSync(path.join(unpacked, 'resources/xpdf/xpdf-4.06.tar.gz'))),
  lock['xpdf-4.06.tar.gz'],
);
const pdfBuild = JSON.parse(
  fs.readFileSync(path.join(unpacked, 'resources/xpdf/BUILD.json'), 'utf8').replace(/^\ufeff/, ''),
);
assert.equal(pdfBuild.sourceSha256, lock['xpdf-4.06.tar.gz']);
assert.equal(
  pdfBuild.binarySha256,
  hash(fs.readFileSync(path.join(unpacked, 'resources/xpdf/pdftotext.exe'))),
);
assert.deepEqual(pdfBuild.optionalLibraries, []);
const zipPaths = new Set();
await entries(`dist/bupa-scupa-${VERSION}-x64.zip`, (name, content) => {
  assert.ok(!name.split('/').includes('.links'), 'Build-machine browser metadata must not ship');
  assert.ok(!/(?:^|\/)(?:household|parsed)\.json$/i.test(name), 'Private config must not ship');
  zipPaths.add(name);
  assert.equal(
    hash(content),
    hash(fs.readFileSync(path.join(unpacked, name))),
    'ZIP differs from tested application: ' + name,
  );
});
for (const file of required) assert.ok(zipPaths.has(file), 'Missing ZIP notice: ' + file);
assert.ok(
  ![...zipPaths].some((file) =>
    /^(?:resources\/browser\/|.*\/(?:chrome|msedge)\.exe$)/i.test(file),
  ),
  'Sync browsers must not be redistributed; use installed Edge or Chrome',
);
assert.ok(
  ![...zipPaths].some((file) => /(?:^|\/)ffmpeg-[^/]+\//.test(file)),
  'Unused Playwright video recorder must not ship',
);
const expectedReleases = new Set([
  `bupa-scupa-${VERSION}-source.zip`,
  `bupa-scupa-${VERSION}-x64.zip`,
  'bupa-scupa-x64.exe',
]);
for (const line of fs.readFileSync('dist/SHA256SUMS.txt', 'utf8').trim().split('\n')) {
  const [expected, file] = line.split('  ');
  assert.ok(expectedReleases.delete(file), 'Unexpected or repeated release checksum: ' + file);
  assert.equal(
    hash(fs.readFileSync(path.join('dist', file))),
    expected,
    'Release checksum: ' + file,
  );
}
assert.equal(expectedReleases.size, 0, 'Checksums cover every release artifact');
console.log(
  'Release checks passed: exact source ZIP, packaged source, runtime notices, matching FFmpeg source and DLL, Xpdf source hash, no bundled sync browser, ZIP parity and release checksums. Full live acceptance remains a separate check.',
);
