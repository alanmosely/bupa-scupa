// Ship the source and build materials for the exact FFmpeg DLL in our Electron runtime.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ffmpegLock = JSON.parse(
  fs.readFileSync(path.join(root, 'vendor-lock.json'), 'utf8'),
).electronFfmpeg;
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (file) => fs.readFileSync(file, 'utf8');
function tarFile(archive, name) {
  const result = spawnSync('tar', ['-xOf', archive, name], {
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Cannot read source archive entry: ' + name);
  return result.stdout;
}
function provenance() {
  return JSON.stringify({ schemaVersion: 1, ...ffmpegLock }, null, 2) + '\n';
}

export function verifyFfmpegSource(directory, runtime) {
  const lock = ffmpegLock;
  const pkg = JSON.parse(read(path.join(root, 'package.json')));
  assert.equal(pkg.devDependencies.electron, lock.version, 'Electron source pin is stale');
  if (fs.existsSync(path.join(runtime, 'version')))
    assert.equal(read(path.join(runtime, 'version')).trim().replace(/^v/, ''), lock.version);
  assert.equal(
    hash(fs.readFileSync(path.join(runtime, 'ffmpeg.dll'))),
    lock.binarySha256,
    'FFmpeg DLL does not match the pinned Electron release',
  );
  for (const source of lock.sources) {
    assert.equal(
      hash(fs.readFileSync(path.join(directory, source.name))),
      source.sha256,
      'FFmpeg source integrity failed: ' + source.name,
    );
  }
  const expected = [
    ...lock.sources.map(({ name }) => name),
    'COPYING.LGPLv2.1',
    'README.md',
    'PROVENANCE.json',
  ];
  assert.deepEqual(
    fs.readdirSync(directory).sort(),
    expected.sort(),
    'Unexpected FFmpeg source files',
  );
  assert.equal(
    read(path.join(directory, 'PROVENANCE.json')),
    provenance(),
    'Stale FFmpeg provenance',
  );
  assert.equal(read(path.join(directory, 'README.md')), read(path.join(root, 'docs/FFMPEG.md')));
  const sourceFor = (checkout) =>
    path.join(directory, lock.sources.find((source) => source.checkout === checkout).name);
  const electron = sourceFor('src/electron');
  const ffmpeg = sourceFor('src/third_party/ffmpeg');
  const electronFile = (name) => tarFile(electron, `electron-${lock.version}/${name}`).toString();
  assert.ok(electronFile('DEPS').includes(`'${lock.chromium}'`));
  const deps = read(sourceFor('src/DEPS'));
  assert.ok(deps.includes(`'${lock.revision}'`));
  assert.ok(deps.includes(`'${lock.nasm}'`));
  assert.match(electronFile('build/args/release.gn'), /is_component_ffmpeg = true/);
  assert.match(electronFile('build/args/all.gn'), /ffmpeg_branding = "Chrome"/);
  const config = tarFile(ffmpeg, 'chromium/config/Chrome/win/x64/config.h').toString();
  for (const name of ['GPL', 'GPLV3', 'NONFREE'])
    assert.match(config, new RegExp(`#define CONFIG_${name} 0\\b`));
  assert.match(config, /#define CONFIG_LIBOPUS 1/);
  assert.deepEqual(
    tarFile(ffmpeg, 'COPYING.LGPLv2.1'),
    fs.readFileSync(path.join(directory, 'COPYING.LGPLv2.1')),
  );
  const sums = read(path.join(directory, 'electron-SHASUMS256.txt'));
  assert.ok(sums.includes(`${lock.runtimeArchive.sha256} *${lock.runtimeArchive.name}`));
}

export async function prepareFfmpegSource() {
  const cache = path.join(root, '.cache/downloads');
  const destination = path.join(root, 'vendor/ffmpeg');
  fs.mkdirSync(cache, { recursive: true });
  fs.mkdirSync(destination, { recursive: true });
  for (const source of ffmpegLock.sources) {
    const cached = path.join(cache, source.name);
    if (!fs.existsSync(cached)) {
      console.log('Downloading ' + source.name);
      const response = await fetch(source.url, { signal: AbortSignal.timeout(180000) });
      if (!response.ok) throw new Error('Source download failed: HTTP ' + response.status);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(hash(bytes), source.sha256, 'Source download integrity failed: ' + source.name);
      fs.writeFileSync(cached, bytes);
    }
    assert.equal(
      hash(fs.readFileSync(cached)),
      source.sha256,
      'Source cache integrity failed: ' + source.name,
    );
    fs.copyFileSync(cached, path.join(destination, source.name));
  }
  const ffmpeg = ffmpegLock.sources.find((source) => source.checkout === 'src/third_party/ffmpeg');
  fs.writeFileSync(
    path.join(destination, 'COPYING.LGPLv2.1'),
    tarFile(path.join(destination, ffmpeg.name), 'COPYING.LGPLv2.1'),
  );
  fs.copyFileSync(path.join(root, 'docs/FFMPEG.md'), path.join(destination, 'README.md'));
  fs.writeFileSync(path.join(destination, 'PROVENANCE.json'), provenance());
  verifyFfmpegSource(destination, path.join(root, 'node_modules/electron/dist'));
  console.log('Verified Electron FFmpeg source, dependencies, build materials and DLL provenance.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await prepareFfmpegSource();
