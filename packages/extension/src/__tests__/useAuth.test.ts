import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'

// ─── Supabase auth mock ───────────────────────────────────────────────────────

const {
  mockGetSession,
  mockOnAuthStateChange,
  mockSignInWithOAuth,
  mockExchangeCodeForSession,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({ data: { session: null } }),
  mockOnAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
  mockSignInWithOAuth: vi.fn(),
  mockExchangeCodeForSession: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
      signInWithOAuth: mockSignInWithOAuth,
      exchangeCodeForSession: mockExchangeCodeForSession,
    },
  },
}))

// ─── Chrome identity mock ─────────────────────────────────────────────────────

const mockLaunchWebAuthFlow = vi.fn()
globalThis.chrome = {
  identity: {
    getRedirectURL: vi.fn().mockReturnValue('https://ext.redirect/'),
    launchWebAuthFlow: mockLaunchWebAuthFlow,
  },
  runtime: { lastError: undefined },
} as unknown as typeof chrome

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  return wrapper
}

/** Make launchWebAuthFlow call its callback with the given URL (or no URL on error). */
function stubWebAuthFlow(responseUrl: string | null, lastError?: string) {
  mockLaunchWebAuthFlow.mockImplementation(
    (_opts: object, cb: (url?: string) => void) => {
      ;(chrome.runtime as { lastError: { message: string } | undefined }).lastError =
        lastError ? { message: lastError } : undefined
      cb(responseUrl ?? undefined)
    }
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ data: { session: null } })
  mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  ;(chrome.runtime as { lastError: unknown }).lastError = undefined
})

// ─── signInWithGoogle — PKCE flow ─────────────────────────────────────────────

describe('useAuth — signInWithGoogle PKCE flow', () => {
  it('exchanges the code on the happy path', async () => {
    mockSignInWithOAuth.mockResolvedValue({
      data: { url: 'https://accounts.google.com/o/oauth2/auth?...' },
      error: null,
    })
    mockExchangeCodeForSession.mockResolvedValue({ error: null })
    stubWebAuthFlow('https://ext.redirect/?code=abc123')

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() })

    await act(async () => {
      await result.current.signInWithGoogle()
    })

    expect(mockSignInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google', options: expect.objectContaining({ skipBrowserRedirect: true }) })
    )
    expect(mockLaunchWebAuthFlow).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://accounts.google.com/o/oauth2/auth?...', interactive: true }),
      expect.any(Function)
    )
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('abc123')
  })

  it('throws when signInWithOAuth returns an error', async () => {
    mockSignInWithOAuth.mockResolvedValue({ data: { url: null }, error: new Error('OAuth init failed') })

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() })

    await expect(
      act(async () => { await result.current.signInWithGoogle() })
    ).rejects.toThrow('OAuth init failed')

    expect(mockLaunchWebAuthFlow).not.toHaveBeenCalled()
  })

  it('throws when data.url is missing', async () => {
    mockSignInWithOAuth.mockResolvedValue({ data: { url: null }, error: null })

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() })

    await expect(
      act(async () => { await result.current.signInWithGoogle() })
    ).rejects.toThrow('No OAuth URL returned')
  })

  it('throws when launchWebAuthFlow returns no URL (auth cancelled)', async () => {
    mockSignInWithOAuth.mockResolvedValue({
      data: { url: 'https://accounts.google.com/auth' },
      error: null,
    })
    stubWebAuthFlow(null)

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() })

    await expect(
      act(async () => { await result.current.signInWithGoogle() })
    ).rejects.toThrow('Auth cancelled')
  })

  it('throws when launchWebAuthFlow signals chrome.runtime.lastError', async () => {
    mockSignInWithOAuth.mockResolvedValue({
      data: { url: 'https://accounts.google.com/auth' },
      error: null,
    })
    stubWebAuthFlow(null, 'User closed the auth window')

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() })

    await expect(
      act(async () => { await result.current.signInWithGoogle() })
    ).rejects.toThrow('User closed the auth window')
  })

  it('throws when the redirect URL contains no code parameter', async () => {
    mockSignInWithOAuth.mockResolvedValue({
      data: { url: 'https://accounts.google.com/auth' },
      error: null,
    })
    stubWebAuthFlow('https://ext.redirect/?state=xyz') // no code param

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() })

    await expect(
      act(async () => { await result.current.signInWithGoogle() })
    ).rejects.toThrow('No auth code in redirect URL')
  })

  it('throws when exchangeCodeForSession fails', async () => {
    mockSignInWithOAuth.mockResolvedValue({
      data: { url: 'https://accounts.google.com/auth' },
      error: null,
    })
    stubWebAuthFlow('https://ext.redirect/?code=tok')
    mockExchangeCodeForSession.mockResolvedValue({ error: new Error('Exchange failed') })

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() })

    await expect(
      act(async () => { await result.current.signInWithGoogle() })
    ).rejects.toThrow('Exchange failed')
  })
})
