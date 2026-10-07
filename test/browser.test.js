import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchInstalledBrowser } from '../src/core/browser.js';

const options = { headless: false, timeout: 60000 };
test('installed Edge is preferred without starting Chrome', async () => {
  const attempts = [];
  const browser = {};
  const result = await launchInstalledBrowser(options, {
    launch: async (settings) => {
      attempts.push(settings);
      return browser;
    },
  });
  assert.equal(result, browser);
  assert.deepEqual(attempts, [{ ...options, channel: 'msedge' }]);
});
test('Chrome is used when Edge cannot start', async () => {
  const channels = [];
  const browser = {};
  const result = await launchInstalledBrowser(options, {
    launch: async (settings) => {
      channels.push(settings.channel);
      if (settings.channel === 'msedge') throw new Error('Missing or blocked Edge');
      return browser;
    },
  });
  assert.equal(result, browser);
  assert.deepEqual(channels, ['msedge', 'chrome']);
});
test('unavailable browsers produce an actionable error without leaking launch diagnostics', async () => {
  const channels = [];
  await assert.rejects(
    () =>
      launchInstalledBrowser(options, {
        launch: async ({ channel }) => {
          channels.push(channel);
          throw new Error('Private launch details');
        },
      }),
    (error) => {
      assert.equal(error.code, 'BROWSER_UNAVAILABLE');
      assert.match(error.message, /Install or update/);
      assert.doesNotMatch(error.message, /Private launch details/);
      return true;
    },
  );
  assert.deepEqual(channels, ['msedge', 'chrome']);
});
test('cancellation stops fallback and closes a browser that finishes launching late', async () => {
  for (const fails of [false, true]) {
    const controller = new AbortController();
    let attempts = 0,
      closes = 0;
    await assert.rejects(
      () =>
        launchInstalledBrowser(options, {
          signal: controller.signal,
          launch: async () => {
            attempts++;
            controller.abort();
            if (fails) throw new Error('Launch failed after cancellation');
            return {
              close: async () => {
                closes++;
              },
            };
          },
        }),
      { code: 'CANCELLED' },
    );
    assert.equal(attempts, 1);
    assert.equal(closes, fails ? 0 : 1);
    await assert.rejects(
      () =>
        launchInstalledBrowser(options, {
          signal: controller.signal,
          launch: async () => {
            throw new Error('Should not launch');
          },
        }),
      { code: 'CANCELLED' },
    );
  }
});
