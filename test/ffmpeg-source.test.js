import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyFfmpegSource, ffmpegLock } from '../scripts/ffmpeg-source.js';

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
  () => {
    assert.ok(available, 'The release source package is required');
    const runtime = path.resolve('node_modules/electron/dist');
    verifyFfmpegSource(source, runtime);
    fs.mkdirSync('.cache/source-tests', { recursive: true });
    const trial = fs.mkdtempSync(path.resolve('.cache/source-tests/run-'));
    const candidate = path.join(trial, 'source');
    const alteredRuntime = path.join(trial, 'runtime');
    fs.mkdirSync(candidate);
    fs.mkdirSync(alteredRuntime);
    fs.writeFileSync(path.join(alteredRuntime, 'ffmpeg.dll'), 'different DLL');
    assert.throws(() => verifyFfmpegSource(source, alteredRuntime), /DLL does not match/);
    // Independent copies prevent these negative checks from changing cached inputs.
    fs.cpSync(source, candidate, { recursive: true });
    fs.writeFileSync(path.join(candidate, 'PROVENANCE.json'), '{}');
    assert.throws(() => verifyFfmpegSource(candidate, runtime), /Stale FFmpeg provenance/);
    fs.copyFileSync(path.join(source, 'PROVENANCE.json'), path.join(candidate, 'PROVENANCE.json'));
    const input = ffmpegLock.sources[0].name;
    fs.writeFileSync(path.join(candidate, input), 'wrong source revision');
    assert.throws(() => verifyFfmpegSource(candidate, runtime), /source integrity failed/);
  },
);
