import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSync } from '@/hooks/useSync'
import { useUIStore } from '@/stores/uiStore'
import { resetAccountScopeForTests } from '@/lib/accountScope'

/**
 * Regression: the popup of a signed-in Pro user showed "Set up encryption" whenever the
 * `encryption_keys` request FAILED (401 from a stale token, offline, 5xx), because a failed
 * check was reported as "no key". The dialog covered the whole popup, and completing it would
 * have replaced the account's existing key. `@/lib/encryptionKey` is REAL here: only the
 * Supabase response is faked, so the test covers the check and its caller together.
 */
const { mockUseAuth, mockUseEntitlements, mockPerformSync, mockKeyQuery, mockGetGroupsState } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockUseEntitlements: vi.fn(),
  mockPerformSync: vi.fn().mockResolvedValue([]),
  mockKeyQuery: vi.fn(),
  mockGetGroupsState: vi.fn(),
}))

const session = { user: { id: 'u1' }, access_token: 'token' }

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => mockUseEntitlements() }))
vi.mock('@/hooks/useSessions', () => ({ pushSessionToSupabase: vi.fn(), SESSIONS_QUERY_KEY: ['sessions'] }))
vi.mock('@/lib/syncEngine', () => ({
  performSync: mockPerformSync,
  subscribeToRemoteChanges: vi.fn().mockResolvedValue(vi.fn()),
  canUploadOnFirefox: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/lib/localDb', async () => (await import('@/__tests__/unit/_helpers/updateGroupsStateMock')).withUpdateGroupsState({
  getGroupsState: mockGetGroupsState,
  saveGroupsState: vi.fn().mockResolvedValue(1),
  // every one-time migration already ran; no previously recorded account
  getSetting: vi.fn((key: string, defaultValue: unknown) => Promise.resolve(key === 'lastSignedInUserId' ? defaultValue : true)),
  setSetting: vi.fn().mockResolvedValue(undefined),
  markAllGroupsPendingSync: vi.fn().mockResolvedValue(undefined),
  getSessions: vi.fn().mockResolvedValue([]),
  clearLocalAccountData: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/supabase', () => {
  const builder: Record<string, unknown> = {}
  builder.select = () => builder
  builder.eq = () => builder
  builder.abortSignal = () => builder
  builder.maybeSingle = () => mockKeyQuery()
  return { supabase: { auth: { getSession: async () => ({ data: { session } }) }, from: () => builder } }
})

function renderSync() {
  const qc = new QueryClient()
  return renderHook(() => useSync(), {
    wrapper: ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children),
  })
}

/** Lets the async doSync chain settle after the key request was issued. */
async function afterKeyCheck() {
  await waitFor(() => expect(mockKeyQuery).toHaveBeenCalled())
  await new Promise((r) => setTimeout(r, 20))
}

beforeEach(() => {
  vi.clearAllMocks()
  resetAccountScopeForTests()
  useUIStore.getState().closeModal()
  mockUseAuth.mockReturnValue({ session })
  mockUseEntitlements.mockReturnValue({ cloudSync: true, loading: false })
  mockGetGroupsState.mockResolvedValue({ available: [], active: { id: 'now', index: 0 } })
})

describe('useSync — encryption status that could not be checked', () => {
  it.each([
    ['an unauthorised request (401, stale token)', { data: null, error: { message: 'JWT expired', code: 'PGRST301' } }],
    ['a network failure (offline)', { data: null, error: { message: 'TypeError: Failed to fetch' } }],
  ])('does not open "Set up encryption" and does not sync after %s', async (_label, response) => {
    mockKeyQuery.mockResolvedValue(response)
    renderSync()
    await afterKeyCheck()

    expect(useUIStore.getState().modal.type).toBeNull()
    expect(mockPerformSync).not.toHaveBeenCalled()
  })

  it('does not open it either when the request itself throws', async () => {
    mockKeyQuery.mockRejectedValue(new Error('network down'))
    renderSync()
    await afterKeyCheck()

    expect(useUIStore.getState().modal.type).toBeNull()
    expect(mockPerformSync).not.toHaveBeenCalled()
  })

  it('still opens it when the server ANSWERS that this account has no key', async () => {
    mockKeyQuery.mockResolvedValue({ data: null, error: null })
    renderSync()

    await waitFor(() => expect(useUIStore.getState().modal.type).toBe('encryptionSetup'))
    expect(mockPerformSync).not.toHaveBeenCalled()
  })
})
