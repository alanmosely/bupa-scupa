import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Ajv from 'ajv';
import { API, parseArgs, createAgentSession, reserveResult } from '../src/agent.js';
import { REF, statement, convertedStatement, syntheticPdf, approveAssessment } from './fixtures.js';

const ajv = new Ajv({ strict: true });
const responses = Object.fromEntries(
  Object.entries(API.schemas.responses).map(([key, schema]) => [key, ajv.compile(schema)]),
);
const requests = Object.fromEntries(
  Object.entries(API.schemas.requests).map(([key, schema]) => [key, ajv.compile(schema)]),
);
const eventValid = ajv.compile(API.schemas.event);
const validate = (fn, value) => assert.ok(fn(value), JSON.stringify(fn.errors));
const pdfAvailable = fs.existsSync('vendor/xpdf/pdftotext.exe');
fs.mkdirSync('.cache/tests', { recursive: true });
function fixture(text = statement()) {
  const root = fs.mkdtempSync(path.resolve('.cache/tests/contract-'));
  const archive = path.join(root, 'archive');
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
  fs.writeFileSync(path.join(raw, 'statement_1_demo.pdf'), syntheticPdf(text));
  approveAssessment(raw, 'statement_1_demo.pdf');
  return { root, archive, raw, master: path.join(archive, 'master', 'claims.csv') };
}
function invoke(command, archive, args = []) {
  const child = spawnSync(
    process.execPath,
    ['src/agent.js', command, '--data-dir', archive, ...args],
    { encoding: 'utf8', windowsHide: true },
  );
  const value = JSON.parse(child.stdout);
  validate(responses[command], value);
  return { child, value };
}

test('all read and human-required source responses match published JSON schemas', () => {
  const { root, archive } = fixture();
  for (const command of ['schema', 'status', 'claims', 'report', 'sync']) {
    const request = parseArgs([command, '--data-dir', archive]);
    validate(requests[command], request);
    const { child, value } = invoke(command, archive);
    assert.equal(value.ok, command !== 'sync');
    assert.equal(child.status, command === 'sync' ? 3 : 0);
  }
  assert.throws(
    () => parseArgs(['status', '--events', 'relative']),
    (e) => e.code === 'INVALID_INPUT',
  );
  assert.throws(
    () => parseArgs(['status', '--output', root, '--output', root]),
    (e) => e.code === 'INVALID_INPUT',
  );
});

test('full refresh is a sync-only option and still requires a human in source mode', () => {
  const { archive } = fixture();
  const request = parseArgs(['sync', '--full-refresh', '--data-dir', archive]);
  validate(requests.sync, request);
  assert.equal(request.options.fullRefresh, true);
  for (const command of ['schema', 'status', 'claims', 'report', 'parse']) {
    assert.throws(() => parseArgs([command, '--full-refresh']), { code: 'INVALID_INPUT' });
    assert.equal(requests[command]({ command, options: { fullRefresh: true } }), false);
  }
  const { child, value } = invoke('sync', archive, ['--full-refresh']);
  assert.equal(child.status, 3);
  assert.equal(value.error.code, 'HUMAN_ACTION_REQUIRED');
  assert.equal(fs.existsSync(path.join(archive, 'master', 'claims.csv')), false);
});
test(
  'converted PDF amounts survive parsing and the agent contract without mixing currency totals',
  { skip: !pdfAvailable },
  () => {
    const { archive, master } = fixture(convertedStatement());
    const preview = invoke('parse', archive, ['--dry-run']).value;
    assert.equal(preview.ok, true);
    assert.equal(preview.result.changes.added[0].paid_currency, 'GBP');
    assert.equal(fs.existsSync(master), false);
    assert.equal(invoke('parse', archive).value.ok, true);
    const row = invoke('claims', archive).value.result.rows[0];
    assert.equal(row.currency, 'EUR');
    assert.equal(row.claimed, '100.0');
    assert.equal(row.paid_currency, 'GBP');
    assert.equal(row.paid, '64.0');
    assert.equal(row.status, 'Partially Paid');
    const report = invoke('report', archive).value.result;
    assert.equal(report.claimCount, 1);
    assert.deepEqual(report.totals, {
      EUR: { claimed: 100, paid: 0, claims: 1 },
      GBP: { claimed: 0, paid: 64, claims: 1 },
    });
    assert.equal(invoke('parse', archive).value.result.updated, 0);
  },
);

test(
  'invalid response destinations stop parse before any archive changes',
  { skip: !pdfAvailable },
  () => {
    const { root, archive, master } = fixture();
    const old = path.join(root, 'old.json');
    fs.writeFileSync(old, '{"previous":true}');
    for (const output of [
      old,
      path.join(root, 'missing', 'result.json'),
      path.join(archive, 'response.json'),
    ]) {
      const { child, value } = invoke('parse', archive, ['--output', output]);
      assert.notEqual(child.status, 0);
      assert.equal(value.ok, false);
      assert.equal(fs.existsSync(master), false);
      assert.equal(fs.existsSync(path.join(archive, 'parsed.json')), false);
    }
    assert.equal(fs.readFileSync(old, 'utf8'), '{"previous":true}');
  },
);

test('invalid event destination cannot mutate and produces one structured response', () => {
  const { root, archive, master } = fixture();
  const output = path.join(root, 'response.json');
  const events = path.join(root, 'events.jsonl');
  fs.writeFileSync(events, 'old');
  const { child, value } = invoke('parse', archive, ['--output', output, '--events', events]);
  assert.notEqual(child.status, 0);
  assert.equal(value.error.code, 'EEXIST');
  validate(responses.parse, JSON.parse(fs.readFileSync(output, 'utf8')));
  assert.equal(fs.readFileSync(events, 'utf8'), 'old');
  assert.equal(fs.existsSync(master), false);
});

test('a response reservation prevents competing writers before completion', () => {
  const { root, archive } = fixture();
  const output = path.join(root, 'response.json');
  const writer = reserveResult(output, archive);
  assert.equal(fs.readFileSync(output, 'utf8'), '');
  assert.throws(
    () => reserveResult(output, archive),
    (e) => e.code === 'EEXIST',
  );
  writer.write({ ok: true });
  assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).ok, true);
});

test('archive aliases cannot bypass the response destination guard', () => {
  const { root, archive } = fixture();
  const alias = path.join(root, 'alias');
  fs.symlinkSync(archive, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(
    () => reserveResult(path.join(alias, 'response.json'), archive),
    (e) => e.code === 'INVALID_INPUT',
  );
  assert.equal(fs.existsSync(path.join(archive, 'response.json')), false);
});

test(
  'dry runs expose additions and reassessment diffs without changing master',
  { skip: !pdfAvailable },
  () => {
    const { root, archive, raw, master } = fixture();
    const events = path.join(root, 'events.jsonl');
    const preview = invoke('parse', archive, ['--dry-run', '--events', events]).value;
    assert.equal(preview.result.changes.added[0].paid, '80.0');
    assert.equal(fs.existsSync(master), false);
    invoke('parse', archive);
    const before = fs.readFileSync(master);
    fs.writeFileSync(
      path.join(raw, 'statement_2_revision.pdf'),
      syntheticPdf(statement({ paid: '100.00', date: '03/01/2000' })),
    );
    const unreviewed = invoke('parse', archive).value;
    assert.equal(unreviewed.ok, false);
    assert.equal(unreviewed.error.code, 'PARSE_FAILED');
    assert.deepEqual(fs.readFileSync(master), before);
    approveAssessment(raw, 'statement_2_revision.pdf');
    const next = invoke('parse', archive, ['--dry-run']).value;
    assert.equal(next.result.updated, 1);
    assert.deepEqual(
      next.result.changes.updated[0].diffs.find((d) => d.field === 'paid'),
      { field: 'paid', from: '80.0', to: '100.0' },
    );
    assert.deepEqual(fs.readFileSync(master), before);
    const log = fs.readFileSync(events, 'utf8').trim().split('\n').map(JSON.parse);
    log.forEach((item) => validate(eventValid, item));
    assert.deepEqual(
      log.map((e) => e.sequence),
      [1, 2],
    );
    assert.equal(log[1].state, 'succeeded');
    assert.equal(log[0].jobId, preview.jobId);
    assert.equal(fs.readFileSync(events, 'utf8').includes('Example Person'), false);
  },
);

test('agent events distinguish human gates, completion and cancellation without portal text', () => {
  const { root, archive } = fixture();
  const events = path.join(root, 'events.jsonl');
  const session = createAgentSession('sync', { events }, archive);
  session.event({
    phase: 'login',
    state: 'waiting_for_human',
    humanAction: 'LOGIN_MFA',
    message: 'private portal text',
  });
  session.event({
    phase: 'confirm',
    state: 'waiting_for_human',
    humanAction: 'CONFIRM_HOUSEHOLD',
    names: ['Example Person'],
  });
  const final = JSON.parse(session.finish(null, { code: 'CANCELLED', message: 'Cancelled.' }));
  validate(responses.sync, final);
  const log = fs.readFileSync(events, 'utf8').trim().split('\n').map(JSON.parse);
  log.forEach((e) => validate(eventValid, e));
  assert.equal(log[0].humanAction, 'LOGIN_MFA');
  assert.equal(log[1].humanAction, 'CONFIRM_HOUSEHOLD');
  assert.equal(log[2].state, 'cancelled');
  assert.equal(log[2].jobId, final.jobId);
  assert.equal(fs.readFileSync(events, 'utf8').includes('private portal text'), false);
  assert.equal(fs.readFileSync(events, 'utf8').includes('Example Person'), false);
});
