import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import Ajv from 'ajv';
import { API } from '../src/agent.js';
import { syntheticPdf, statement, REF } from '../test/fixtures.js';
fs.mkdirSync('.cache/agent-smoke', { recursive: true });
const testDir = fs.mkdtempSync(path.resolve('.cache/agent-smoke/run-'));
const archive = path.join(testDir, 'private archive');
fs.mkdirSync(archive);
fs.writeFileSync(
  path.join(archive, 'household.json'),
  JSON.stringify({
    schemaVersion: 1,
    baseUrl: 'https://membersworld.bupaglobal.com',
    members: { m_demo: { displayName: 'Example Person', self: true } },
    watchlist: [],
  }),
);
const raw = path.join(archive, 'raw', 'm_demo', REF);
fs.mkdirSync(raw, { recursive: true });
fs.writeFileSync(path.join(raw, 'statement_1_demo.pdf'), syntheticPdf(statement()));
const portable = process.argv.includes('--portable');
const exe = path.resolve(portable ? 'dist/bupa-scupa-x64.exe' : 'dist/win-unpacked/BUPA SCUPA.exe');
const ajv = new Ajv({ strict: true });
const schemas = Object.fromEntries(
  Object.entries(API.schemas.responses).map(([command, value]) => [command, ajv.compile(value)]),
);
const eventValid = ajv.compile(API.schemas.event);
async function launch(command, extra) {
  const child = spawn(exe, ['--agent', command, '--data-dir', archive, ...extra], {
    env: {
      ...process.env,
      PATH: path.join(process.env.SystemRoot, 'System32'),
      SCUPA_APP_DIR: path.join(testDir, 'preferences'),
    },
    windowsHide: true,
    stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      child.kill();
      reject(new Error('Agent command timed out: ' + command));
    }, 120000);
    child.on('error', (e) => {
      clearTimeout(deadline);
      reject(e);
    });
    child.on('exit', () => {
      clearTimeout(deadline);
      resolve();
    });
  });
}
async function invoke(command, extra = []) {
  const output = path.join(testDir, command + '-' + Date.now() + '.json');
  await launch(command, ['--output', output, ...extra]);
  assert.equal(fs.existsSync(output), true, 'Agent output file exists: ' + command);
  const value = JSON.parse(fs.readFileSync(output, 'utf8'));
  const valid = schemas[command] || schemas.status;
  assert.ok(valid(value), JSON.stringify(valid.errors));
  return value;
}
assert.equal((await invoke('schema')).result.application, 'bupa-scupa');
assert.equal((await invoke('status')).result.claimCount, 0);
const existing = path.join(testDir, 'existing.json');
fs.writeFileSync(existing, '{"previous":true}');
for (const output of [
  existing,
  path.join(testDir, 'missing', 'result.json'),
  path.join(archive, 'result.json'),
]) {
  await launch('parse', ['--output', output]);
  assert.equal(fs.existsSync(path.join(archive, 'master', 'claims.csv')), false);
  assert.equal(fs.existsSync(path.join(archive, 'parsed.json')), false);
}
assert.equal(fs.readFileSync(existing, 'utf8'), '{"previous":true}');
const events = path.join(testDir, 'preview-events.jsonl');
const preview = await invoke('parse', ['--dry-run', '--events', events]);
assert.equal(preview.ok, true);
assert.equal(preview.result.added, 1);
assert.equal(fs.existsSync(path.join(archive, 'master', 'claims.csv')), false);
assert.equal(preview.result.changes.added[0].paid, '80.0');
const log = fs.readFileSync(events, 'utf8').trim().split('\n').map(JSON.parse);
log.forEach((e) => assert.ok(eventValid(e), JSON.stringify(eventValid.errors)));
assert.equal(log.at(-1).state, 'succeeded');
assert.equal(log.at(-1).jobId, preview.jobId);
assert.equal((await invoke('parse')).result.added, 1);
const report = await invoke('report');
assert.equal(report.result.totals.GBP.paid, 80);
const claims = await invoke('claims');
assert.equal(claims.result.rows[0].claim_ref, REF);
assert.equal((await invoke('parse')).result.added, 0);
const invalid = await invoke('claims', ['--member', 'unknown_member']);
assert.equal(invalid.ok, false);
assert.equal(invalid.error.code, 'INVALID_INPUT');
const invalidCommand = await invoke('not-a-command');
assert.equal(invalidCommand.ok, false);
assert.equal(invalidCommand.error.code, 'INVALID_INPUT');
console.log(
  `${portable ? 'Portable EXE' : 'Packaged EXE'} agent smoke passed: JSON Schema contracts, output preflight, dry-run changes, progress events, status, merge, report, claims, idempotence, structured errors. Child PATH contains only Windows system tools.`,
);
