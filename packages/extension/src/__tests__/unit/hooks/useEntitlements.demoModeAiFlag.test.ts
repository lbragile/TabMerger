import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * DEMO_MODE (VITE_DEMO_BUILD === 'true') returns pro_ai limits unconditionally for
 * marketing recordings, but `aiFeatures` must still be gated by the global AI_ENABLED
 * kill switch — see the ponytail note in useEntitlements.ts. `import.meta.env` values
 * are read at module-eval time, so each flag combo needs vi.resetModules() + a fresh
 * dynamic import, done here via vi.stubEnv on VITE_DEMO_BUILD.
 */

vi.mock('@/lib/supabase', () => ({ supabase: { auth: {}, from: vi.fn() } }))
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, loading: false, session: null }),
}))

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
}

describe('useEntitlements aiFeatures AND logic — DEMO_MODE branch', () => {
  it('demo build shows aiFeatures=false when AI_ENABLED is false, despite the pro_ai override', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_DEMO_BUILD', 'true')
    vi.doMock('@/lib/aiFlag', () => ({ AI_ENABLED: false }))
    const { useEntitlements } = await import('@/hooks/useEntitlements')
    const { result } = renderHook(() => useEntitlements(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.tier).toBe('pro_ai')
    expect(result.current.aiFeatures).toBe(false)
    vi.unstubAllEnvs()
  })

  it('demo build shows aiFeatures=true when AI_ENABLED is true', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_DEMO_BUILD', 'true')
    vi.doMock('@/lib/aiFlag', () => ({ AI_ENABLED: true }))
    const { useEntitlements } = await import('@/hooks/useEntitlements')
    const { result } = renderHook(() => useEntitlements(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.tier).toBe('pro_ai')
    expect(result.current.aiFeatures).toBe(true)
    vi.unstubAllEnvs()
  })
})
