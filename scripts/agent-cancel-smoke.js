import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import Ajv from 'ajv';
import { API } from '../src/agent.js';
fs.mkdirSync('.cache/agent-cancel', { recursive: true });
const ajv = new Ajv({ strict: true });
const validEvent = ajv.compile(API.schemas.event);
const validResponse = ajv.compile(API.schemas.responses.sync);
const development = process.argv.includes('--development');
for (const scenario of ['missing', 'empty', 'configured', 'full-refresh']) {
  const fullRefresh = scenario === 'full-refresh';
  const configured = scenario === 'configured' || fullRefresh;
  const folder = fs.mkdtempSync(path.resolve('.cache/agent-cancel/run-'));
  const archive = path.join(folder, 'archive');
  const output = path.join(folder, 'response.json');
  const events = path.join(folder, 'events.jsonl');
  if (scenario !== 'missing') {
    fs.mkdirSync(archive);
    fs.writeFileSync(
      path.join(archive, 'household.json'),
      JSON.stringify({
        schemaVersion: 1,
        baseUrl: 'https://membersworld.bupaglobal.com',
        members: configured ? { m_demo: { displayName: 'Example Person', self: true } } : {},
        watchlist: [],
      }),
    );
  }
  const app = await electron.launch({
    ...(development ? {} : { executablePath: path.resolve('dist/win-unpacked/BUPA SCUPA.exe') }),
    args: [
      ...(development ? ['.'] : []),
      '--agent',
      'sync',
      ...(fullRefresh ? ['--full-refresh'] : []),
      '--data-dir',
      archive,
      '--output',
      output,
      '--events',
      events,
    ],
    env: { ...process.env, SCUPA_APP_DIR: path.join(folder, 'preferences') },
  });
  try {
    const window = await app.firstWindow();
    if (scenario === 'configured') {
      await window.locator('#dashboard').waitFor();
      // Hold the startup snapshot to exercise an immediate click on a slow machine.
      await app.evaluate(() => {
        const { Worker } = process.getBuiltinModule('node:worker_threads');
        const emit = Worker.prototype.emit;
        let held;
        const queued = [];
        globalThis.snapshotHeld = new Promise((resolve) => {
          Worker.prototype.emit = function (event, ...values) {
            if (!held && event === 'message' && Array.isArray(values[0]?.result?.rows)) {
              held = this;
              resolve();
            }
            if (this === held && ['message', 'exit'].includes(event)) {
              const listeners = this.rawListeners(event);
              queued.push(() => listeners.forEach((listener) => listener.apply(this, values)));
              return true;
            }
            return emit.call(this, event, ...values);
          };
        });
        globalThis.releaseSnapshot = () => {
          Worker.prototype.emit = emit;
          for (const deliver of queued) deliver();
        };
      });
      await window.reload();
      await app.evaluate(() => globalThis.snapshotHeld);
      try {
        assert.equal(
          await window.locator('#sync').isEnabled(),
          false,
          'Sync waits for archive loading',
        );
      } finally {
        await app.evaluate(() => globalThis.releaseSnapshot());
      }
    }
    if (configured) {
      await window.locator('#sync').waitFor();
      if (fullRefresh)
        await window
          .locator('#message')
          .filter({ hasText: 'An agent requested a full refresh of all available claims.' })
          .waitFor();
      await window.locator('#sync').click();
      await window
        .getByText(
          fullRefresh
            ? 'Full refresh: sign in to Bupa, including MFA. All available claims will be checked. Keep the browser open.'
            : 'Sign in to Bupa in the browser window, including MFA. Keep it open.',
        )
        .waitFor();
    } else await window.locator('#setup').waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error('Cancelled agent response was not written.')),
        30000,
      );
      const poll = () => {
        try {
          if (typeof JSON.parse(fs.readFileSync(output, 'utf8')).ok === 'boolean') {
            clearTimeout(deadline);
            resolve();
            return;
          }
        } catch {
          /* Response is reserved until completion. */
        }
        setTimeout(poll, 50);
      };
      poll();
    });
    const result = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'CANCELLED');
    assert.ok(validResponse(result), JSON.stringify(validResponse.errors));
    const log = fs.readFileSync(events, 'utf8').trim().split('\n').map(JSON.parse);
    log.forEach((e) => assert.ok(validEvent(e), JSON.stringify(validEvent.errors)));
    assert.ok(
      log.some(
        (e) =>
          e.state === 'waiting_for_human' &&
          e.humanAction === (configured ? 'LOGIN_MFA' : 'START_SYNC'),
      ),
    );
    assert.equal(log.at(-1).state, 'cancelled');
    assert.equal(log.at(-1).jobId, result.jobId);
    assert.equal(fs.existsSync(path.join(archive, '.scupa-lock')), false);
    assert.equal(fs.existsSync(path.join(archive, 'master', 'claims.csv')), false);
    console.log(
      `Agent ${fullRefresh ? 'full refresh' : 'sync'} cancellation passed with ${configured ? 'manual login' : 'start sync'} pending: schema-valid progress and response, no master changes, lock released.`,
    );
  } catch (error) {
    if (fs.existsSync(output))
      console.error('Synthetic agent response:', fs.readFileSync(output, 'utf8'));
    throw error;
  } finally {
    const deadline = setTimeout(() => app.process().kill(), 5000);
    await app.close().catch(() => {});
    clearTimeout(deadline);
  }
}
