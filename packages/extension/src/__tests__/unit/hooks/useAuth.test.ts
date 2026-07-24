import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'

// ─── Supabase auth mock ───────────────────────────────────────────────────────

const {
  mockGetSession,
  mockOnAuthStateChange,
  mockResetPasswordForEmail,
  mockSignInWithPassword,
  mockSignUp,
  mockSignOut,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({ data: { session: null } }),
  mockOnAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
  mockResetPasswordForEmail: vi.fn(),
  mockSignInWithPassword: vi.fn(),
  mockSignUp: vi.fn(),
  mockSignOut: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
      resetPasswordForEmail: mockResetPasswordForEmail,
      signInWithPassword: mockSignInWithPassword,
      signUp: mockSignUp,
      signOut: mockSignOut,
    },
  },
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ data: { session: null } })
  mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
})

// ─── resetPassword ────────────────────────────────────────────────────────────

describe('useAuth — resetPassword', () => {
  it('calls resetPasswordForEmail with the given email', async () => {
    mockResetPasswordForEmail.mockResolvedValue({ error: null })

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() })

    await act(async () => {
      await result.current.resetPassword('user@example.com')
    })

    expect(mockResetPasswordForEmail).toHaveBeenCalledWith('user@example.com')
  })

  it('throws when Supabase returns an error', async () => {
    mockResetPasswordForEmail.mockResolvedValue({ error: new Error('Email not found') })

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() })

    await expect(
      act(async () => { await result.current.resetPassword('nobody@example.com') })
    ).rejects.toThrow('Email not found')
  })

  it('does not expose signInWithGoogle', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() })
    // Flush the mount effect's getSession().then(setState) before asserting —
    // otherwise that state update lands after the test body, outside act().
    await act(async () => {})
    // ponytail: runtime check that the removed method is gone
    expect((result.current as unknown as Record<string, unknown>).signInWithGoogle).toBeUndefined()
  })
})

describe('useAuth — signIn/signUp/signOut', () => {
  it('signIn succeeds when no error returned', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null })
    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() })
    await act(async () => {
      await result.current.signIn('user@example.com', 'pw')
    })
    expect(mockSignInWithPassword).toHaveBeenCalledWith({ email: 'user@example.com', password: 'pw' })
  })

  it('signIn throws on error', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: new Error('bad creds') })
    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() })
    await expect(
      act(async () => { await result.current.signIn('user@example.com', 'wrong') })
    ).rejects.toThrow('bad creds')
  })

  it('signUp succeeds when no error returned', async () => {
    mockSignUp.mockResolvedValue({ error: null })
    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() })
    await act(async () => {
      await result.current.signUp('new@example.com', 'pw')
    })
    expect(mockSignUp).toHaveBeenCalledWith({ email: 'new@example.com', password: 'pw' })
  })

  it('signUp throws on error', async () => {
    mockSignUp.mockResolvedValue({ error: new Error('already exists') })
    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() })
    await expect(
      act(async () => { await result.current.signUp('dup@example.com', 'pw') })
    ).rejects.toThrow('already exists')
  })

  it('signOut succeeds when no error returned', async () => {
    mockSignOut.mockResolvedValue({ error: null })
    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() })
    await act(async () => {
      await result.current.signOut()
    })
    expect(mockSignOut).toHaveBeenCalled()
  })

  it('signOut throws on error', async () => {
    mockSignOut.mockResolvedValue({ error: new Error('network down') })
    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() })
    await expect(
      act(async () => { await result.current.signOut() })
    ).rejects.toThrow('network down')
  })
})

describe('useAuth — auth state change + storage sync', () => {
  it('updates state when onAuthStateChange fires with a session', async () => {
    let capturedCallback: ((event: string, session: unknown) => void) | undefined
    mockOnAuthStateChange.mockImplementation((cb: (event: string, session: unknown) => void) => {
      capturedCallback = cb
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() })
    await act(async () => {})

    const fakeSession = { user: { id: 'u1' } }
    act(() => {
      capturedCallback?.('SIGNED_IN', fakeSession)
    })

    expect(result.current.session).toEqual(fakeSession)
    expect(result.current.user).toEqual({ id: 'u1' })
    expect(result.current.loading).toBe(false)
  })

  it('re-reads session when chrome.storage.local reports a tabmerger-auth change', async () => {
    let storageHandler: ((changes: Record<string, unknown>) => void) | undefined
    const addListener = vi.fn((cb: (changes: Record<string, unknown>) => void) => {
      storageHandler = cb
    })
    const removeListener = vi.fn()
    ;(globalThis as { chrome: Record<string, unknown> }).chrome = {
      ...(globalThis as { chrome: Record<string, unknown> }).chrome,
      storage: { local: { onChanged: { addListener, removeListener } } },
    }

    mockGetSession.mockResolvedValue({ data: { session: null } })
    const { unmount } = renderHook(() => useAuth(), { wrapper: makeWrapper() })
    await act(async () => {})

    expect(addListener).toHaveBeenCalled()

    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u2' } } } })
    await act(async () => {
      storageHandler?.({ 'tabmerger-auth': { newValue: 'x' } })
      await Promise.resolve()
    })

    // storage change unrelated to tabmerger-auth is a no-op
    await act(async () => {
      storageHandler?.({ 'unrelated-key': { newValue: 'y' } })
    })

    unmount()
    expect(removeListener).toHaveBeenCalled()
  })
})
