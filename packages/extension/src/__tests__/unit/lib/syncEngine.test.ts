import { describe, it, expect, vi, beforeEach } from 'vitest'
import { pushPendingChanges, deleteRemoteGroups, pullRemoteChanges, subscribeToRemoteChanges, canUploadOnFirefox } from '@/lib/syncEngine'
import type { Group } from '@/lib/types'
import type { Session } from '@supabase/supabase-js'

const {
  mockGetPendingSyncGroups,
  mockMarkGroupSynced,
  mockMarkPositionSynced,
  mockSaveGroup,
  mockDeleteGroup,
  mockGetSession,
  mockGetEncryptionKeyState,
  mockGetDataKey,
  mockEncryptBlob,
  mockDecryptBlob,
  mockGetSetting,
  mockSetSetting,
  mockHasDataConsent,
  mockGetGroupsState,
  mockUpdateGroupsState,
} = vi.hoisted(() => ({
  mockGetPendingSyncGroups: vi.fn(),
  mockMarkGroupSynced: vi.fn(),
  mockMarkPositionSynced: vi.fn(),
  mockSaveGroup: vi.fn(),
  mockDeleteGroup: vi.fn(),
  mockGetSession: vi.fn(),
  mockGetEncryptionKeyState: vi.fn(),
  mockGetDataKey: vi.fn(),
  mockEncryptBlob: vi.fn(),
  mockDecryptBlob: vi.fn(),
  mockGetSetting: vi.fn(),
  mockSetSetting: vi.fn(),
  mockHasDataConsent: vi.fn().mockResolvedValue(true),
  mockGetGroupsState: vi.fn(),
  mockUpdateGroupsState: vi.fn(),
}))

vi.mock('@/lib/localDb', () => ({
  getPendingSyncGroups: mockGetPendingSyncGroups,
  markGroupSynced: mockMarkGroupSynced,
  markPositionSynced: mockMarkPositionSynced,
  saveGroup: mockSaveGroup,
  deleteGroup: mockDeleteGroup,
  getSetting: mockGetSetting,
  setSetting: mockSetSetting,
  getGroupsState: mockGetGroupsState,
  updateGroupsState: mockUpdateGroupsState,
  // pending-delete helpers, backed by the in-memory settingsStore below
  getPendingGroupDeletes: async () => (settingsStore['pendingDeleteGroupIds'] as string[] | undefined) ?? [],
  addPendingGroupDeletes: async (ids: string[]) => {
    settingsStore['pendingDeleteGroupIds'] = Array.from(new Set([...((settingsStore['pendingDeleteGroupIds'] as string[] | undefined) ?? []), ...ids]))
  },
  removePendingGroupDeletes: async (ids: string[]) => {
    settingsStore['pendingDeleteGroupIds'] = ((settingsStore['pendingDeleteGroupIds'] as string[] | undefined) ?? []).filter((id) => !ids.includes(id))
  },
}))

vi.mock('@/lib/encryptionKey', () => ({
  getEncryptionKeyState: mockGetEncryptionKeyState,
  getDataKey: mockGetDataKey,
}))

vi.mock('@tabmerger/shared', () => ({
  encryptBlob: mockEncryptBlob,
  decryptBlob: mockDecryptBlob,
  CONFLICT_COPY_SUFFIX: ' (conflict copy)',
  isEncryptedBlob: (v: unknown) =>
    !!v && typeof v === 'object' && 'v' in v && 'iv' in v && 'ct' in v,
  SYNC_DATA_CONSENT_CATEGORIES: ['browsingActivity'],
}))

vi.mock('@/lib/dataConsent', () => ({ hasDataConsent: mockHasDataConsent }))

// ─── Supabase mock — client/builder separation (client must NOT be thenable) ──

function makeBuilder(responses: Array<{ data: unknown; error: unknown }>) {
  const builder: Record<string, (...args: unknown[]) => unknown> = {}
  const method = () => vi.fn((..._args: unknown[]) => builder)
  builder.from = method()
  builder.select = method()
  builder.upsert = method()
  builder.insert = method()
  builder.limit = method()
  builder.gt = method()
  builder.abortSignal = method()
  builder.update = method()
  builder.delete = method()
  builder.eq = method()
  builder.in = method()
  builder.order = method()
  let idx = 0
  Object.defineProperty(builder, 'then', {
    get() {
      const r = responses[idx++] ?? { data: null, error: null }
      return (resolve: (v: unknown) => void) => Promise.resolve(r).then(resolve)
    },
    configurable: true,
    enumerable: false,
  })
  return builder
}

let currentBuilder: ReturnType<typeof makeBuilder>
const mockChannelOn = vi.fn()
const mockChannelSubscribe = vi.fn()
const mockChannel = vi.fn()
const mockRemoveChannel = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((...args: unknown[]) => currentBuilder.from(...args)),
    auth: { getSession: mockGetSession },
    channel: (...args: unknown[]) => mockChannel(...args),
    removeChannel: (...args: unknown[]) => mockRemoveChannel(...args),
  },
}))

function makeSession(userId = 'u1'): Session {
  return { user: { id: userId } } as unknown as Session
}

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: 'g1', name: 'Work', color: 'rgba(1,1,1,1)', updatedAt: 1000,
    windows: [], permanent: false, starred: false, ...overrides,
  }
}

/** In-memory stand-in for the real IDB-backed settings store, so getSetting/setSetting
 * calls made by deleteRemoteGroups and pullRemoteChanges actually persist across calls. */
let settingsStore: Record<string, unknown>
let localState: { active: { id: string; index: number }; available: Group[] }

beforeEach(() => {
  vi.clearAllMocks()
  currentBuilder = makeBuilder([])
  mockChannel.mockReturnValue({ on: mockChannelOn.mockReturnThis(), subscribe: mockChannelSubscribe.mockReturnThis() })
  // steady state of a Pro account: key set up and unlocked (no content is uploaded otherwise)
  mockGetEncryptionKeyState.mockResolvedValue('present')
  mockGetDataKey.mockReturnValue({})
  mockEncryptBlob.mockResolvedValue({ iv: 'iv-stub', ct: 'ct-stub' })
  mockHasDataConsent.mockResolvedValue(true)

  settingsStore = { remoteBaseSeeded: true } // post-upgrade: no legacy probing (that path is covered by the integration suite)
  // updateGroupsState: hand the callback the current local state (localState) and keep its result
  localState = { active: { id: 'now', index: 0 }, available: [makeGroup({ id: 'now', permanent: true })] }
  mockGetGroupsState.mockImplementation(async () => localState)
  mockUpdateGroupsState.mockImplementation(async (fn: (s: unknown, aux: unknown) => unknown) => {
    const next = fn(localState, { pendingDeletes: new Set((settingsStore['pendingDeleteGroupIds'] as string[] | undefined) ?? []) })
    if (next) localState = next as typeof localState
    return localState
  })
  mockGetSetting.mockImplementation(async (key: string, defaultValue: unknown) =>
    key in settingsStore ? settingsStore[key] : defaultValue
  )
  mockSetSetting.mockImplementation(async (key: string, value: unknown) => {
    settingsStore[key] = value
  })
})

describe('canUploadOnFirefox', () => {
  it('delegates straight to hasDataConsent with the shared browsingActivity category', async () => {
    mockHasDataConsent.mockResolvedValue(false)
    await expect(canUploadOnFirefox()).resolves.toBe(false)
    expect(mockHasDataConsent).toHaveBeenCalledWith(['browsingActivity'])
  })
})

/** Marks groups as pending push AND places them in the local sidebar order (index = position). */
function pending(groups: Group[]) {
  mockGetPendingSyncGroups.mockResolvedValue(groups)
  localState.available.push(...groups.filter((g) => !g.permanent))
}

describe('pushPendingChanges', () => {
  it('excludes permanent groups even if they were somehow marked pending', async () => {
    pending([makeGroup({ id: 'now', permanent: true })])
    currentBuilder = makeBuilder([{ data: [{ updated_at: 'S1' }], error: null }])
    await pushPendingChanges(makeSession())
    expect(currentBuilder.insert).not.toHaveBeenCalled()
  })

  it('upserts each pending group and marks it synced on success', async () => {
    pending([makeGroup({ id: 'g1' }), makeGroup({ id: 'g2' })])
    currentBuilder = makeBuilder([{ data: [{ updated_at: 'S1' }], error: null }, { data: [{ updated_at: 'S1' }], error: null }])
    await pushPendingChanges(makeSession('u1'))
    expect(currentBuilder.insert).toHaveBeenCalledTimes(2)
    // each row carries position = the group index in the local sidebar order
    expect(currentBuilder.insert).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'g1', position: 1 }))
    expect(currentBuilder.insert).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'g2', position: 2 }))
    expect(mockMarkGroupSynced).toHaveBeenCalledWith('g1', 1000, 1, 'S1', expect.objectContaining({ id: 'g1' }))
    expect(mockMarkGroupSynced).toHaveBeenCalledWith('g2', 1000, 2, 'S1', expect.objectContaining({ id: 'g2' }))
  })

  it('does not mark synced when the upsert errors, and continues to the next group', async () => {
    pending([makeGroup({ id: 'g1' }), makeGroup({ id: 'g2' })])
    currentBuilder = makeBuilder([{ data: null, error: { message: 'fail' } }, { data: [{ updated_at: 'S1' }], error: null }])
    await pushPendingChanges(makeSession('u1'))
    expect(mockMarkGroupSynced).not.toHaveBeenCalledWith('g1', 1000, 1, 'S1', expect.objectContaining({ id: 'g1' }))
    expect(mockMarkGroupSynced).toHaveBeenCalledWith('g2', 1000, 2, 'S1', expect.objectContaining({ id: 'g2' }))
  })

  it('skips (never pushes at position 0) a pending group that is not in the local order', async () => {
    mockGetPendingSyncGroups.mockResolvedValue([makeGroup({ id: 'ghost' })]) // not placed in localState
    currentBuilder = makeBuilder([{ data: [{ updated_at: 'S1' }], error: null }])
    await pushPendingChanges(makeSession('u1'))
    expect(currentBuilder.insert).not.toHaveBeenCalled()
    expect(mockMarkGroupSynced).not.toHaveBeenCalled()
  })

  it('pushes a reorder as a position-only update for a clean group, and only for groups with positionDirty', async () => {
    mockGetPendingSyncGroups.mockResolvedValue([])
    localState.available.push(makeGroup({ id: 'g1', positionDirty: true }), makeGroup({ id: 'g2' }), makeGroup({ id: 'g3', positionDirty: true, pendingSync: true }))
    currentBuilder = makeBuilder([{ data: [{ updated_at: 'S1' }], error: null }])
    await pushPendingChanges(makeSession('u1'))
    expect(currentBuilder.insert).not.toHaveBeenCalled()
    expect(currentBuilder.update).toHaveBeenCalledTimes(1) // g2 is clean, g3 goes with its content push
    expect(currentBuilder.update).toHaveBeenCalledWith({ position: 1 })
    expect(mockMarkPositionSynced).toHaveBeenCalledWith('g1', 1, undefined)
  })

  it('a group with a server base is pushed as a compare-and-swap update guarded by that stamp', async () => {
    pending([makeGroup({ id: 'g1', remoteUpdatedAt: 'BASE' })])
    currentBuilder = makeBuilder([{ data: [{ updated_at: 'NEW' }], error: null }])
    await pushPendingChanges(makeSession('u1'))
    expect(currentBuilder.insert).not.toHaveBeenCalled()
    expect(currentBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1' }))
    expect(currentBuilder.eq).toHaveBeenCalledWith('updated_at', 'BASE')
    expect(mockMarkGroupSynced).toHaveBeenCalledWith('g1', 1000, 1, 'NEW', expect.objectContaining({ id: 'g1' })) // the returned stamp is the new base
  })

  it('zero rows back (the row changed on the server) leaves the group pending: nothing is marked synced', async () => {
    pending([makeGroup({ id: 'g1', remoteUpdatedAt: 'BASE' })])
    currentBuilder = makeBuilder([{ data: [], error: null }])
    await pushPendingChanges(makeSession('u1'))
    expect(mockMarkGroupSynced).not.toHaveBeenCalled()
  })

  it('a unique violation on the insert of a new group is a conflict for the merge, not an error', async () => {
    pending([makeGroup({ id: 'g1' })])
    currentBuilder = makeBuilder([{ data: null, error: { code: '23505', message: 'duplicate key' } }])
    await pushPendingChanges(makeSession('u1'))
    expect(mockMarkGroupSynced).not.toHaveBeenCalled()
  })

  it('a position-only push is guarded by the base and stores the stamp the server returned', async () => {
    localState.available.push(makeGroup({ id: 'g1', positionDirty: true, remoteUpdatedAt: 'BASE' }))
    mockGetPendingSyncGroups.mockResolvedValue([])
    currentBuilder = makeBuilder([{ data: [{ updated_at: 'BUMPED' }], error: null }])
    await pushPendingChanges(makeSession('u1'))
    expect(currentBuilder.eq).toHaveBeenCalledWith('updated_at', 'BASE')
    expect(mockMarkPositionSynced).toHaveBeenCalledWith('g1', 1, 'BUMPED')
  })

  it('a position-only push whose guard matches nothing stays dirty (the pull adopts the other change first)', async () => {
    localState.available.push(makeGroup({ id: 'g1', positionDirty: true, remoteUpdatedAt: 'BASE' }))
    mockGetPendingSyncGroups.mockResolvedValue([])
    currentBuilder = makeBuilder([{ data: [], error: null }])
    await pushPendingChanges(makeSession('u1'))
    expect(mockMarkPositionSynced).not.toHaveBeenCalled()
  })

  it('is a no-op when there are no pending groups', async () => {
    pending([])
    await pushPendingChanges(makeSession())
    expect(currentBuilder.insert).not.toHaveBeenCalled()
  })

  it('(Firefox) skips the push entirely when browsingActivity consent is not granted', async () => {
    mockHasDataConsent.mockResolvedValue(false)
    pending([makeGroup({ id: 'g1' })])
    await pushPendingChanges(makeSession('u1'))
    expect(mockHasDataConsent).toHaveBeenCalledWith(['browsingActivity'])
    expect(mockGetPendingSyncGroups).not.toHaveBeenCalled()
    expect(currentBuilder.insert).not.toHaveBeenCalled()
  })
})

describe('pushGroup — encryption', () => {
  it('encrypts name/windows/note/info into the windows column and blanks the plaintext columns when unlocked', async () => {
    pending([makeGroup({ id: 'g1', name: 'Secret', note: 'shh' })])
    mockGetEncryptionKeyState.mockResolvedValue('present')
    mockGetDataKey.mockReturnValue({ fake: 'key' })
    mockEncryptBlob.mockResolvedValue({ iv: 'iv1', ct: 'ct1' })
    currentBuilder = makeBuilder([{ data: [{ updated_at: 'S1' }], error: null }])

    await pushPendingChanges(makeSession('u1'))

    expect(mockEncryptBlob).toHaveBeenCalledWith({ fake: 'key' }, expect.objectContaining({ name: 'Secret' }))
    expect(currentBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: '', note: null, info: '', windows: { v: 1, iv: 'iv1', ct: 'ct1' } })
    )
    expect(mockMarkGroupSynced).toHaveBeenCalledWith('g1', 1000, 1, 'S1', expect.objectContaining({ id: 'g1' }))
  })

  it('an unexpected throw pushing one group (e.g. encryptBlob failing) does not abort the rest of the batch', async () => {
    pending([makeGroup({ id: 'g1' }), makeGroup({ id: 'g2' })])
    mockGetEncryptionKeyState.mockResolvedValue('present')
    mockGetDataKey.mockReturnValue({ fake: 'key' })
    mockEncryptBlob.mockRejectedValueOnce(new Error('malformed content')).mockResolvedValueOnce({ iv: 'iv2', ct: 'ct2' })
    currentBuilder = makeBuilder([{ data: [{ updated_at: 'S1' }], error: null }])

    await pushPendingChanges(makeSession('u1'))

    expect(mockMarkGroupSynced).not.toHaveBeenCalledWith('g1', 1000, 1, 'S1', expect.objectContaining({ id: 'g1' }))
    expect(mockMarkGroupSynced).toHaveBeenCalledWith('g2', 1000, 2, 'S1', expect.objectContaining({ id: 'g2' }))
  })

  it('skips the push (leaves pendingSync) when encryption is enabled but the key is locked', async () => {
    pending([makeGroup({ id: 'g1' })])
    mockGetEncryptionKeyState.mockResolvedValue('present')
    mockGetDataKey.mockReturnValue(null)

    await pushPendingChanges(makeSession('u1'))

    expect(currentBuilder.upsert).not.toHaveBeenCalled()
    expect(mockMarkGroupSynced).not.toHaveBeenCalled()
  })

  it.each(['absent', 'unknown'] as const)('sends NOTHING (never a plaintext row) when the encryption key state is %s, and leaves the group pending', async (state) => {
    pending([makeGroup({ id: 'g1' })])
    mockGetEncryptionKeyState.mockResolvedValue(state)

    await pushPendingChanges(makeSession('u1'))

    expect(currentBuilder.insert).not.toHaveBeenCalled()
    expect(currentBuilder.update).not.toHaveBeenCalled()
    expect(currentBuilder.upsert).not.toHaveBeenCalled()
    expect(mockMarkGroupSynced).not.toHaveBeenCalled()
  })

  it('bounds every request with an abort signal (shared sync timeout)', async () => {
    pending([makeGroup({ id: 'g1' })])
    currentBuilder = makeBuilder([{ data: [{ updated_at: 'S1' }], error: null }])

    await pushPendingChanges(makeSession('u1'))

    expect(currentBuilder.insert).toHaveBeenCalledTimes(1)
    expect(currentBuilder.abortSignal).toHaveBeenCalledTimes(1)
    expect(currentBuilder.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal))
  })
})

describe('deleteRemoteGroups', () => {
  it('no-ops when ids is empty', async () => {
    await deleteRemoteGroups([])
    expect(mockGetSession).not.toHaveBeenCalled()
  })

  it('no-ops when there is no active session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    await deleteRemoteGroups(['g1'])
    expect(currentBuilder.delete).not.toHaveBeenCalled()
  })

  it('deletes matching remote rows scoped to the session user', async () => {
    mockGetSession.mockResolvedValue({ data: { session: makeSession('u1') } })
    currentBuilder = makeBuilder([{ data: null, error: null }])
    await deleteRemoteGroups(['g1', 'g2'])
    expect(currentBuilder.delete).toHaveBeenCalled()
    expect(currentBuilder.in).toHaveBeenCalledWith('id', ['g1', 'g2'])
    expect(currentBuilder.eq).toHaveBeenCalledWith('user_id', 'u1')
  })

  it('does not record ids when there is no session (nothing was ever pushed, the set would only grow)', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    await deleteRemoteGroups(['g1'])
    expect(settingsStore['pendingDeleteGroupIds']).toBeUndefined()
  })

  it('records the ids as pending-delete before the network call when signed in', async () => {
    mockGetSession.mockResolvedValue({ data: { session: makeSession('u1') } })
    currentBuilder = makeBuilder([{ data: null, error: { message: 'offline' } }])
    await deleteRemoteGroups(['g1'])
    expect(settingsStore['pendingDeleteGroupIds']).toEqual(['g1']) // kept although the DELETE failed
  })

  it('sends the DELETE in chunks of 100 ids', async () => {
    mockGetSession.mockResolvedValue({ data: { session: makeSession('u1') } })
    currentBuilder = makeBuilder([{ data: null, error: null }, { data: null, error: null }, { data: null, error: null }])
    const ids = Array.from({ length: 250 }, (_, i) => `g${i}`)
    await deleteRemoteGroups(ids)
    const sizes = (currentBuilder.in as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as string[]).length)
    expect(sizes).toEqual([100, 100, 50])
  })
})

describe('pullRemoteChanges', () => {
  it('falls back to local groups on a fetch error', async () => {
    currentBuilder = makeBuilder([{ data: null, error: { message: 'down' } }])
    const local = [makeGroup({ id: 'local1' })]
    const result = await pullRemoteChanges(makeSession(), local)
    expect(result).toEqual(local)
  })

  it('last-write-wins: remote wins when its updatedAt is newer, and saves it locally', async () => {
    currentBuilder = makeBuilder([{
      data: [{ id: 'g1', name: 'Remote Name', color: '#fff', updated_at: new Date(5000).toISOString(), windows: [], starred: false, archived: false, note: null, info: '' }],
      error: null,
    }])
    const local = [makeGroup({ id: 'g1', name: 'Local Name', updatedAt: 1000 })]
    const result = await pullRemoteChanges(makeSession(), local)
    expect(result.find((g) => g.id === 'g1')?.name).toBe('Remote Name')
    expect(mockSaveGroup).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1', name: 'Remote Name' }))
  })

  it('last-write-wins: keeps local when it is newer', async () => {
    currentBuilder = makeBuilder([{
      data: [{ id: 'g1', name: 'Remote Name', color: '#fff', updated_at: new Date(1000).toISOString(), windows: [], starred: false, archived: false, note: null, info: '' }],
      error: null,
    }])
    const local = [makeGroup({ id: 'g1', name: 'Local Name', updatedAt: 5000 })]
    const result = await pullRemoteChanges(makeSession(), local)
    expect(result.find((g) => g.id === 'g1')?.name).toBe('Local Name')
  })

  it('keeps the Now Open (permanent) group first in the merged result', async () => {
    currentBuilder = makeBuilder([{ data: [], error: null }])
    const local = [
      makeGroup({ id: 'saved1', updatedAt: 9999 }),
      makeGroup({ id: 'now', permanent: true, updatedAt: 1 }),
    ]
    const result = await pullRemoteChanges(makeSession(), local)
    expect(result[0].id).toBe('now')
  })

  it('decrypts rows in the {v:1,iv,ct} shape when unlocked', async () => {
    mockGetDataKey.mockReturnValue({ fake: 'key' })
    mockDecryptBlob.mockResolvedValue({ name: 'Decrypted', windows: [], note: undefined, info: '' })
    currentBuilder = makeBuilder([{
      data: [{ id: 'g1', name: '', color: '#fff', updated_at: new Date(5000).toISOString(), windows: { v: 1, iv: 'iv', ct: 'ct' }, starred: false, archived: false, note: null, info: '' }],
      error: null,
    }])
    const result = await pullRemoteChanges(makeSession(), [])
    expect(result.find((g) => g.id === 'g1')?.name).toBe('Decrypted')
    expect(mockDecryptBlob).toHaveBeenCalledWith({ fake: 'key' }, { v: 1, iv: 'iv', ct: 'ct' })
  })

  it('skips (does not merge) an encrypted row when the key is locked', async () => {
    mockGetDataKey.mockReturnValue(null)
    currentBuilder = makeBuilder([{
      data: [{ id: 'g1', name: '', color: '#fff', updated_at: new Date(5000).toISOString(), windows: { v: 1, iv: 'iv', ct: 'ct' }, starred: false, archived: false, note: null, info: '' }],
      error: null,
    }])
    const result = await pullRemoteChanges(makeSession(), [])
    expect(result.find((g) => g.id === 'g1')).toBeUndefined()
    expect(mockDecryptBlob).not.toHaveBeenCalled()
  })

  it('does not resurrect a group whose remote delete is still in flight (pending-delete race guard)', async () => {
    // Simulate: useDeleteGroup already called deleteRemoteGroups([g1]) (marks pending, fires DELETE),
    // but a sync poll's pullRemoteChanges races ahead and still sees the row on Supabase.
    settingsStore['pendingDeleteGroupIds'] = ['g1']
    currentBuilder = makeBuilder([{
      data: [{ id: 'g1', name: 'Still Remote', color: '#fff', updated_at: new Date(9999).toISOString(), windows: [], starred: false, archived: false, note: null, info: '' }],
      error: null,
    }])
    // Local group is already gone (optimistic delete already applied to IndexedDB)
    const result = await pullRemoteChanges(makeSession(), [])
    expect(result.find((g) => g.id === 'g1')).toBeUndefined()
    expect(mockSaveGroup).not.toHaveBeenCalled()
  })

  it('self-heals: clears a pending-delete id once the row is confirmed gone from remote', async () => {
    settingsStore['pendingDeleteGroupIds'] = ['g1', 'g2']
    // g1's delete has since landed on Supabase (no longer in the remote payload); g2 is still in flight
    currentBuilder = makeBuilder([{
      data: [{ id: 'g2', name: 'Still Pending', color: '#fff', updated_at: new Date(1).toISOString(), windows: [], starred: false, archived: false, note: null, info: '' }],
      error: null,
    }])
    await pullRemoteChanges(makeSession(), [])
    expect(settingsStore['pendingDeleteGroupIds']).toEqual(['g2'])
  })

  it('removes a group that was deleted remotely: previously-synced (pendingSync:false), absent from remote, not in this device\'s own pendingDeleteGroupIds', async () => {
    currentBuilder = makeBuilder([{ data: [], error: null }])
    const local = [makeGroup({ id: 'g1', pendingSync: false })]
    const result = await pullRemoteChanges(makeSession(), local)
    expect(result.find((g) => g.id === 'g1')).toBeUndefined()
    expect(mockDeleteGroup).toHaveBeenCalledWith('g1')
    // must not be re-pushed — deleteGroup, not saveGroup/upsert
    expect(mockSaveGroup).not.toHaveBeenCalled()
  })

  it('keeps a genuinely new/unpushed local-only group (pendingSync:true) and does not delete it', async () => {
    currentBuilder = makeBuilder([{ data: [], error: null }])
    const local = [makeGroup({ id: 'g1', pendingSync: true })]
    const result = await pullRemoteChanges(makeSession(), local)
    expect(result.find((g) => g.id === 'g1')).toBeDefined()
    expect(mockDeleteGroup).not.toHaveBeenCalled()
  })

  it('does not delete this device\'s own recent delete (pendingDeleteGroupIds wins over the new remote-deletion logic)', async () => {
    settingsStore['pendingDeleteGroupIds'] = ['g1']
    currentBuilder = makeBuilder([{ data: [], error: null }])
    const local = [makeGroup({ id: 'g1', pendingSync: false })]
    const result = await pullRemoteChanges(makeSession(), local)
    expect(result.find((g) => g.id === 'g1')).toBeUndefined()
    // Already handled by the pendingDeleteSet `continue` guard — deleteGroup should not be called again
    expect(mockDeleteGroup).not.toHaveBeenCalled()
  })

  it('never deletes the permanent Now Open group even if pendingSync:false and absent from remote', async () => {
    currentBuilder = makeBuilder([{ data: [], error: null }])
    const local = [makeGroup({ id: 'now', permanent: true, pendingSync: false })]
    const result = await pullRemoteChanges(makeSession(), local)
    expect(result.find((g) => g.id === 'now')).toBeDefined()
    expect(mockDeleteGroup).not.toHaveBeenCalled()
  })

  it('deduplicates permanent groups, keeping the one with the lowest updatedAt', async () => {
    currentBuilder = makeBuilder([{
      data: [{ id: 'now-remote', name: 'Now Open', color: '#fff', updated_at: new Date(500).toISOString(), windows: [], starred: false, archived: false, note: null, info: '' }],
      error: null,
    }])
    const local = [makeGroup({ id: 'now-local', permanent: true, updatedAt: 100 })]
    const result = await pullRemoteChanges(makeSession(), local)
    const permanents = result.filter((g) => g.permanent)
    expect(permanents).toHaveLength(1)
  })
})

describe('subscribeToRemoteChanges', () => {
  it('deletes the local group immediately on a live Realtime DELETE event', async () => {
    let handler: (payload: unknown) => Promise<void> = async () => {}
    mockChannelOn.mockImplementation((_event, _filter, cb) => {
      handler = cb
      return { subscribe: mockChannelSubscribe.mockReturnValue({}) }
    })
    const onUpdate = vi.fn()
    await subscribeToRemoteChanges(makeSession('u1'), onUpdate)

    localState.available.push(makeGroup({ id: 'g1', pendingSync: false }))
    await handler({ eventType: 'DELETE', old: { id: 'g1' } })
    expect(localState.available.map((g) => g.id)).toEqual(['now']) // removed through updateGroupsState
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1' })) // popup refreshes
  })

  it('a Realtime DELETE never removes a group with an unpushed change (incl. one an undo just restored)', async () => {
    let handler: (payload: unknown) => Promise<void> = async () => {}
    mockChannelOn.mockImplementation((_event, _filter, cb) => {
      handler = cb
      return { subscribe: mockChannelSubscribe.mockReturnValue({}) }
    })
    const onUpdate = vi.fn()
    await subscribeToRemoteChanges(makeSession('u1'), onUpdate)

    localState.available.push(makeGroup({ id: 'g1', pendingSync: true }))
    await handler({ eventType: 'DELETE', old: { id: 'g1' } })
    expect(localState.available.map((g) => g.id)).toEqual(['now', 'g1'])
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('skips the Realtime DELETE if this device already has the id in pendingDeleteGroupIds (avoids a redundant second delete)', async () => {
    settingsStore['pendingDeleteGroupIds'] = ['g1']
    let handler: (payload: unknown) => Promise<void> = async () => {}
    mockChannelOn.mockImplementation((_event, _filter, cb) => {
      handler = cb
      return { subscribe: mockChannelSubscribe.mockReturnValue({}) }
    })
    await subscribeToRemoteChanges(makeSession('u1'), vi.fn())

    await handler({ eventType: 'DELETE', old: { id: 'g1' } })
    expect(mockDeleteGroup).not.toHaveBeenCalled()
  })

  it('saves and forwards updates for INSERT/UPDATE events', async () => {
    let handler: (payload: unknown) => Promise<void> = async () => {}
    mockChannelOn.mockImplementation((_event, _filter, cb) => {
      handler = cb
      return { subscribe: mockChannelSubscribe.mockReturnValue({}) }
    })
    const onUpdate = vi.fn()
    await subscribeToRemoteChanges(makeSession('u1'), onUpdate)

    await handler({
      eventType: 'UPDATE',
      new: { id: 'g1', name: 'X', color: '#fff', updated_at: new Date().toISOString(), windows: [], starred: false, archived: false, note: null, info: '' },
    })
    expect(localState.available.map((g) => g.id)).toEqual(['now', 'g1'])
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1' }))
  })

  it('compares last-write-wins BEFORE writing: an older remote row leaves a newer local edit alone', async () => {
    let handler: (payload: unknown) => Promise<void> = async () => {}
    mockChannelOn.mockImplementation((_event, _filter, cb) => {
      handler = cb
      return { subscribe: mockChannelSubscribe.mockReturnValue({}) }
    })
    localState.available.push(makeGroup({ id: 'g1', name: 'Local newer', updatedAt: 5000, pendingSync: true }))
    const onUpdate = vi.fn()
    await subscribeToRemoteChanges(makeSession('u1'), onUpdate)

    await handler({
      eventType: 'UPDATE',
      new: { id: 'g1', name: 'Remote older', color: '#fff', updated_at: new Date(1000).toISOString(), windows: [], starred: false, archived: false, note: null, info: '' },
    })

    expect(localState.available.find((g) => g.id === 'g1')?.name).toBe('Local newer')
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('does not re-create a group this device is deleting (id in the pending-delete set)', async () => {
    let handler: (payload: unknown) => Promise<void> = async () => {}
    mockChannelOn.mockImplementation((_event, _filter, cb) => {
      handler = cb
      return { subscribe: mockChannelSubscribe.mockReturnValue({}) }
    })
    settingsStore['pendingDeleteGroupIds'] = ['g1']
    const onUpdate = vi.fn()
    await subscribeToRemoteChanges(makeSession('u1'), onUpdate)

    await handler({
      eventType: 'INSERT',
      new: { id: 'g1', name: 'X', color: '#fff', updated_at: new Date(9000).toISOString(), windows: [], starred: false, archived: false, note: null, info: '' },
    })

    expect(localState.available.map((g) => g.id)).toEqual(['now'])
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('skips saving/forwarding an encrypted row when the key is locked', async () => {
    let handler: (payload: unknown) => Promise<void> = async () => {}
    mockChannelOn.mockImplementation((_event, _filter, cb) => {
      handler = cb
      return { subscribe: mockChannelSubscribe.mockReturnValue({}) }
    })
    mockGetDataKey.mockReturnValue(null)
    const onUpdate = vi.fn()
    await subscribeToRemoteChanges(makeSession('u1'), onUpdate)

    await handler({
      eventType: 'UPDATE',
      new: { id: 'g1', name: '', color: '#fff', updated_at: new Date().toISOString(), windows: { v: 1, iv: 'iv', ct: 'ct' }, starred: false, archived: false, note: null, info: '' },
    })
    expect(mockSaveGroup).not.toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('returns an unsubscribe function that calls removeChannel', async () => {
    mockChannelOn.mockReturnValue({ subscribe: mockChannelSubscribe.mockReturnValue({}) })
    const unsubscribe = await subscribeToRemoteChanges(makeSession(), vi.fn())
    unsubscribe()
    expect(mockRemoveChannel).toHaveBeenCalled()
  })
})
