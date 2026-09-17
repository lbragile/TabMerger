import { defineConfig } from '@playwright/test';

/**
 * Standalone config for the ad-hoc DnD repro runners (`*.repro.ts` in this dir).
 * Kept separate from `e2e/playwright.config.ts` so `pnpm test:e2e` never picks
 * these up — they open the real toolbar action popup, are slow, and are for
 * manual inspection rather than CI assertions.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.repro.ts',
  // Under e2e/test-results/ so it's covered by the existing gitignore rule.
  outputDir: '../test-results/repro',
  reporter: [['list']],
  timeout: 180_000,
  retries: 0,
  workers: 1,
  use: {
    viewport: { width: 800, height: 600 },
    screenshot: 'only-on-failure',
    trace: 'off'
  }
});
