import fs from 'node:fs';
import path from 'node:path';
import yazl from 'yazl';
import crypto from 'node:crypto';
import { files, checkProject } from './check.js';
checkProject();
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const zip = new yazl.ZipFile();
const prefix = `bupa-scupa-${pkg.version}/`;
for (const file of files()) zip.addFile(file, prefix + file.replaceAll(path.sep, '/'));
fs.mkdirSync('dist', { recursive: true });
const output = `dist/bupa-scupa-${pkg.version}-source.zip`;
await new Promise((resolve, reject) => {
  const stream = fs.createWriteStream(output);
  stream.on('close', resolve);
  stream.on('error', reject);
  zip.outputStream.on('error', reject);
  zip.outputStream.pipe(stream);
  zip.end();
});
console.log(output);
const executable = `bupa-scupa-${pkg.version}-x64.exe`;
const alias = 'bupa-scupa-x64.exe';
fs.copyFileSync(path.join('dist', executable), path.join('dist', alias));
const releases = [
  executable,
  alias,
  `bupa-scupa-${pkg.version}-x64.zip`,
  `bupa-scupa-${pkg.version}-source.zip`,
];
const lines = releases.map(
  (file) =>
    crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join('dist', file)))
      .digest('hex') +
    '  ' +
    file,
);
fs.writeFileSync('dist/SHA256SUMS.txt', lines.join('\n') + '\n');
