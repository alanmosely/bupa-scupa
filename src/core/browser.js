import { chromium } from 'playwright-core';
import { ScupaError } from './errors.js';

/**
 * Use a fresh Playwright session in an installed browser, never a personal profile.
 * @param {import('playwright-core').LaunchOptions} options
 * @param {{signal?: AbortSignal, launch?: typeof chromium.launch}} [dependencies]
 */
export async function launchInstalledBrowser(
  options,
  { signal, launch = (settings) => chromium.launch(settings) } = {},
) {
  for (const channel of ['msedge', 'chrome']) {
    if (signal?.aborted) throw new ScupaError('CANCELLED', 'Sync cancelled.');
    let browser;
    try {
      browser = await launch({ ...options, channel });
    } catch {
      continue;
    }
    if (signal?.aborted) {
      await browser.close();
      throw new ScupaError('CANCELLED', 'Sync cancelled.');
    }
    return browser;
  }
  if (signal?.aborted) throw new ScupaError('CANCELLED', 'Sync cancelled.');
  throw new ScupaError(
    'BROWSER_UNAVAILABLE',
    'SCUPA could not start Microsoft Edge or Google Chrome. Install or update either browser and retry. On a managed computer, browser policies may prevent automation.',
  );
}
