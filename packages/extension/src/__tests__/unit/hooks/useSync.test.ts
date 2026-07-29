import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSync } from '@/hooks/useSync'
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups'

const {
  mockUseAuth,
  mockUseEntitlements,
  mockPushPendingChanges,
  mockPullRemoteChanges,
  mockSubscribeToRemoteChanges,
  mockGetGroupsState,
  mockSaveGroupsState,
} = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockUseEntitlements: vi.fn(),
  mockPushPendingChanges: vi.fn().mockResolvedValue(undefined),
  mockPullRemoteChanges: vi.fn(),
  mockSubscribeToRemoteChanges: vi.fn().mockResolvedValue(vi.fn()),
  mockGetGroupsState: vi.fn(),
  mockSaveGroupsState: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => mockUseEntitlements() }))
vi.mock('@/lib/syncEngine', () => ({
  pushPendingChanges: mockPushPendingChanges,
  pullRemoteChanges: mockPullRemoteChanges,
  subscribeToRemoteChanges: mockSubscribeToRemoteChanges,
}))
vi.mock('@/lib/localDb', () => ({
  getGroupsState: mockGetGroupsState,
  saveGroupsState: mockSaveGroupsState,
}))

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
}

const nowOpen = { id: 'now', name: 'Now Open', permanent: true, starred: false, color: '#fff', updatedAt: 1, windows: [] }

beforeEach(() => {
  vi.clearAllMocks()
  mockGetGroupsState.mockResolvedValue({ available: [nowOpen], active: { id: 'now', index: 0 } })
  mockPullRemoteChanges.mockResolvedValue([nowOpen])
})

describe('useSync — appSettings invalidation on login (regression)', () => {
  it('invalidates the shared appSettings query once a session appears, so already-mounted settings consumers refetch the correct persisted value', async () => {
    mockUseAuth.mockReturnValue({ session: null })
    mockUseEntitlements.mockReturnValue({ cloudSync: false })
    const qc = new QueryClient()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { rerender } = renderHook(() => useSync(), { wrapper: makeWrapper(qc) })
    expect(invalidateSpy).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['appSettings'] }))

    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    rerender()

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['appSettings'] }))
    )
  })
})

describe('useSync — gating', () => {
  it('does nothing when there is no session', async () => {
    mockUseAuth.mockReturnValue({ session: null })
    mockUseEntitlements.mockReturnValue({ cloudSync: true })
    renderHook(() => useSync(), { wrapper: makeWrapper(new QueryClient()) })
    await new Promise((r) => setTimeout(r, 0))
    expect(mockPushPendingChanges).not.toHaveBeenCalled()
  })

  it('does nothing when cloudSync entitlement is false, even with a session', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: false })
    renderHook(() => useSync(), { wrapper: makeWrapper(new QueryClient()) })
    await new Promise((r) => setTimeout(r, 0))
    expect(mockPushPendingChanges).not.toHaveBeenCalled()
  })
})

describe('useSync — syncing', () => {
  it('pushes then pulls, and writes the merged state back to IDB and the query cache', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true })
    const qc = new QueryClient()
    renderHook(() => useSync(), { wrapper: makeWrapper(qc) })

    await waitFor(() => expect(mockPushPendingChanges).toHaveBeenCalled())
    await waitFor(() => expect(mockSaveGroupsState).toHaveBeenCalled())
    expect(qc.getQueryData(GROUPS_QUERY_KEY)).toEqual(expect.objectContaining({ available: expect.any(Array) }))
  })

  it('keeps the permanent group first and preserves local drag order for saved groups', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true })
    const savedA = { id: 'a', name: 'A', permanent: false, starred: false, color: '#fff', updatedAt: 1, windows: [] }
    const savedB = { id: 'b', name: 'B', permanent: false, starred: false, color: '#fff', updatedAt: 1, windows: [] }
    mockGetGroupsState.mockResolvedValue({ available: [nowOpen, savedA, savedB], active: { id: 'now', index: 0 } })
    // Remote returns them in a different order (by updatedAt) — hook must restore local drag order
    mockPullRemoteChanges.mockResolvedValue([savedB, nowOpen, savedA])

    const qc = new QueryClient()
    renderHook(() => useSync(), { wrapper: makeWrapper(qc) })

    await waitFor(() => expect(mockSaveGroupsState).toHaveBeenCalled())
    const saved = mockSaveGroupsState.mock.calls[0][0]
    expect(saved.available.map((g: { id: string }) => g.id)).toEqual(['now', 'a', 'b'])
  })

  it('subscribes to remote changes and merges an update using last-write-wins on updatedAt', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true })
    let onUpdate: ((g: unknown) => void) | undefined
    mockSubscribeToRemoteChanges.mockImplementation(async (_session, cb) => {
      onUpdate = cb
      return vi.fn()
    })
    const existing = { id: 'x', name: 'Old', permanent: false, starred: false, color: '#fff', updatedAt: 100, windows: [] }
    mockGetGroupsState.mockResolvedValue({ available: [nowOpen, existing], active: { id: 'now', index: 0 } })

    const qc = new QueryClient()
    renderHook(() => useSync(), { wrapper: makeWrapper(qc) })
    await waitFor(() => expect(mockSubscribeToRemoteChanges).toHaveBeenCalled())

    const updated = { ...existing, name: 'New', updatedAt: 200 }
    await onUpdate!(updated)

    await waitFor(() => {
      const lastCall = mockSaveGroupsState.mock.calls.at(-1)?.[0]
      expect(lastCall.available.find((g: { id: string }) => g.id === 'x').name).toBe('New')
    })
  })

  it('does not overwrite local state with a stale remote update (older updatedAt)', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true })
    let onUpdate: ((g: unknown) => void) | undefined
    mockSubscribeToRemoteChanges.mockImplementation(async (_session, cb) => {
      onUpdate = cb
      return vi.fn()
    })
    const existing = { id: 'x', name: 'Fresh Local', permanent: false, starred: false, color: '#fff', updatedAt: 500, windows: [] }
    mockGetGroupsState.mockResolvedValue({ available: [nowOpen, existing], active: { id: 'now', index: 0 } })

    const qc = new QueryClient()
    renderHook(() => useSync(), { wrapper: makeWrapper(qc) })
    await waitFor(() => expect(mockSubscribeToRemoteChanges).toHaveBeenCalled())

    const staleRemote = { ...existing, name: 'Stale Remote', updatedAt: 50 }
    await onUpdate!(staleRemote)

    await waitFor(() => expect(mockSaveGroupsState).toHaveBeenCalled())
    const lastCall = mockSaveGroupsState.mock.calls.at(-1)?.[0]
    expect(lastCall.available.find((g: { id: string }) => g.id === 'x').name).toBe('Fresh Local')
  })
})
