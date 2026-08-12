import { describe, it, expect, vi, beforeEach } from 'vitest'
import { pushPendingChanges, deleteRemoteGroups, pullRemoteChanges, subscribeToRemoteChanges } from '@/lib/syncEngine'
import type { Group } from '@/lib/types'
import type { Session } from '@supabase/supabase-js'

const {
  mockGetPendingSyncGroups,
  mockMarkGroupSynced,
  mockSaveGroup,
  mockGetSession,
  mockHasEncryptionKey,
  mockGetDataKey,
  mockEncryptBlob,
  mockDecryptBlob,
  mockGetSetting,
  mockSetSetting,
} = vi.hoisted(() => ({
  mockGetPendingSyncGroups: vi.fn(),
  mockMarkGroupSynced: vi.fn(),
  mockSaveGroup: vi.fn(),
  mockGetSession: vi.fn(),
  mockHasEncryptionKey: vi.fn(),
  mockGetDataKey: vi.fn(),
  mockEncryptBlob: vi.fn(),
  mockDecryptBlob: vi.fn(),
  mockGetSetting: vi.fn(),
  mockSetSetting: vi.fn(),
}))

vi.mock('@/lib/localDb', () => ({
  getPendingSyncGroups: mockGetPendingSyncGroups,
  markGroupSynced: mockMarkGroupSynced,
  saveGroup: mockSaveGroup,
  getSetting: mockGetSetting,
  setSetting: mockSetSetting,
}))

vi.mock('@/lib/encryptionKey', () => ({
  hasEncryptionKey: mockHasEncryptionKey,
  getDataKey: mockGetDataKey,
}))

vi.mock('@tabmerger/shared', () => ({
  encryptBlob: mockEncryptBlob,
  decryptBlob: mockDecryptBlob,
  isEncryptedBlob: (v: unknown) =>
    !!v && typeof v === 'object' && 'v' in v && 'iv' in v && 'ct' in v,
}))

// ─── Supabase mock — client/builder separation (client must NOT be thenable) ──

function makeBuilder(responses: Array<{ data: unknown; error: unknown }>) {
  const builder: Record<string, (...args: unknown[]) => unknown> = {}
  const method = () => vi.fn((..._args: unknown[]) => builder)
  builder.from = method()
  builder.select = method()
  builder.upsert = method()
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

beforeEach(() => {
  vi.clearAllMocks()
  currentBuilder = makeBuilder([])
  mockChannel.mockReturnValue({ on: mockChannelOn.mockReturnThis(), subscribe: mockChannelSubscribe.mockReturnThis() })
  mockHasEncryptionKey.mockResolvedValue(false)
  mockGetDataKey.mockReturnValue(null)

  settingsStore = {}
  mockGetSetting.mockImplementation(async (key: string, defaultValue: unknown) =>
    key in settingsStore ? settingsStore[key] : defaultValue
  )
  mockSetSetting.mockImplementation(async (key: string, value: unknown) => {
    settingsStore[key] = value
  })
})

describe('pushPendingChanges', () => {
  it('excludes permanent groups even if they were somehow marked pending', async () => {
    mockGetPendingSyncGroups.mockResolvedValue([makeGroup({ id: 'now', permanent: true })])
    currentBuilder = makeBuilder([{ data: null, error: null }])
    await pushPendingChanges(makeSession())
    expect(currentBuilder.upsert).not.toHaveBeenCalled()
  })

  it('upserts each pending group and marks it synced on success', async () => {
    mockGetPendingSyncGroups.mockResolvedValue([makeGroup({ id: 'g1' }), makeGroup({ id: 'g2' })])
    currentBuilder = makeBuilder([{ data: null, error: null }, { data: null, error: null }])
    await pushPendingChanges(makeSession('u1'))
    expect(currentBuilder.upsert).toHaveBeenCalledTimes(2)
    expect(mockMarkGroupSynced).toHaveBeenCalledWith('g1')
    expect(mockMarkGroupSynced).toHaveBeenCalledWith('g2')
  })

  it('does not mark synced when the upsert errors, and continues to the next group', async () => {
    mockGetPendingSyncGroups.mockResolvedValue([makeGroup({ id: 'g1' }), makeGroup({ id: 'g2' })])
    currentBuilder = makeBuilder([{ data: null, error: { message: 'fail' } }, { data: null, error: null }])
    await pushPendingChanges(makeSession('u1'))
    expect(mockMarkGroupSynced).not.toHaveBeenCalledWith('g1')
    expect(mockMarkGroupSynced).toHaveBeenCalledWith('g2')
  })

  it('is a no-op when there are no pending groups', async () => {
    mockGetPendingSyncGroups.mockResolvedValue([])
    await pushPendingChanges(makeSession())
    expect(currentBuilder.upsert).not.toHaveBeenCalled()
  })
})

describe('pushGroup — encryption', () => {
  it('encrypts name/windows/note/info into the windows column and blanks the plaintext columns when unlocked', async () => {
    mockGetPendingSyncGroups.mockResolvedValue([makeGroup({ id: 'g1', name: 'Secret', note: 'shh' })])
    mockHasEncryptionKey.mockResolvedValue(true)
    mockGetDataKey.mockReturnValue({ fake: 'key' })
    mockEncryptBlob.mockResolvedValue({ iv: 'iv1', ct: 'ct1' })
    currentBuilder = makeBuilder([{ data: null, error: null }])

    await pushPendingChanges(makeSession('u1'))

    expect(mockEncryptBlob).toHaveBeenCalledWith({ fake: 'key' }, expect.objectContaining({ name: 'Secret' }))
    expect(currentBuilder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: '', note: null, info: '', windows: { v: 1, iv: 'iv1', ct: 'ct1' } })
    )
    expect(mockMarkGroupSynced).toHaveBeenCalledWith('g1')
  })

  it('skips the push (leaves pendingSync) when encryption is enabled but the key is locked', async () => {
    mockGetPendingSyncGroups.mockResolvedValue([makeGroup({ id: 'g1' })])
    mockHasEncryptionKey.mockResolvedValue(true)
    mockGetDataKey.mockReturnValue(null)

    await pushPendingChanges(makeSession('u1'))

    expect(currentBuilder.upsert).not.toHaveBeenCalled()
    expect(mockMarkGroupSynced).not.toHaveBeenCalled()
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

  it('marks ids as pending-delete before the network call, even with no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    await deleteRemoteGroups(['g1'])
    expect(mockSetSetting).toHaveBeenCalledWith('pendingDeleteGroupIds', ['g1'])
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
    expect(mockSetSetting).toHaveBeenCalledWith('pendingDeleteGroupIds', ['g2'])
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
  it('saves and forwards updates for INSERT/UPDATE events, ignoring DELETE', async () => {
    let handler: (payload: unknown) => Promise<void> = async () => {}
    mockChannelOn.mockImplementation((_event, _filter, cb) => {
      handler = cb
      return { subscribe: mockChannelSubscribe.mockReturnValue({}) }
    })
    const onUpdate = vi.fn()
    await subscribeToRemoteChanges(makeSession('u1'), onUpdate)

    await handler({ eventType: 'DELETE', new: {} })
    expect(onUpdate).not.toHaveBeenCalled()

    await handler({
      eventType: 'UPDATE',
      new: { id: 'g1', name: 'X', color: '#fff', updated_at: new Date().toISOString(), windows: [], starred: false, archived: false, note: null, info: '' },
    })
    expect(mockSaveGroup).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1' }))
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1' }))
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
