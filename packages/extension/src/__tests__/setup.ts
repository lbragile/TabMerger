import '@testing-library/jest-dom'
import { vi, beforeEach } from 'vitest'

// ponytail: minimal chrome.* stub so any module touched transitively (e.g. supabase.ts's
// chrome.storage.local auth adapter) doesn't crash tests that never intended to exercise
// chrome APIs. Individual test files that need specific chrome behavior (tabs, windows,
// tabGroups, etc.) still set their own `global.chrome = {...}` — this only fills gaps.
if (!(globalThis as { chrome?: unknown }).chrome) {
  ;(globalThis as { chrome?: unknown }).chrome = {}
}
const chromeStub = (globalThis as { chrome: Record<string, unknown> }).chrome
// ponytail: real in-memory Map behind storage.local (not just resolved-{} stubs like
// sync below) — encryptionKey.ts persists the (base64-exported) data key through
// get/set/remove and several tests assert that value survives a `vi.resetModules()`
// module reset, so the stub needs actual read-your-writes semantics, not a canned
// empty response. Moved here from storage.session when unlock persistence switched
// from session (cleared on browser restart) to local (disk-persisted, survives restart)
// — see encryptionKey.ts module comment.
const localStore = new Map<string, unknown>()
chromeStub.storage ??= {
  local: {
    get: vi.fn(async (key: string) => (localStore.has(key) ? { [key]: localStore.get(key) } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) localStore.set(k, v)
    }),
    remove: vi.fn(async (key: string) => {
      localStore.delete(key)
    }),
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  sync: {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
  },
  session: {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}
// ponytail: localStore is module-scope (created once per test file), so without this it
// leaks a cached key from one test into the next unrelated test's "should be locked"
// assertion — clear the read-your-writes data between tests, independent of vi.clearAllMocks()
// (which only resets call history, not the fake store's contents).
beforeEach(() => {
  localStore.clear()
})
