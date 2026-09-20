/**
 * Regression test: lib/supabase/client.ts must not throw when NEXT_PUBLIC_SUPABASE_URL /
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are unset.
 *
 * Unlike supabaseBrowserClient.test.ts (which mocks `@supabase/ssr`, so `createBrowserClient`
 * can never throw), this file deliberately does NOT mock it — the bug this guards against is
 * `createBrowserClient(undefined!, undefined!)` throwing "Your project's URL and API key are
 * required to create a Supabase client!" synchronously. Every 'use client' page that calls
 * createClient() at render time (auth/sign-in, auth/sign-up, auth/reset-password,
 * auth/forgot-password) gets statically prerendered by `next build` for its initial HTML unless
 * marked dynamic, so a missing env var crashed the production build one route at a time. A
 * mocked createBrowserClient (as supabaseBrowserClient.test.ts uses) cannot catch this.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

describe('lib/supabase/client — env degradation (real createBrowserClient)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('imports and constructs cleanly, reporting isSupabaseConfigured=false, when env vars are unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '')
    vi.resetModules()

    const mod = await import('@/lib/supabase/client')

    expect(mod.isSupabaseConfigured).toBe(false)
    expect(() => mod.createClient()).not.toThrow()
  })

  it('reports isSupabaseConfigured=true when both env vars are present', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'anon-key')
    vi.resetModules()

    const mod = await import('@/lib/supabase/client')

    expect(mod.isSupabaseConfigured).toBe(true)
    expect(() => mod.createClient()).not.toThrow()
  })
})
