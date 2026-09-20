import { describe, it, expect, vi, afterEach } from 'vitest'

// ponytail: unlike supabase.test.ts, this file does NOT mock '@supabase/supabase-js' — the bug
// this guards against (createClient('') throwing "supabaseUrl is required" at module-import
// time whenever VITE_SUPABASE_URL/VITE_SUPABASE_PUBLISHABLE_KEY are unset) only reproduces
// against the REAL createClient. A mocked createClient (as the sibling file uses, to avoid
// spinning up real GoTrueClient timers across its many vi.resetModules() reimports) can never
// throw, so it can't catch this regression. CI has no `.env.local` and hit this exact crash —
// every popup entrypoint import chain (syncEngine, deviceSessions, useEntitlements) pulls this
// module in transitively, so it took the whole popup down at import time in any env-less build.
describe('supabase client — env degradation (real createClient)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('imports cleanly and reports isSupabaseConfigured=false when Supabase env vars are unset', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
    vi.resetModules()

    const mod = await import('@/lib/supabase')

    expect(mod.isSupabaseConfigured).toBe(false)
    expect(mod.supabase).toBeDefined()
    expect(mod.supabase.auth).toBeDefined()
  })

  it('reports isSupabaseConfigured=true when both Supabase env vars are present', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'fake-anon-key')
    vi.resetModules()

    const mod = await import('@/lib/supabase')

    expect(mod.isSupabaseConfigured).toBe(true)
    expect(mod.supabase).toBeDefined()
  })
})
