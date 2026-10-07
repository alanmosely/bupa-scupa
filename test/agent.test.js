import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, envelope, exitCode, writeResult } from '../src/agent.js';
test('agent schema is JSON with no browser or health read', () => {
  const r = spawnSync(process.execPath, ['src/agent.js', 'schema'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(r.status, 0);
  const json = JSON.parse(r.stdout);
  assert.equal(json.schemaVersion, 1);
  assert.equal(json.ok, true);
  assert.equal(json.result.commands.status.access, 'read');
});
test('invalid flags and relative paths have a stable failure code', () => {
  assert.throws(
    () => parseArgs(['status', '--data-dir', 'relative']),
    (e) => e.code === 'INVALID_INPUT',
  );
  assert.throws(
    () => parseArgs(['status', '--wat']),
    (e) => e.code === 'INVALID_INPUT',
  );
  assert.equal(exitCode({ code: 'BUSY' }), 4);
  assert.equal(
    envelope('sync', null, { code: 'HUMAN_ACTION_REQUIRED', message: 'Login needed.' }).ok,
    false,
  );
});
test('machine output cannot overwrite a file or the archive', () => {
  fs.mkdirSync('.cache/tests', { recursive: true });
  const p = fs.mkdtempSync(path.resolve('.cache/tests/output-'));
  const file = path.join(p, 'result.json');
  assert.throws(() => writeResult(file, {}, p), /outside/);
  writeResult(file, { ok: true }, path.join(p, 'archive'));
  assert.throws(
    () => writeResult(file, {}, path.join(p, 'archive')),
    (e) => e.code === 'EEXIST',
  );
});
test('offline empty archive report is structured and requires no setup', () => {
  const r = spawnSync(
    process.execPath,
    ['src/agent.js', 'report', '--data-dir', path.resolve('.cache/tests/empty-agent')],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(r.status, 0);
  const json = JSON.parse(r.stdout);
  assert.deepEqual(json.result.totals, {});
  assert.equal(json.result.claimCount, 0);
});

test('member-scoped claims do not reveal other household names', () => {
  fs.mkdirSync('.cache/tests', { recursive: true });
  const archive = fs.mkdtempSync(path.resolve('.cache/tests/scoped-'));
  fs.writeFileSync(
    path.join(archive, 'household.json'),
    JSON.stringify({
      schemaVersion: 1,
      baseUrl: 'https://membersworld.bupaglobal.com',
      members: {
        first: { displayName: 'Example Person', self: true },
        second: { displayName: 'Second Person' },
      },
    }),
  );
  const result = spawnSync(
    process.execPath,
    ['src/agent.js', 'claims', '--data-dir', archive, '--member', 'first'],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(result.status, 0);
  assert.deepEqual(Object.keys(JSON.parse(result.stdout).result.members), ['first']);
  assert.equal(result.stdout.includes('Second Person'), false);
});
