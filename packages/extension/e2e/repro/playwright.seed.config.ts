import { defineConfig } from '@playwright/test';

/**
 * Standalone config for `seedDev.ts` — the manual DnD click-around seed tool.
 * `testMatch` deliberately only picks up `seedDev.ts`, so `pnpm test:e2e` and
 * `pnpm repro:dnd` (which matches `*.repro.ts`) never run it. It opens a headed,
 * persistent Chrome and blocks until the user closes it.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/seedDev.ts',
  // Under e2e/test-results/ so the existing gitignore rule covers artifacts + the
  // persistent user-data-dir the runner writes to (test-results/seed-profile).
  outputDir: '../test-results/seed',
  reporter: [['list']],
  timeout: 0, // the runner controls its own lifetime
  retries: 0,
  workers: 1,
  use: {
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
});
