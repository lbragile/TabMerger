import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: './playwright-report', open: 'never' }],
    // CI sets PLAYWRIGHT_JUNIT_OUTPUT_NAME to also write test results for Codecov's Tests
    // tab. Local runs don't set it, so they are unchanged.
    ...(process.env.PLAYWRIGHT_JUNIT_OUTPUT_NAME ? [['junit'] as ['junit']] : []),
  ],
  timeout: 30_000,
  // One retry — general safety margin for CI runner slowness/contention (the URL-rule
  // test used to depend on a real external page; it now uses a local loopback fixture
  // server instead, see core.spec.ts).
  retries: 1,
  use: {
    viewport: { width: 800, height: 600 },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  // Single worker: each test gets its own persistent context via the fixture
  workers: 1,
  // Shard by test, not by spec file. Without this `--shard=N/M` hands out whole files, and
  // the uneven file sizes made the slowest CI shard ~1.5x the fastest. A file that must run
  // in order opts back in with `test.describe.configure({ mode: 'serial' })` (autoBackupFile).
  fullyParallel: true,
});
