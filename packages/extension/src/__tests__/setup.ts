import '@testing-library/jest-dom'
import { vi } from 'vitest'

// ponytail: minimal chrome.* stub so any module touched transitively (e.g. supabase.ts's
// chrome.storage.local auth adapter) doesn't crash tests that never intended to exercise
// chrome APIs. Individual test files that need specific chrome behavior (tabs, windows,
// tabGroups, etc.) still set their own `global.chrome = {...}` — this only fills gaps.
if (!(globalThis as { chrome?: unknown }).chrome) {
  ;(globalThis as { chrome?: unknown }).chrome = {}
}
const chromeStub = (globalThis as { chrome: Record<string, unknown> }).chrome
// ponytail: real in-memory Map behind storage.session (not just resolved-{} stubs like
// local/sync above) — encryptionKey.ts round-trips a CryptoKey through get/set/remove and
// several tests assert that value survives a `vi.resetModules()` module reset, so the stub
// needs actual read-your-writes semantics, not a canned empty response.
const sessionStore = new Map<string, unknown>()
chromeStub.storage ??= {
  local: {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  sync: {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
  },
  session: {
    get: vi.fn(async (key: string) => (sessionStore.has(key) ? { [key]: sessionStore.get(key) } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) sessionStore.set(k, v)
    }),
    remove: vi.fn(async (key: string) => {
      sessionStore.delete(key)
    }),
  },
}
