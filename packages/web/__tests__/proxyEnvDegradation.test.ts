/**
 * Regression test: proxy.ts (the Supabase-session-refresh middleware) must not throw when
 * NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are unset.
 *
 * Deliberately does NOT mock `@supabase/ssr` — the bug this guards against is
 * `createServerClient(undefined!, undefined!, ...)` throwing "supabaseUrl is required"
 * synchronously. Unlike lib/stripe.ts (module scope, evaluated once per build), proxy()
 * constructs a client on EVERY request, so a missing env var doesn't just fail one build step —
 * it 500s every request through the matcher, including the E2E gate's dev server when repo
 * secrets aren't configured. A mocked createServerClient can never throw, so it can't catch this.
 *
 * Degradation contract: proxy() fails OPEN when unconfigured (passes the request through
 * unauthenticated) rather than crashing or redirecting, since there is no working auth backend
 * to check a session against.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

describe('proxy — env degradation (real createServerClient)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('does not throw and passes protected routes through when Supabase env vars are unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '')
    vi.resetModules()

    const { proxy } = await import('@/proxy')
    const request = new NextRequest('http://localhost/dashboard')

    const response = await proxy(request)

    expect(response).toBeDefined()
    // Fails open: no redirect to /auth/sign-in, since there's no auth backend to check against.
    expect(response.status).not.toBe(307)
    expect(response.headers.get('location')).toBeNull()
  })
})
