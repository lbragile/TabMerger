/**
 * Tests for lib/supabase/client.ts — browser-side Supabase client factory.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreateBrowserClient = vi.fn()
vi.mock('@supabase/ssr', () => ({
  createBrowserClient: (...args: unknown[]) => mockCreateBrowserClient(...args),
}))

describe('createClient (browser)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'anon-key')
    mockCreateBrowserClient.mockReturnValue({ from: vi.fn() })
  })

  it('creates a browser client using the public env vars', async () => {
    const { createClient } = await import('@/lib/supabase/client')
    createClient()
    expect(mockCreateBrowserClient).toHaveBeenCalledWith('https://proj.supabase.co', 'anon-key')
  })
})
