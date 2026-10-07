import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { create } from 'tar';
import { verifyFfmpegSource, ffmpegLock, sourceHash } from '../scripts/ffmpeg-source.js';

test('source content pins ignore timestamps but reject changed files and duplicate paths', async () => {
  fs.mkdirSync('.cache/source-tests', { recursive: true });
  const trial = fs.mkdtempSync(path.resolve('.cache/source-tests/content-'));
  fs.writeFileSync(path.join(trial, 'source.txt'), 'original source');
  async function archive(name, mtime, files = ['source.txt']) {
    const file = path.join(trial, name);
    await create({ cwd: trial, file, gzip: true, mtime: new Date(mtime) }, files);
    return fs.readFileSync(file);
  }
  const original = await archive('original.tar.gz', '2000-01-01');
  const timestamp = await archive('timestamp.tar.gz', '2001-01-01');
  assert.notDeepEqual(original, timestamp);
  const pin = await sourceHash(original, 'tar-content-v1');
  assert.equal(await sourceHash(timestamp, 'tar-content-v1'), pin);
  fs.writeFileSync(path.join(trial, 'source.txt'), 'changed source');
  const changed = await archive('changed.tar.gz', '2000-01-01');
  assert.notEqual(await sourceHash(changed, 'tar-content-v1'), pin);
  const duplicate = await archive('duplicate.tar.gz', '2000-01-01', ['source.txt', 'source.txt']);
  await assert.rejects(sourceHash(duplicate, 'tar-content-v1'), /Duplicate source archive path/);
  await assert.rejects(sourceHash(Buffer.from('broken archive'), 'tar-content-v1'));
});

const source = path.resolve('vendor/ffmpeg');
const available = fs.existsSync(path.join(source, 'PROVENANCE.json'));
test(
  'FFmpeg source and release DLL match; altered source, manifests and DLLs are refused',
  {
    skip:
      !available && process.env.SCUPA_REQUIRE_FFMPEG_SOURCE !== '1'
        ? 'Run npm run vendor to provision the runtime source package'
        : false,
  },
  async () => {
    assert.ok(available, 'The release source package is required');
    const runtime = path.resolve('node_modules/electron/dist');
    await verifyFfmpegSource(source, runtime);
    fs.mkdirSync('.cache/source-tests', { recursive: true });
    const trial = fs.mkdtempSync(path.resolve('.cache/source-tests/run-'));
    const candidate = path.join(trial, 'source');
    const alteredRuntime = path.join(trial, 'runtime');
    fs.mkdirSync(candidate);
    fs.mkdirSync(alteredRuntime);
    fs.writeFileSync(path.join(alteredRuntime, 'ffmpeg.dll'), 'different DLL');
    await assert.rejects(verifyFfmpegSource(source, alteredRuntime), /DLL does not match/);
    // Independent copies prevent these negative checks from changing cached inputs.
    fs.cpSync(source, candidate, { recursive: true });
    fs.writeFileSync(path.join(candidate, 'PROVENANCE.json'), '{}');
    await assert.rejects(verifyFfmpegSource(candidate, runtime), /Stale FFmpeg provenance/);
    fs.copyFileSync(path.join(source, 'PROVENANCE.json'), path.join(candidate, 'PROVENANCE.json'));
    const input = ffmpegLock.sources[0].name;
    fs.writeFileSync(path.join(candidate, input), 'wrong source revision');
    await assert.rejects(verifyFfmpegSource(candidate, runtime), /source integrity failed/);
  },
);
