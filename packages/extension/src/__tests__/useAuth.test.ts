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
} = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({ data: { session: null } }),
  mockOnAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
  mockResetPasswordForEmail: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
      resetPasswordForEmail: mockResetPasswordForEmail,
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

  it('does not expose signInWithGoogle', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() })
    // ponytail: runtime check that the removed method is gone
    expect((result.current as unknown as Record<string, unknown>).signInWithGoogle).toBeUndefined()
  })
})
