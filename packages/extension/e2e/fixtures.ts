import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../.output/chrome-mv3');

/**
 * Custom Playwright fixture that uses chromium.launchPersistentContext so the
 * extension service worker loads. The default `context` fixture uses
 * browser.newContext() which never loads extensions.
 */
export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  // Override the built-in context fixture
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--load-extension=${EXTENSION_PATH}`,
        `--disable-extensions-except=${EXTENSION_PATH}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
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
