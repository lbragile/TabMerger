import { describe, it, expect, vi, beforeEach } from 'vitest'

// Real createClient() spins up a GoTrueClient (with its own auto-refresh timer/lock) per
// call — since this file re-imports '@/lib/supabase' fresh (vi.resetModules) in every test to
// exercise the module-level chromeStorage guard, that would create multiple real GoTrueClient
// instances and trigger "Multiple GoTrueClient instances detected" warnings. Stub createClient
// with a minimal fake so each test still gets a fresh module instance without a real client.
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn((_url: string, _key: string, options: { auth?: { storage?: { getItem: (k: string) => unknown } } }) => {
    // Mimic GoTrueClient's real behavior of reading the persisted session on init, without
    // spinning up its actual auto-refresh timers/locks (see comment above the mock).
    void options?.auth?.storage?.getItem('tabmerger-auth')
    return { auth: {}, from: vi.fn() }
  }),
}))

describe('supabase client chrome.storage adapter', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
  })

  it('initializes and reads the stored session via chrome.storage.local.get', async () => {
    const get = vi.fn().mockResolvedValue({})
    const set = vi.fn().mockResolvedValue(undefined)
    const remove = vi.fn().mockResolvedValue(undefined)
    ;(globalThis as { chrome: Record<string, unknown> }).chrome = {
      storage: { local: { get, set, remove } },
    }

    const mod = await import('@/lib/supabase')
    // GoTrueClient reads the persisted session on init — flush microtasks.
    await new Promise((r) => setTimeout(r, 0))
    expect(mod.supabase).toBeDefined()
    expect(get).toHaveBeenCalled()
  })

  it('falls back to a no-op store when chrome.storage is unavailable (does not throw)', async () => {
    ;(globalThis as { chrome: Record<string, unknown> }).chrome = {}
    const mod = await import('@/lib/supabase')
    await new Promise((r) => setTimeout(r, 0))
    expect(mod.supabase).toBeDefined()
  })

  it('chromeStorage adapter reads/writes/removes via chrome.storage.local when available', async () => {
    const get = vi.fn().mockResolvedValue({ k: 'v' })
    const set = vi.fn().mockResolvedValue(undefined)
    const remove = vi.fn().mockResolvedValue(undefined)
    ;(globalThis as { chrome: Record<string, unknown> }).chrome = {
      storage: { local: { get, set, remove } },
    }

    const { chromeStorage } = await import('@/lib/supabase')

    await expect(chromeStorage.getItem('k')).resolves.toBe('v')
    expect(get).toHaveBeenCalledWith('k')

    await expect(chromeStorage.getItem('missing')).resolves.toBeNull()

    await chromeStorage.setItem('k', 'v2')
    expect(set).toHaveBeenCalledWith({ k: 'v2' })

    await chromeStorage.removeItem('k')
    expect(remove).toHaveBeenCalledWith('k')
  })

  it('chromeStorage adapter no-ops all methods when chrome.storage is unavailable', async () => {
    ;(globalThis as { chrome: Record<string, unknown> }).chrome = {}
    const { chromeStorage } = await import('@/lib/supabase')

    await expect(chromeStorage.getItem('k')).resolves.toBeNull()
    await expect(chromeStorage.setItem('k', 'v')).resolves.toBeUndefined()
    await expect(chromeStorage.removeItem('k')).resolves.toBeUndefined()
  })
})
