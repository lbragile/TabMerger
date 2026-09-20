/**
 * Regression test: lib/supabase/server.ts must not throw when NEXT_PUBLIC_SUPABASE_URL /
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY are unset.
 *
 * Unlike supabaseServerClient.test.ts (which mocks `@supabase/ssr`, so `createServerClient` can
 * never throw), this file deliberately does NOT mock `@supabase/ssr` or `@supabase/supabase-js` —
 * the bug this guards against is `createServerClient(undefined!, undefined!, ...)` throwing
 * "Your project's URL and Key are required to create a Supabase client!" synchronously.
 *
 * This client is reached from `Navbar` (components/layout/Navbar.tsx), which lives in the shared
 * marketing layout and calls `createClient()` unconditionally on EVERY request — not just a
 * prerendered one — so a missing env var 500'd every single page (confirmed by manually
 * reproducing against a live `next dev` server with .env.local/.env.production moved aside: every
 * route, including `/`, returned 500 before this fix, 200/307 after).
 *
 * Degradation contract: the client must construct without throwing, and callers must still see
 * "signed out" (`auth.getUser()` resolving to `{ data: { user: null }, error }` rather than
 * throwing) so that every existing `if (!user)` check in this codebase — Navbar, the (app) layout
 * redirect, and the 401 checks in app/api/* routes — continues to fail CLOSED, not open.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [],
    set: vi.fn(),
  })),
}))

describe('lib/supabase/server — env degradation (real createServerClient)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('imports and constructs cleanly, reporting isSupabaseConfigured=false, when env vars are unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '')
    vi.resetModules()

    const mod = await import('@/lib/supabase/server')

    expect(mod.isSupabaseConfigured).toBe(false)
    await expect(mod.createClient()).resolves.toBeDefined()
  })

  it('degrades auth.getUser() to a signed-out result instead of throwing, when unconfigured', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '')
    vi.resetModules()

    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()

    const result = await supabase.auth.getUser()

    expect(result.data.user).toBeNull()
  })

  it('reports isSupabaseConfigured=true when both env vars are present', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'anon-key')
    vi.resetModules()

    const mod = await import('@/lib/supabase/server')

    expect(mod.isSupabaseConfigured).toBe(true)
    await expect(mod.createClient()).resolves.toBeDefined()
  })

  it('createServiceRoleClient constructs cleanly when SUPABASE_SERVICE_ROLE_KEY is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    vi.resetModules()

    const { createServiceRoleClient } = await import('@/lib/supabase/server')

    await expect(createServiceRoleClient()).resolves.toBeDefined()
  })
})
