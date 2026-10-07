import fs from 'fs';
import path from 'path';
import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import { EXTENSION_PATH, CPU_THROTTLE_RATE, EXTRA_CHROMIUM_ARGS, OFFLINE_CHROMIUM_ARG } from './extensionPath';

/** Per-file switches (`test.use({ ... })`) for the browser the fixture launches. */
interface ExtensionOptions {
  /** Folder of the built extension to load. Default: the suite-wide choice in `./extensionPath.ts`. */
  extensionPath: string;
  /**
   * Launch Chromium so that only loopback resolves: no page and no service worker can reach a
   * real host. Requests a test stubs with `page.route` are answered before DNS, so they still work.
   */
  blockNetwork: boolean;
}

/**
 * Custom Playwright fixture that uses chromium.launchPersistentContext so the
 * extension service worker loads. The default `context` fixture uses
 * browser.newContext() which never loads extensions.
 *
 * Which build is loaded, and the `TM_E2E_*` environment switches, are documented in
 * `./extensionPath.ts`.
 */
export const test = base.extend<{ context: BrowserContext; extensionId: string } & ExtensionOptions>({
  extensionPath: [EXTENSION_PATH, { option: true }],
  blockNetwork: [false, { option: true }],

  // Override the built-in context fixture
  context: async ({ extensionPath, blockNetwork }, use) => {
    if (!fs.existsSync(path.join(extensionPath, 'manifest.json'))) {
      throw new Error(`No built extension (manifest.json) in ${extensionPath}. Build it first, see e2e/TEST_CASES.md.`);
    }
    const extraArgs = new Set([...(blockNetwork ? [OFFLINE_CHROMIUM_ARG] : []), ...EXTRA_CHROMIUM_ARGS]);
    const context = await chromium.launchPersistentContext('', {
      // `--headless=new` is Chromium's modern headless: it loads MV3 extensions
      // (old headless does not) and keeps CI/local runs windowless. Playwright's
      // own `headless` flag stays false so it doesn't inject old-headless args.
      headless: false,
      args: [
        '--headless=new',
        `--load-extension=${extensionPath}`,
        `--disable-extensions-except=${extensionPath}`,
        '--no-first-run',
        '--no-default-browser-check',
        ...extraArgs,
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
