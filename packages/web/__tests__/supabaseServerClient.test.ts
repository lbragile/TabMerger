/**
 * Regression test: the RSC Supabase client must not attempt token auto-refresh.
 *
 * Root cause it guards against: `createClient()`'s `setAll` silently discards every
 * cookie write (Server Components can't persist cookies), so a background refresh
 * can never succeed anyway. Left enabled, GoTrue retries a refresh against any
 * stale/invalid refresh-token cookie on every request and logs a noisy AuthApiError
 * even on public, no-auth-required pages like /share/[slug] (rendered via the
 * Navbar server component in the shared marketing layout).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const createServerClient = vi.fn(
  (_url: string, _key: string, _options?: { auth?: { autoRefreshToken?: boolean } }) => ({
    mocked: true,
  })
)

vi.mock('@supabase/ssr', () => ({
  createServerClient: (...args: Parameters<typeof createServerClient>) => createServerClient(...args),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [],
    set: vi.fn(),
  })),
}))

describe('lib/supabase/server createClient', () => {
  beforeEach(() => {
    createServerClient.mockClear()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-key'
  })

  it('disables autoRefreshToken since RSC cookie writes are always discarded', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    await createClient()

    expect(createServerClient).toHaveBeenCalledTimes(1)
    const options = createServerClient.mock.calls[0][2]
    expect(options?.auth?.autoRefreshToken).toBe(false)
  })
})
