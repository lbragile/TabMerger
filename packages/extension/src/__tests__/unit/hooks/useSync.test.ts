import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSync } from '@/hooks/useSync'
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups'
import { SESSIONS_QUERY_KEY } from '@/hooks/useSessions'
import { useUIStore } from '@/stores/uiStore'
import { resetAccountScopeForTests } from '@/lib/accountScope'
import { emitForeignGroupsChange, emitSyncConflict } from '@/lib/foreignChange'
import { toast } from '@/lib/toast'

const {
  mockUseAuth,
  mockUseEntitlements,
  mockPushPendingChanges,
  mockPullRemoteChanges,
  mockSubscribeToRemoteChanges,
  mockGetGroupsState,
  mockSaveGroupsState,
  mockGetEncryptionKeyState,
  mockGetDataKey,
  mockGetSetting,
  mockSetSetting,
  mockMarkAllGroupsPendingSync,
  mockGetSessions,
  mockPushSessionToSupabase,
  mockClearLocalAccountData,
  mockCanUploadOnFirefox,
} = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockUseEntitlements: vi.fn(),
  mockPushPendingChanges: vi.fn().mockResolvedValue(undefined),
  mockPullRemoteChanges: vi.fn(),
  mockSubscribeToRemoteChanges: vi.fn().mockResolvedValue(vi.fn()),
  mockGetGroupsState: vi.fn(),
  mockSaveGroupsState: vi.fn().mockResolvedValue(undefined),
  // Existing tests below assume encryption is already set up (matches pre-default-on behavior).
  mockGetEncryptionKeyState: vi.fn().mockResolvedValue('present'),
  // Existing tests assume the data key is unlocked this session (a real CryptoKey, not null),
  // so push/pull actually run instead of hitting the new locked-skip gate.
  mockGetDataKey: vi.fn().mockReturnValue({}),
  // Existing tests assume the one-time re-encryption migration already ran, so it doesn't
  // interfere with their pushPendingChanges call-count assertions.
  mockGetSetting: vi.fn().mockResolvedValue(true),
  mockSetSetting: vi.fn().mockResolvedValue(undefined),
  mockMarkAllGroupsPendingSync: vi.fn().mockResolvedValue(undefined),
  mockGetSessions: vi.fn().mockResolvedValue([]),
  mockPushSessionToSupabase: vi.fn().mockResolvedValue(true),
  mockClearLocalAccountData: vi.fn().mockResolvedValue(undefined),
  mockCanUploadOnFirefox: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => mockUseEntitlements() }))
vi.mock('@/lib/syncEngine', () => ({
  pushPendingChanges: mockPushPendingChanges,
  pullRemoteChanges: mockPullRemoteChanges,
  subscribeToRemoteChanges: mockSubscribeToRemoteChanges,
  canUploadOnFirefox: mockCanUploadOnFirefox,
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
vi.mock('@/lib/localDb', async () => (await import('@/__tests__/unit/_helpers/updateGroupsStateMock')).withUpdateGroupsState({
  getGroupsState: mockGetGroupsState,
  saveGroupsState: mockSaveGroupsState,
  getSetting: mockGetSetting,
  setSetting: mockSetSetting,
  markAllGroupsPendingSync: mockMarkAllGroupsPendingSync,
  getSessions: mockGetSessions,
  clearLocalAccountData: mockClearLocalAccountData,
}))
vi.mock('@/lib/encryptionKey', () => ({
  getEncryptionKeyState: mockGetEncryptionKeyState,
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
  resetAccountScopeForTests()
  mockGetGroupsState.mockResolvedValue({ available: [nowOpen], active: { id: 'now', index: 0 } })
  mockPullRemoteChanges.mockResolvedValue([nowOpen])
  mockGetEncryptionKeyState.mockResolvedValue('present')
  mockGetDataKey.mockReturnValue({})
  mockCanUploadOnFirefox.mockResolvedValue(true)
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
    mockGetEncryptionKeyState.mockResolvedValue('absent')

    const qc = new QueryClient()
    renderHook(() => useSync(), { wrapper: makeWrapper(qc) })

    await waitFor(() => expect(useUIStore.getState().modal.type).toBe('encryptionSetup'))
    expect(mockPushPendingChanges).not.toHaveBeenCalled()
    expect(mockPullRemoteChanges).not.toHaveBeenCalled()

    mockGetEncryptionKeyState.mockResolvedValue('present')
  })

  it('closes the encryptionSetup modal and resumes syncing once a key exists', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true })
    mockGetEncryptionKeyState.mockResolvedValueOnce('absent').mockResolvedValue('present')
    useUIStore.setState({ modal: { type: null } })

    const qc = new QueryClient()
    renderHook(() => useSync(), { wrapper: makeWrapper(qc) })

    await waitFor(() => expect(mockPushPendingChanges).toHaveBeenCalled())
    await waitFor(() => expect(useUIStore.getState().modal.type).toBeNull())
  })
})

describe('useSync — encryption status that could not be checked', () => {
  it('opens no modal and skips push/pull; the next poll tries again', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true })
    mockGetEncryptionKeyState.mockResolvedValue('unknown')

    renderHook(() => useSync(), { wrapper: makeWrapper(new QueryClient()) })

    await waitFor(() => expect(mockGetEncryptionKeyState).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(useUIStore.getState().modal.type).toBeNull()
    expect(mockPushPendingChanges).not.toHaveBeenCalled()
    expect(mockPullRemoteChanges).not.toHaveBeenCalled()
    expect(mockGetDataKey).not.toHaveBeenCalled()
  })

  it('leaves an already-open setup/unlock modal alone (it shows its own retry)', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true })
    mockGetEncryptionKeyState.mockResolvedValue('unknown')
    useUIStore.getState().openModal('encryptionSetup')

    renderHook(() => useSync(), { wrapper: makeWrapper(new QueryClient()) })

    await waitFor(() => expect(mockGetEncryptionKeyState).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(useUIStore.getState().modal.type).toBe('encryptionSetup')
    useUIStore.getState().closeModal()
  })
})

describe('useSync — encryption migration self-heal', () => {
  it('marks all groups pendingSync and sets the migration flag when a key exists but the migration never ran (accounts that set up encryption before markAllGroupsPendingSync was wired into setup)', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true })
    mockGetEncryptionKeyState.mockResolvedValue('present')
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
    mockGetEncryptionKeyState.mockResolvedValue('present')
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
    mockPushSessionToSupabase.mockReset().mockResolvedValue(true)
  })

  it('re-uploads every locally-saved session and sets the sessions migration flag once, when it never ran', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true })
    mockGetEncryptionKeyState.mockResolvedValue('present')
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

  it.each([
    ['was skipped (not uploaded)', () => mockPushSessionToSupabase.mockResolvedValueOnce(true).mockResolvedValueOnce(false)],
    ['threw', () => mockPushSessionToSupabase.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('network down'))],
  ])('does NOT set the sessions flag when a push %s, so the next sync retries', async (_label, arrange) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true })
    mockGetEncryptionKeyState.mockResolvedValue('present')
    mockGetSetting.mockImplementation((key: string) =>
      Promise.resolve(key === 'sessionsEncryptionMigrationDone' ? false : true)
    )
    mockGetSessions.mockResolvedValue([{ id: 's1', name: 'A', groups: [], createdAt: 1 }, { id: 's2', name: 'B', groups: [], createdAt: 2 }])
    arrange()

    renderHook(() => useSync(), { wrapper: makeWrapper(new QueryClient()) })

    // the cycle went on to the groups sync (the self-heal never blocks it)...
    await waitFor(() => expect(mockPushPendingChanges).toHaveBeenCalled())
    expect(mockPushSessionToSupabase).toHaveBeenCalledTimes(2)
    // ...but the flag stays unset: one session is still not on the server
    expect(mockSetSetting).not.toHaveBeenCalledWith('sessionsEncryptionMigrationDone', true)
  })

  it('after a failed self-heal the same popup waits before retrying, then retries and sets the flag once every push succeeds', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
      mockUseEntitlements.mockReturnValue({ cloudSync: true })
      mockGetEncryptionKeyState.mockResolvedValue('present')
      // a settings store that remembers the flag, like the real one
      let sessionsDone = false
      mockGetSetting.mockImplementation((key: string) => Promise.resolve(key === 'sessionsEncryptionMigrationDone' ? sessionsDone : true))
      mockSetSetting.mockImplementation(async (key: string, value: unknown) => {
        if (key === 'sessionsEncryptionMigrationDone') sessionsDone = value as boolean
      })
      mockGetSessions.mockResolvedValue([{ id: 's1', name: 'A', groups: [], createdAt: 1 }])
      mockPushSessionToSupabase.mockResolvedValueOnce(false) // first attempt: not uploaded

      renderHook(() => useSync(), { wrapper: makeWrapper(new QueryClient()) })
      await vi.waitFor(() => expect(mockPushPendingChanges).toHaveBeenCalledTimes(1))
      expect(mockPushSessionToSupabase).toHaveBeenCalledTimes(1)

      // the next 30 s polls do not re-upload the sessions...
      await vi.advanceTimersByTimeAsync(60_000)
      expect(mockPushPendingChanges).toHaveBeenCalledTimes(3)
      expect(mockPushSessionToSupabase).toHaveBeenCalledTimes(1)
      expect(sessionsDone).toBe(false)

      // ...until the retry window (5 min) has passed; then one retry, and the flag is set for good
      await vi.advanceTimersByTimeAsync(5 * 60_000)
      expect(mockPushSessionToSupabase).toHaveBeenCalledTimes(2)
      expect(sessionsDone).toBe(true)
    } finally {
      mockSetSetting.mockReset().mockResolvedValue(undefined)
      vi.useRealTimers()
    }
  })

  it('does not attempt the sessions self-heal while uploads are not allowed (Firefox consent missing)', async () => {
    mockCanUploadOnFirefox.mockResolvedValue(false)
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true })
    mockGetEncryptionKeyState.mockResolvedValue('present')
    mockGetSetting.mockImplementation((key: string) =>
      Promise.resolve(key === 'sessionsEncryptionMigrationDone' ? false : true)
    )
    mockGetSessions.mockResolvedValue([{ id: 's1', name: 'A', groups: [], createdAt: 1 }])

    renderHook(() => useSync(), { wrapper: makeWrapper(new QueryClient()) })

    await waitFor(() => expect(mockPushPendingChanges).toHaveBeenCalled())
    expect(mockPushSessionToSupabase).not.toHaveBeenCalled()
    expect(mockSetSetting).not.toHaveBeenCalledWith('sessionsEncryptionMigrationDone', true)
  })

  it('does not re-run the sessions self-heal once its flag is already set', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true })
    mockGetEncryptionKeyState.mockResolvedValue('present')
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
    mockGetEncryptionKeyState.mockResolvedValue('present')
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
    mockGetEncryptionKeyState.mockResolvedValue('present')
    mockGetDataKey.mockReturnValue({})

    const qc = new QueryClient()
    renderHook(() => useSync(), { wrapper: makeWrapper(qc) })

    await waitFor(() => expect(mockPushPendingChanges).toHaveBeenCalled())
    expect(useUIStore.getState().modal.type).toBeNull()
  })
})

describe('useSync — Firefox sync-paused status (syncPausedReason)', () => {
  it('clears syncPausedReason once consent is confirmed granted', async () => {
    useUIStore.setState({ syncPausedReason: 'Sync paused: allow in Firefox' })
    mockCanUploadOnFirefox.mockResolvedValue(true)
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true })
    renderHook(() => useSync(), { wrapper: makeWrapper(new QueryClient()) })

    await waitFor(() => expect(useUIStore.getState().syncPausedReason).toBeNull())
  })

  it('sets syncPausedReason when browsingActivity consent is not granted (Firefox)', async () => {
    useUIStore.setState({ syncPausedReason: null })
    mockCanUploadOnFirefox.mockResolvedValue(false)
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true })
    renderHook(() => useSync(), { wrapper: makeWrapper(new QueryClient()) })

    await waitFor(() => expect(useUIStore.getState().syncPausedReason).toBe('Sync paused: allow in Firefox'))
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

  it('refreshes the groups cache from IDB when a remote update was applied', async () => {
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

    // last-write-wins is decided in syncEngine (inside updateGroupsState, before the write);
    // by the time the callback fires IDB already holds the winner, so the hook only re-reads it
    const applied = { ...existing, name: 'New', updatedAt: 200 }
    mockGetGroupsState.mockResolvedValue({ available: [nowOpen, applied], active: { id: 'now', index: 0 } })
    mockSaveGroupsState.mockClear()
    await onUpdate!(applied)

    await waitFor(() => {
      const cached = qc.getQueryData<{ available: Array<{ id: string; name: string }> }>(GROUPS_QUERY_KEY)
      expect(cached?.available.find((g) => g.id === 'x')?.name).toBe('New')
    })
    expect(mockSaveGroupsState).not.toHaveBeenCalled() // the hook itself never writes
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

describe('useSync — sync conflict toast (M6)', () => {
  it('tells the user which group kept both versions, with a stable toast id', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true, loading: false })
    const spy = vi.spyOn(toast, 'info').mockImplementation(() => 'id')
    renderHook(() => useSync(), { wrapper: makeWrapper(new QueryClient()) })
    emitSyncConflict(['Work', 'Play'])
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('"Work", "Play"'), { id: 'sync-conflict-copy' })
    spy.mockRestore()
  })
})

describe('useSync — cloudSyncActive flag (M7)', () => {
  it('is not written while entitlements are still loading (it would flip to false at every popup open)', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: false, loading: true })
    renderHook(() => useSync(), { wrapper: makeWrapper(new QueryClient()) })
    await new Promise((r) => setTimeout(r, 20))
    expect(mockSetSetting).not.toHaveBeenCalledWith('cloudSyncActive', expect.anything())
  })

  it('is written true once a cloud-sync user is known, and false for a known free user', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true, loading: false })
    const { unmount } = renderHook(() => useSync(), { wrapper: makeWrapper(new QueryClient()) })
    await waitFor(() => expect(mockSetSetting).toHaveBeenCalledWith('cloudSyncActive', true))
    unmount()
    mockUseEntitlements.mockReturnValue({ cloudSync: false, loading: false })
    renderHook(() => useSync(), { wrapper: makeWrapper(new QueryClient()) })
    await waitFor(() => expect(mockSetSetting).toHaveBeenCalledWith('cloudSyncActive', false))
  })

  it('clears the undo/redo history when a sync applied foreign changes', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: true, loading: false })
    useUIStore.setState({ undoStack: [{ available: [], active: { id: '', index: 0 } }], redoStack: [] })
    renderHook(() => useSync(), { wrapper: makeWrapper(new QueryClient()) })
    emitForeignGroupsChange()
    expect(useUIStore.getState().undoStack).toEqual([])
  })
})

describe('useSync — undo history across accounts (F5)', () => {
  const seedHistory = () => useUIStore.setState({ undoStack: [{ available: [], active: { id: '', index: 0 } }], redoStack: [{ available: [], active: { id: '', index: 0 } }] })

  it('is cleared when a different account signs in (the wipe)', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'userB' } } })
    mockUseEntitlements.mockReturnValue({ cloudSync: false, loading: false })
    mockGetSetting.mockImplementation((key: string, d: unknown) => Promise.resolve(key === 'lastSignedInUserId' ? 'userA' : d))
    seedHistory()
    renderHook(() => useSync(), { wrapper: makeWrapper(new QueryClient()) })
    await waitFor(() => expect(mockClearLocalAccountData).toHaveBeenCalled())
    await waitFor(() => expect(useUIStore.getState().undoStack).toEqual([]))
    expect(useUIStore.getState().redoStack).toEqual([])
  })

  it('is cleared on sign-out', async () => {
    mockUseAuth.mockReturnValue({ session: null })
    mockUseEntitlements.mockReturnValue({ cloudSync: false, loading: false })
    seedHistory()
    renderHook(() => useSync(), { wrapper: makeWrapper(new QueryClient()) })
    await waitFor(() => expect(useUIStore.getState().undoStack).toEqual([]))
  })
})
