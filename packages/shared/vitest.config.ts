import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['src/crypto/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts', 'src/**/*.d.ts'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
      reporter: ['text', 'json-summary', 'json'],
    },
  },
})
