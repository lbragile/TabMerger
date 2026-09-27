import { defineConfig } from 'vitest/config'

/**
 * Build-output tests: each runs a real `wxt build` and asserts on the emitted manifest.
 * Too slow for the unit suite (minutes, and they overwrite .output/), so they run on demand
 * with `pnpm --filter @tabmerger/extension test:manifest`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/manifest/**/*.build.test.ts'],
    // One build at a time: parallel builds would race on .output/.
    fileParallelism: false,
    testTimeout: 180_000,
  },
})
