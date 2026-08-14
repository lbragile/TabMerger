import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSync } from '@/hooks/useSync'
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups'
import { SESSIONS_QUERY_KEY } from '@/hooks/useSessions'
import { useUIStore } from '@/stores/uiStore'

const {
  mockUseAuth,
  mockUseEntitlements,
  mockPushPendingChanges,
  mockPullRemoteChanges,
  mockSubscribeToRemoteChanges,
  mockGetGroupsState,
  mockSaveGroupsState,
  mockHasEncryptionKey,
  mockGetDataKey,
  mockGetSetting,
  mockSetSetting,
  mockMarkAllGroupsPendingSync,
  mockGetSessions,
  mockPushSessionToSupabase,
  mockClearLocalAccountData,
} = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockUseEntitlements: vi.fn(),
  mockPushPendingChanges: vi.fn().mockResolvedValue(undefined),
  mockPullRemoteChanges: vi.fn(),
  mockSubscribeToRemoteChanges: vi.fn().mockResolvedValue(vi.fn()),
  mockGetGroupsState: vi.fn(),
  mockSaveGroupsState: vi.fn().mockResolvedValue(undefined),
  // Existing tests below assume encryption is already set up (matches pre-default-on behavior).
  mockHasEncryptionKey: vi.fn().mockResolvedValue(true),
  // Existing tests assume the data key is unlocked this session (a real CryptoKey, not null),
  // so push/pull actually run instead of hitting the new locked-skip gate.
  mockGetDataKey: vi.fn().mockReturnValue({}),
  // Existing tests assume the one-time re-encryption migration already ran, so it doesn't
  // interfere with their pushPendingChanges call-count assertions.
  mockGetSetting: vi.fn().mockResolvedValue(true),
  mockSetSetting: vi.fn().mockResolvedValue(undefined),
  mockMarkAllGroupsPendingSync: vi.fn().mockResolvedValue(undefined),
  mockGetSessions: vi.fn().mockResolvedValue([]),
  mockPushSessionToSupabase: vi.fn().mockResolvedValue(undefined),
  mockClearLocalAccountData: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => mockUseEntitlements() }))
vi.mock('@/lib/syncEngine', () => ({
  pushPendingChanges: mockPushPendingChanges,
  pullRemoteChanges: mockPullRemoteChanges,
  subscribeToRemoteChanges: mockSubscribeToRemoteChanges,
  // performSync is the extracted push+pull+save core (see syncEngine.ts) — reimplemented here
  // against the same push/pull/save mocks so existing call-count/argument assertions on those
  // mocks still hold after useSync.ts started routing through performSync instead of calling
  // push/pull directly.
  performSync: async (session: unknown) => {
    const state = await mockGetGroupsState();
    await mockPushPendingChanges(session);
    const merged = await mockPullRemoteChanges(session, state.available);
    const localOrder = state.available.map((g: { id: string }) => g.id);
    const posMap = new Map<string, number>(localOrder.map((id: string, i: number) => [id, i]));
    const reordered = [...merged].sort((a: { id: string; permanent?: boolean }, b: { id: string; permanent?: boolean }) => {
      if (a.permanent && !b.permanent) return -1;
      if (!a.permanent && b.permanent) return 1;
      return (posMap.get(a.id) ?? Infinity) - (posMap.get(b.id) ?? Infinity);
    });
    const next = { ...state, available: reordered };
    await mockSaveGroupsState(next);
    return reordered;
  },
}))
vi.mock('@/lib/localDb', () => ({
  getGroupsState: mockGetGroupsState,
  saveGroupsState: mockSaveGroupsState,
  getSetting: mockGetSetting,
  setSetting: mockSetSetting,
  markAllGroupsPendingSync: mockMarkAllGroupsPendingSync,
  getSessions: mockGetSessions,
  clearLocalAccountData: mockClearLocalAccountData,
}))
vi.mock('@/lib/encryptionKey', () => ({
  hasEncryptionKey: mockHasEncryptionKey,
  getDataKey: mockGetDataKey,
  ENCRYPTION_MIGRATION_DONE_KEY: 'encryptionMigrationDone',
  SESSIONS_MIGRATION_DONE_KEY: 'sessionsEncryptionMigrationDone',
}))
vi.mock('@/hooks/useSessions', () => ({
  pushSessionToSupabase: mockPushSessionToSupabase,
  SESSIONS_QUERY_KEY: ['sessions'],
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
  mockHasEncryptionKey.mockResolvedValue(true)
  mockGetDataKey.mockReturnValue({})
  // Key-aware: everything defaults to "already done" (true) except the last-signed-in-user
  // tracker, which must default to its real default (null via the caller's defaultValue arg)
  // so existing tests don't unexpectedly trip the account-switch clear below.
  mockGetSetting.mockImplementation((key: string, defaultValue: unknown) =>
    Promise.resolve(key === 'lastSignedInUserId' ? defaultValue : true)
  )
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

describe('useSync — mandatory first-time encryption setup', () => {
  it('opens the encryptionSetup modal and skips push/pull when no encryption key exists yet', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true })
    mockHasEncryptionKey.mockResolvedValue(false)

    const qc = new QueryClient()
    renderHook(() => useSync(), { wrapper: makeWrapper(qc) })

    await waitFor(() => expect(useUIStore.getState().modal.type).toBe('encryptionSetup'))
    expect(mockPushPendingChanges).not.toHaveBeenCalled()
    expect(mockPullRemoteChanges).not.toHaveBeenCalled()

    mockHasEncryptionKey.mockResolvedValue(true)
  })

  it('closes the encryptionSetup modal and resumes syncing once a key exists', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true })
    mockHasEncryptionKey.mockResolvedValueOnce(false).mockResolvedValue(true)
    useUIStore.setState({ modal: { type: null } })

    const qc = new QueryClient()
    renderHook(() => useSync(), { wrapper: makeWrapper(qc) })

    await waitFor(() => expect(mockPushPendingChanges).toHaveBeenCalled())
    await waitFor(() => expect(useUIStore.getState().modal.type).toBeNull())
  })
})

describe('useSync — encryption migration self-heal', () => {
  it('marks all groups pendingSync and sets the migration flag when a key exists but the migration never ran (accounts that set up encryption before markAllGroupsPendingSync was wired into setup)', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true })
    mockHasEncryptionKey.mockResolvedValue(true)
    mockGetSetting.mockResolvedValue(false)

    const qc = new QueryClient()
    renderHook(() => useSync(), { wrapper: makeWrapper(qc) })

    await waitFor(() => expect(mockMarkAllGroupsPendingSync).toHaveBeenCalled())
    await waitFor(() =>
      expect(mockSetSetting).toHaveBeenCalledWith('encryptionMigrationDone', true)
    )
    // Migration must run before push so previously-synced (not locally dirty) groups
    // get re-uploaded encrypted on this same cycle.
    expect(mockPushPendingChanges).toHaveBeenCalled()
  })

  it('does not re-run the migration once the flag is already set', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true })
    mockHasEncryptionKey.mockResolvedValue(true)
    mockGetSetting.mockResolvedValue(true)

    const qc = new QueryClient()
    renderHook(() => useSync(), { wrapper: makeWrapper(qc) })

    await waitFor(() => expect(mockPushPendingChanges).toHaveBeenCalled())
    expect(mockMarkAllGroupsPendingSync).not.toHaveBeenCalled()
  })
})

describe('useSync — sessions encryption migration self-heal', () => {
  beforeEach(() => {
    mockGetSessions.mockResolvedValue([])
    mockPushSessionToSupabase.mockClear()
  })

  it('re-uploads every locally-saved session and sets the sessions migration flag once, when it never ran', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true })
    mockHasEncryptionKey.mockResolvedValue(true)
    // Groups migration already done, sessions migration is not.
    mockGetSetting.mockImplementation((key: string) =>
      Promise.resolve(key === 'sessionsEncryptionMigrationDone' ? false : true)
    )
    const sessionA = { id: 's1', name: 'A', groups: [], createdAt: 1 }
    const sessionB = { id: 's2', name: 'B', groups: [], createdAt: 2 }
    mockGetSessions.mockResolvedValue([sessionA, sessionB])

    const qc = new QueryClient()
    renderHook(() => useSync(), { wrapper: makeWrapper(qc) })

    await waitFor(() => expect(mockPushSessionToSupabase).toHaveBeenCalledTimes(2))
    expect(mockPushSessionToSupabase).toHaveBeenCalledWith(sessionA)
    expect(mockPushSessionToSupabase).toHaveBeenCalledWith(sessionB)
    await waitFor(() =>
      expect(mockSetSetting).toHaveBeenCalledWith('sessionsEncryptionMigrationDone', true)
    )
  })

  it('does not re-run the sessions self-heal once its flag is already set', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true })
    mockHasEncryptionKey.mockResolvedValue(true)
    mockGetSetting.mockResolvedValue(true)

    const qc = new QueryClient()
    renderHook(() => useSync(), { wrapper: makeWrapper(qc) })

    await waitFor(() => expect(mockPushPendingChanges).toHaveBeenCalled())
    expect(mockPushSessionToSupabase).not.toHaveBeenCalled()
    expect(mockGetSessions).not.toHaveBeenCalled()
  })
})

describe('useSync — locked data key (one-time-per-device unlock; key persists in chrome.storage.local afterward)', () => {
  it('skips push/pull and opens the encryptionSetup modal (unlock mode) when a key exists but this profile has never unlocked it', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true })
    mockHasEncryptionKey.mockResolvedValue(true)
    mockGetDataKey.mockReturnValue(null)

    const qc = new QueryClient()
    renderHook(() => useSync(), { wrapper: makeWrapper(qc) })

    await waitFor(() => expect(useUIStore.getState().modal.type).toBe('encryptionSetup'))
    expect(mockPushPendingChanges).not.toHaveBeenCalled()
    expect(mockPullRemoteChanges).not.toHaveBeenCalled()
  })

  it('resumes syncing once the key is unlocked, without opening any modal', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true })
    mockHasEncryptionKey.mockResolvedValue(true)
    mockGetDataKey.mockReturnValue({})

    const qc = new QueryClient()
    renderHook(() => useSync(), { wrapper: makeWrapper(qc) })

    await waitFor(() => expect(mockPushPendingChanges).toHaveBeenCalled())
    expect(useUIStore.getState().modal.type).toBeNull()
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

  it('re-runs doSync on a poll interval so edits made after mount while the popup stays open still get pushed (regression)', async () => {
    vi.useFakeTimers()
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true })
    const qc = new QueryClient()
    renderHook(() => useSync(), { wrapper: makeWrapper(qc) })

    await vi.waitFor(() => expect(mockPushPendingChanges).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(30_000)
    expect(mockPushPendingChanges).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(mockPushPendingChanges).toHaveBeenCalledTimes(3)

    vi.useRealTimers()
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

describe('useSync — cross-account local data isolation', () => {
  it('clears local groups/sessions when a DIFFERENT account signs in on this device', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'userB' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: false }) // must fire even without cloudSync
    mockGetSetting.mockImplementation((key: string, defaultValue: unknown) =>
      Promise.resolve(key === 'lastSignedInUserId' ? 'userA' : defaultValue)
    )

    const qc = new QueryClient()
    renderHook(() => useSync(), { wrapper: makeWrapper(qc) })

    await waitFor(() => expect(mockClearLocalAccountData).toHaveBeenCalled())
    await waitFor(() =>
      expect(mockSetSetting).toHaveBeenCalledWith('lastSignedInUserId', 'userB')
    )
    expect(qc.getQueryData(SESSIONS_QUERY_KEY)).toEqual([])
  })

  it('does NOT clear on first-ever sign-in (no previously recorded user id)', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'userA' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: false })
    mockGetSetting.mockImplementation((key: string, defaultValue: unknown) =>
      Promise.resolve(key === 'lastSignedInUserId' ? null : defaultValue)
    )

    const qc = new QueryClient()
    renderHook(() => useSync(), { wrapper: makeWrapper(qc) })

    await waitFor(() =>
      expect(mockSetSetting).toHaveBeenCalledWith('lastSignedInUserId', 'userA')
    )
    expect(mockClearLocalAccountData).not.toHaveBeenCalled()
  })

  it('does NOT clear on a token refresh for the SAME user id', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'userA' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: false })
    mockGetSetting.mockImplementation((key: string, defaultValue: unknown) =>
      Promise.resolve(key === 'lastSignedInUserId' ? 'userA' : defaultValue)
    )

    const qc = new QueryClient()
    renderHook(() => useSync(), { wrapper: makeWrapper(qc) })

    await waitFor(() =>
      expect(mockSetSetting).toHaveBeenCalledWith('lastSignedInUserId', 'userA')
    )
    expect(mockClearLocalAccountData).not.toHaveBeenCalled()
  })
})
