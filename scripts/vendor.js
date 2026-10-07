import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import yauzl from 'yauzl';
import { fileURLToPath } from 'node:url';
import { prepareFfmpegSource } from './ffmpeg-source.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
// Electron 44 downloads its runtime on first use, rather than npm postinstall.
// Bootstrap it here so a fresh source checkout can also build without first starting the UI.
const pdfOnly = process.argv.includes('--pdf-only');
const runtime = pdfOnly
  ? { status: 0 }
  : spawnSync(process.execPath, [path.join(root, 'node_modules', 'electron', 'install.js')], {
      env: { ...process.env, electron_config_cache: path.join(root, '.cache', 'electron') },
      stdio: 'inherit',
      windowsHide: true,
    });
if (runtime.status !== 0) throw new Error('Could not prepare the Electron runtime.');
if (!pdfOnly) await prepareFfmpegSource();
const cache = path.join(root, '.cache', 'downloads');
fs.mkdirSync(cache, { recursive: true });
export const downloads = [
  { name: 'xpdf-tools-win-4.06.zip', url: 'https://dl.xpdfreader.com/xpdf-tools-win-4.06.zip' },
  { name: 'xpdf-4.06.tar.gz', url: 'https://dl.xpdfreader.com/xpdf-4.06.tar.gz' },
];
const lockFile = path.join(root, 'vendor-lock.json');
const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
for (const item of downloads) {
  const target = path.join(cache, item.name);
  if (!fs.existsSync(target)) {
    console.log('Downloading ' + item.name);
    const response = await fetch(item.url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error('Download failed: HTTP ' + response.status);
    fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  }
  const hash = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  if (lock[item.name] !== hash) throw new Error('Vendor integrity check failed for ' + item.name);
}
const destination = path.join(root, 'vendor', 'xpdf');
fs.mkdirSync(destination, { recursive: true });
await new Promise((resolve, reject) =>
  yauzl.open(path.join(cache, downloads[0].name), { lazyEntries: true }, (error, zip) => {
    if (error) return reject(error);
    zip.on('error', reject);
    zip.on('end', resolve);
    zip.readEntry();
    zip.on('entry', (entry) => {
      const name = entry.fileName;
      if (
        name.endsWith('/') ||
        (!/(?:^|\/)bin64\/pdftotext\.exe$/.test(name) &&
          !/(?:^|\/)(?:COPYING\d*|LICENSE|README[^/]*|CHANGES|INSTALL|ANNOUNCE)$/i.test(name) &&
          !/\/doc\/[^/]+$/.test(name))
      ) {
        zip.readEntry();
        return;
      }
      const file = path.join(destination, /\/doc\//.test(name) ? 'doc' : '', path.basename(name));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      zip.openReadStream(entry, (err, input) => {
        if (err) return reject(err);
        const output = fs.createWriteStream(file);
        input.on('error', reject);
        output.on('error', reject);
        output.on('close', () => zip.readEntry());
        input.pipe(output);
      });
    });
  }),
);
if (!fs.existsSync(path.join(destination, 'pdftotext.exe')))
  throw new Error('The expected 64-bit PDF reader was not found.');
fs.copyFileSync(path.join(cache, downloads[1].name), path.join(destination, downloads[1].name));
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(destination, 'SCUPA-LICENSE'));
// Vendoring restores the upstream binary; only build:pdf can attest a local source build.
fs.rmSync(path.join(destination, 'BUILD.json'), { force: true });
console.log(
  pdfOnly
    ? 'Bundled PDF reader is ready. Xpdf corresponding source is included.'
    : 'Electron and the PDF reader are ready. Sync uses installed Edge or Chrome.',
);
