import { test as base, chromium, type BrowserContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Prefer a dev-mode build (`wxt build -m development`) when present: it is bundled
// against `.env.local` (valid local Supabase URL) so the popup actually mounts.
// The default `.output/chrome-mv3` is a production build — if `.env.production`
// still holds placeholder values (`https://<prod-project-ref>.supabase.co`),
// `new URL()` inside supabase-js throws and the popup renders blank.
const EXTENSION_PATH = fs.existsSync(path.resolve(__dirname, '../.output/chrome-mv3-dev'))
  ? path.resolve(__dirname, '../.output/chrome-mv3-dev')
  : path.resolve(__dirname, '../.output/chrome-mv3');

/**
 * Custom Playwright fixture that uses chromium.launchPersistentContext so the
 * extension service worker loads. The default `context` fixture uses
 * browser.newContext() which never loads extensions.
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
