import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// ponytail: separate config (not a project field) so `pnpm test` (unit, mocked localDb)
// and `pnpm test:integration` (real IndexedDB via fake-indexeddb, real network for Supabase)
// never run in the same process — the mocked and real localDb worlds must never touch.
//
// Vite's built-in env loading only exposes VITE_-prefixed vars via import.meta.env; it does
// NOT copy arbitrary vars (TEST_USER_EMAIL, TEST_USER_PASSWORD) from .env.test into
// process.env. `vite`/dotenv aren't resolvable as direct deps here, so parse .env.test by
// hand — it's 3 lines and avoids fighting module resolution for something this small.
const envTestPath = path.resolve(__dirname, '.env.test')
if (fs.existsSync(envTestPath)) {
  for (const line of fs.readFileSync(envTestPath, 'utf-8').split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/)
    if (match) {
      const [, key, rawValue = ''] = match
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, '')
    }
  }
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/integration/setup.ts'],
    include: ['src/__tests__/integration/**/*.integration.test.{ts,tsx}'],
    testTimeout: 15000,
  },
})
