import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@tabmerger/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    // ponytail: 'scripts/**' covers build-tooling tests (e.g. the semver->manifest-version
    // mapping in scripts/manifestVersion.ts) that intentionally live outside src/ — it's
    // release-pipeline logic, not app logic, so it's also excluded from coverage.include below.
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.{test,spec}.{ts,tsx}'],
    // ponytail: integration tests (real IndexedDB / real Supabase) run via vitest.integration.config.ts only;
    // build tests (real `wxt build` runs, minutes each) via vitest.build.config.ts (`pnpm test:manifest`)
    exclude: ['**/node_modules/**', 'src/__tests__/integration/**', 'src/__tests__/manifest/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/**/*.d.ts', 'src/components/ui/**', 'src/__tests__/integration/**', 'src/__tests__/manifest/**'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
      reporter: ['text', 'json-summary', 'json'], // json-summary → coverage/coverage-summary.json, consumed by scripts/ci/coverage-delta.mjs
    },
  },
})
