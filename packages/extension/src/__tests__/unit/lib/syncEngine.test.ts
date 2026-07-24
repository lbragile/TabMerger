import { describe, it, expect, vi, beforeEach } from 'vitest'
import { pushPendingChanges, deleteRemoteGroups, pullRemoteChanges, subscribeToRemoteChanges } from '@/lib/syncEngine'
import type { Group } from '@/lib/types'
import type { Session } from '@supabase/supabase-js'

const {
  mockGetPendingSyncGroups,
  mockMarkGroupSynced,
  mockSaveGroup,
  mockGetSession,
} = vi.hoisted(() => ({
  mockGetPendingSyncGroups: vi.fn(),
  mockMarkGroupSynced: vi.fn(),
  mockSaveGroup: vi.fn(),
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/localDb', () => ({
  getPendingSyncGroups: mockGetPendingSyncGroups,
  markGroupSynced: mockMarkGroupSynced,
  saveGroup: mockSaveGroup,
}))

// ─── Supabase mock — client/builder separation (client must NOT be thenable) ──

function makeBuilder(responses: Array<{ data: unknown; error: unknown }>) {
  const builder: Record<string, unknown> = {}
  builder.from = vi.fn().mockReturnValue(builder)
  builder.select = vi.fn().mockReturnValue(builder)
  builder.upsert = vi.fn().mockReturnValue(builder)
  builder.delete = vi.fn().mockReturnValue(builder)
  builder.eq = vi.fn().mockReturnValue(builder)
  builder.in = vi.fn().mockReturnValue(builder)
  builder.order = vi.fn().mockReturnValue(builder)
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

beforeEach(() => {
  vi.clearAllMocks()
  currentBuilder = makeBuilder([])
  mockChannel.mockReturnValue({ on: mockChannelOn.mockReturnThis(), subscribe: mockChannelSubscribe.mockReturnThis() })
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

  it('returns an unsubscribe function that calls removeChannel', async () => {
    mockChannelOn.mockReturnValue({ subscribe: mockChannelSubscribe.mockReturnValue({}) })
    const unsubscribe = await subscribeToRemoteChanges(makeSession(), vi.fn())
    unsubscribe()
    expect(mockRemoveChannel).toHaveBeenCalled()
  })
})
