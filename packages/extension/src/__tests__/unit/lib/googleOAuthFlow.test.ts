import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockSignInWithOAuth, mockExchangeCodeForSession, mockSetSession } = vi.hoisted(() => ({
  mockSignInWithOAuth: vi.fn(),
  mockExchangeCodeForSession: vi.fn(),
  mockSetSession: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithOAuth: mockSignInWithOAuth,
      exchangeCodeForSession: mockExchangeCodeForSession,
      setSession: mockSetSession,
    },
  },
}))

import { runGoogleOAuthFlow } from '@/lib/googleOAuthFlow'

const originalChrome = (globalThis as { chrome?: unknown }).chrome

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  ;(globalThis as { chrome?: unknown }).chrome = originalChrome
})

describe('runGoogleOAuthFlow', () => {
  it('throws when chrome.identity is unavailable', async () => {
    ;(globalThis as { chrome: Record<string, unknown> }).chrome = {}
    await expect(runGoogleOAuthFlow()).rejects.toThrow('unavailable')
  })

  it('launches the OAuth flow and exchanges the returned code for a session', async () => {
    const launchWebAuthFlow = vi.fn((_opts, cb: (url: string) => void) => {
      cb('https://abc.chromiumapp.org/?code=abc123')
    })
    ;(globalThis as { chrome: Record<string, unknown> }).chrome = {
      identity: { getRedirectURL: () => 'https://abc.chromiumapp.org/', launchWebAuthFlow },
      runtime: { lastError: undefined },
    }
    mockSignInWithOAuth.mockResolvedValue({ data: { url: 'https://supabase.example/authorize' }, error: null })
    mockExchangeCodeForSession.mockResolvedValue({ error: null })

    await runGoogleOAuthFlow()

    expect(mockSignInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google' })
    )
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('abc123')
  })

  it('falls back to the implicit-flow hash tokens when no code is present', async () => {
    const launchWebAuthFlow = vi.fn((_opts, cb: (url: string) => void) => {
      cb('https://abc.chromiumapp.org/#access_token=at1&refresh_token=rt1')
    })
    ;(globalThis as { chrome: Record<string, unknown> }).chrome = {
      identity: { getRedirectURL: () => 'https://abc.chromiumapp.org/', launchWebAuthFlow },
      runtime: { lastError: undefined },
    }
    mockSignInWithOAuth.mockResolvedValue({ data: { url: 'https://supabase.example/authorize' }, error: null })
    mockSetSession.mockResolvedValue({ error: null })

    await runGoogleOAuthFlow()

    expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'at1', refresh_token: 'rt1' })
  })

  it('rejects when the auth flow is cancelled', async () => {
    const launchWebAuthFlow = vi.fn((_opts, cb: (url?: string) => void) => {
      cb(undefined)
    })
    ;(globalThis as { chrome: Record<string, unknown> }).chrome = {
      identity: { getRedirectURL: () => 'https://abc.chromiumapp.org/', launchWebAuthFlow },
      runtime: { lastError: undefined },
    }
    mockSignInWithOAuth.mockResolvedValue({ data: { url: 'https://supabase.example/authorize' }, error: null })

    await expect(runGoogleOAuthFlow()).rejects.toThrow('cancelled')
  })

  it('throws when signInWithOAuth returns an error', async () => {
    ;(globalThis as { chrome: Record<string, unknown> }).chrome = {
      identity: { getRedirectURL: () => 'https://abc.chromiumapp.org/' },
      runtime: { lastError: undefined },
    }
    mockSignInWithOAuth.mockResolvedValue({ data: null, error: new Error('provider disabled') })

    await expect(runGoogleOAuthFlow()).rejects.toThrow('provider disabled')
  })
})
