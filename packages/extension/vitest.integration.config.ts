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

// The three suites that talk to a REAL Supabase (the local stack, see .env.test) share one test
// user: signOut()/wipes/keys of one file break another running at the same time. They run in their
// own project with file parallelism OFF; every other (fake-indexeddb / faked Supabase) file keeps
// running in parallel in the 'fake' project.
const REAL_NETWORK_SUITES = [
  'src/__tests__/integration/syncEngine.integration.test.ts',
  'src/__tests__/integration/encryption.integration.test.ts',
  'src/__tests__/integration/syncCas.real.integration.test.ts'
]

const shared = {
  environment: 'jsdom' as const,
  globals: true,
  setupFiles: ['./src/__tests__/integration/setup.ts'],
  testTimeout: 15000
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: { ...shared, name: 'fake', include: ['src/__tests__/integration/**/*.integration.test.{ts,tsx}'], exclude: ['**/node_modules/**', ...REAL_NETWORK_SUITES] }
      },
      {
        extends: true,
        test: { ...shared, name: 'real', include: REAL_NETWORK_SUITES, fileParallelism: false }
      }
    ]
  },
})
