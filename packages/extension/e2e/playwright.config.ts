import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: './playwright-report', open: 'never' }],
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
});
