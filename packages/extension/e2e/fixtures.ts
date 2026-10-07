import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import { EXTENSION_PATH, CPU_THROTTLE_RATE, EXTRA_CHROMIUM_ARGS } from './extensionPath';

/**
 * Custom Playwright fixture that uses chromium.launchPersistentContext so the
 * extension service worker loads. The default `context` fixture uses
 * browser.newContext() which never loads extensions.
 *
 * Which build is loaded, and the `TM_E2E_*` environment switches, are documented in
 * `./extensionPath.ts`.
 */
export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  // Override the built-in context fixture
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      // `--headless=new` is Chromium's modern headless: it loads MV3 extensions
      // (old headless does not) and keeps CI/local runs windowless. Playwright's
      // own `headless` flag stays false so it doesn't inject old-headless args.
      headless: false,
      args: [
        '--headless=new',
        `--load-extension=${EXTENSION_PATH}`,
        `--disable-extensions-except=${EXTENSION_PATH}`,
        '--no-first-run',
        '--no-default-browser-check',
        ...EXTRA_CHROMIUM_ARGS,
      ],
    });
    if (CPU_THROTTLE_RATE >= 2) {
      const throttle = async (page: Page) => {
        try {
          const session = await context.newCDPSession(page);
          await session.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE_RATE });
        } catch {
          // the page closed before the session attached
        }
      };
      context.on('page', (page) => void throttle(page));
      await Promise.all(context.pages().map(throttle));
    }
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    // Wait for the service worker to register
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    const extensionId = new URL(sw.url()).hostname;
    await use(extensionId);
  },
});

export { expect } from '@playwright/test';
