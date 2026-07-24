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
}
