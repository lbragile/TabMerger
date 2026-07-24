import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: './playwright-report', open: 'never' }],
  ],
  timeout: 30_000,
  // One retry — the URL-rule test navigates a real external page (github.com) inside the
  // persistent context, which occasionally races with Now Open's live-tab sync.
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
