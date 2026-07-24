import '@testing-library/jest-dom'
import 'fake-indexeddb/auto'
import { vi } from 'vitest'

// ponytail: real IndexedDB (fake-indexeddb) is in play here — only chrome.* and network
// (Supabase) get stubbed/gated. Do NOT mock '@/lib/localDb' in any file under this directory.

const makeListener = () => ({ addListener: vi.fn(), removeListener: vi.fn() })

// ponytail: real in-memory backing store (not a static {} stub) — the Supabase auth client
// persists+reads back its session via chrome.storage.local, so a get() that always resolves
// {} looks identical to "session was cleared" and silently drops auth on every request.
const storageBackingStore = new Map<string, unknown>()

;(globalThis as { chrome?: unknown }).chrome = {
  tabs: {
    query: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue({}),
    onCreated: makeListener(),
    onRemoved: makeListener(),
    onUpdated: makeListener(),
    onMoved: makeListener(),
    onDetached: makeListener(),
    onAttached: makeListener(),
  },
  windows: {
    create: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue(undefined),
    onRemoved: makeListener(),
    onFocusChanged: makeListener(),
  },
  runtime: {
    sendMessage: vi.fn().mockResolvedValue(undefined),
  },
  storage: {
    local: {
      get: vi.fn(async (key?: string) => {
        if (key === undefined) return Object.fromEntries(storageBackingStore)
        return storageBackingStore.has(key) ? { [key]: storageBackingStore.get(key) } : {}
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) storageBackingStore.set(k, v)
      }),
      remove: vi.fn(async (key: string) => {
        storageBackingStore.delete(key)
      }),
      onChanged: makeListener(),
    },
    sync: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    },
  },
} as unknown as typeof chrome
