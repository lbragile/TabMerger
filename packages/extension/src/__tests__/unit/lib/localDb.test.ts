import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Fresh IDB per test file run; re-import module fresh each test via resetModules
// so getDb()'s module-level cache doesn't leak a stale connection across tests.
async function freshLocalDb() {
  vi.resetModules()
  indexedDB = new IDBFactory()
  return import('@/lib/localDb')
}

beforeEach(() => {
  vi.clearAllMocks()
})

// REGRESSION GUARD — read-your-writes.
// Callers write the query cache first and then `await saveGroupsState` (the DnD drop does
// this for a single-paint commit). A `useGroups` refetch (staleTime 0) that started in that
// gap used to open its readonly transaction BEFORE the write's readwrite transaction and
// resolve with the pre-write state, overwriting the fresh cache. Measured in the real popup:
// a tab dropped on a sprung-open group painted, then reverted ~150ms later.
describe('localDb — read-your-writes (a read never observes state older than an issued write)', () => {
  const grp = (id: string) => ({ id, name: id, color: '#fff', updatedAt: 1, windows: [], permanent: false, starred: false })

  it('a getGroupsState started right after a NOT-awaited saveGroupsState resolves with the NEW state', async () => {
    const { getGroupsState, saveGroupsState } = await freshLocalDb()
    const initial = await getGroupsState()
    const nowOpen = initial.available[0]
    await saveGroupsState({ active: initial.active, available: [nowOpen, grp('a')] })

    // optimistic-cache pattern: write issued, refetch starts before the write settles
    const write = saveGroupsState({ active: { id: 'b', index: 1 }, available: [nowOpen, grp('b'), grp('a')] })
    const read = getGroupsState()

    const result = await read
    expect(result.available.map((g) => g.id)).toEqual([nowOpen.id, 'b', 'a'])
    expect(result.active).toEqual({ id: 'b', index: 1 })
    await write
  })

  it('overlapping writes apply in call order — the last issued write wins', async () => {
    const { getGroupsState, saveGroupsState } = await freshLocalDb()
    const initial = await getGroupsState()
    const nowOpen = initial.available[0]

    const w1 = saveGroupsState({ active: initial.active, available: [nowOpen, grp('first')] })
    const w2 = saveGroupsState({ active: initial.active, available: [nowOpen, grp('second')] })
    await Promise.all([w1, w2])

    expect((await getGroupsState()).available.map((g) => g.id)).toEqual([nowOpen.id, 'second'])
  })

  it('a failed write rejects for its caller but does not wedge later reads or writes', async () => {
    const { getGroupsState, saveGroupsState } = await freshLocalDb()
    const initial = await getGroupsState()
    const nowOpen = initial.available[0]

    // no keyPath value → IndexedDB DataError inside the write
    const bad = saveGroupsState({ active: initial.active, available: [nowOpen, { name: 'no-id' } as unknown as ReturnType<typeof grp>] })
    await expect(bad).rejects.toBeTruthy()

    await saveGroupsState({ active: initial.active, available: [nowOpen, grp('after')] })
    const result = await getGroupsState()
    expect(result.available.map((g) => g.id)).toContain('after')
  })

  // Audit #6: issue bad write, good write and read WITHOUT awaiting between them.
  it('a failed write blocks neither a good write nor a read issued right behind it (no awaits in between)', async () => {
    const { getGroupsState, saveGroupsState } = await freshLocalDb()
    const initial = await getGroupsState()
    const nowOpen = initial.available[0]

    const bad = saveGroupsState({ active: initial.active, available: [nowOpen, { name: 'no-id' } as unknown as ReturnType<typeof grp>] })
    const good = saveGroupsState({ active: initial.active, available: [nowOpen, grp('good')] })
    const read = getGroupsState()

    await expect(bad).rejects.toBeTruthy()
    await expect(good).resolves.toBeUndefined()
    expect((await read).available.map((g) => g.id)).toEqual([nowOpen.id, 'good'])
  })

  // Audit #6: the returned promise must carry no handler, or `void saveGroupsState(...)`
  // failures (quota / abort) never reach `unhandledrejection` → Sentry.
  it('a failed write nobody awaits still surfaces as an unhandled rejection', async () => {
    const { getGroupsState, saveGroupsState } = await freshLocalDb()
    const initial = await getGroupsState()
    const saved = process.listeners('unhandledRejection')
    process.removeAllListeners('unhandledRejection')
    const seen: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      seen.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      void saveGroupsState({ active: initial.active, available: [initial.available[0], { name: 'no-id' } as unknown as ReturnType<typeof grp>] })
      await vi.waitFor(() => expect(seen).toHaveLength(1), { timeout: 3000 })
    } finally {
      process.off('unhandledRejection', onUnhandled)
      saved.forEach((l) => process.on('unhandledRejection', l as (...args: unknown[]) => void))
    }
  })

  // Audit #3: a read that already waited for the tail and THEN sees a write issued must
  // re-read — this is what lets a pre-drop refetch self-correct without cancelQueries.
  it('a read already in flight when a write is issued resolves with the NEW state (write-generation re-read)', async () => {
    const { getGroupsState, saveGroupsState } = await freshLocalDb()
    const initial = await getGroupsState()
    const nowOpen = initial.available[0]
    await saveGroupsState({ active: initial.active, available: [nowOpen, grp('old')] })

    const read = getGroupsState() // started first
    const write = saveGroupsState({ active: initial.active, available: [nowOpen, grp('new')] })

    expect((await read).available.map((g) => g.id)).toEqual([nowOpen.id, 'new'])
    await write
  })

  // Audit #10: two first-run readers of an empty DB share ONE Now Open group.
  it('concurrent reads of an EMPTY db create exactly one Now Open group and both callers get its id', async () => {
    const { getGroupsState } = await freshLocalDb()
    const [a, b] = await Promise.all([getGroupsState(), getGroupsState()])
    expect(a.available).toHaveLength(1)
    expect(b.available).toHaveLength(1)
    expect(a.available[0].id).toBe(b.available[0].id)
    expect(a.available[0]).not.toBe(b.available[0]) // separate objects per caller
    const after = await getGroupsState()
    expect(after.available.filter((g) => g.permanent).map((g) => g.id)).toEqual([a.available[0].id])
  })

  it('an empty db read AFTER the first init settled and the store was wiped creates a fresh group (no stale memo)', async () => {
    const { getGroupsState, clearLocalAccountData } = await freshLocalDb()
    const first = await getGroupsState()
    await clearLocalAccountData()
    const second = await getGroupsState()
    expect(second.available).toHaveLength(1)
    expect(second.available[0].permanent).toBe(true)
    const again = await getGroupsState()
    expect(again.available.map((g) => g.id)).toEqual([second.available[0].id])
    expect(first.available[0].id).toBeTruthy()
  })
})

describe('localDb — getGroupsState', () => {
  it('creates and returns a "Now Open" permanent group when the DB is empty', async () => {
    const { getGroupsState } = await freshLocalDb()
    const state = await getGroupsState()
    expect(state.available).toHaveLength(1)
    expect(state.available[0].permanent).toBe(true)
    expect(state.active.id).toBe(state.available[0].id)
  })

  it('round-trips saved groups through saveGroupsState/getGroupsState', async () => {
    const { getGroupsState, saveGroupsState } = await freshLocalDb()
    const initial = await getGroupsState()
    const nowOpen = initial.available[0]
    const saved = { id: 'g1', name: 'Work', color: 'rgba(1,1,1,1)', updatedAt: 100, windows: [], permanent: false, starred: false }
    await saveGroupsState({ active: initial.active, available: [nowOpen, saved] })

    const result = await getGroupsState()
    expect(result.available.map((g) => g.id)).toEqual([nowOpen.id, 'g1'])
  })

  it('deletes orphaned groups (present in DB but not in the new state) on save', async () => {
    const { getGroupsState, saveGroupsState } = await freshLocalDb()
    const initial = await getGroupsState()
    const nowOpen = initial.available[0]
    const saved = { id: 'g1', name: 'Work', color: '#fff', updatedAt: 100, windows: [], permanent: false, starred: false }
    await saveGroupsState({ active: initial.active, available: [nowOpen, saved] })

    // Now save again without g1 — it should be pruned from IDB
    await saveGroupsState({ active: initial.active, available: [nowOpen] })
    const result = await getGroupsState()
    expect(result.available.find((g) => g.id === 'g1')).toBeUndefined()
  })

  it('preserves explicit saved order across reloads, keeping the permanent group first', async () => {
    const { getGroupsState, saveGroupsState } = await freshLocalDb()
    const initial = await getGroupsState()
    const nowOpen = initial.available[0]
    const a = { id: 'a', name: 'A', color: '#fff', updatedAt: 1, windows: [], permanent: false, starred: false }
    const b = { id: 'b', name: 'B', color: '#fff', updatedAt: 2, windows: [], permanent: false, starred: false }
    // Save in order b, a (drag order), despite b having a later updatedAt
    await saveGroupsState({ active: initial.active, available: [nowOpen, b, a] })

    const result = await getGroupsState()
    expect(result.available.map((g) => g.id)).toEqual([nowOpen.id, 'b', 'a'])
  })

  it('deduplicates multiple permanent groups, keeping only the oldest one', async () => {
    const { getGroupsState, saveGroup } = await freshLocalDb()
    await getGroupsState() // seeds the first Now Open
    // Simulate a stray second permanent group (e.g. from a bad sync merge)
    await saveGroup({ id: 'dup-permanent', name: 'Now Open', color: '#fff', updatedAt: 99999, windows: [], permanent: true, starred: false })

    const result = await getGroupsState()
    const permanents = result.available.filter((g) => g.permanent)
    expect(permanents).toHaveLength(1)
  })

  it('falls back to updatedAt-desc sort when no explicit order was ever saved (legacy data)', async () => {
    const { getGroupsState, saveGroup } = await freshLocalDb()
    const initial = await getGroupsState() // seeds Now Open, writes groupsState WITH an order
    const nowOpen = initial.available[0]

    // Directly write groups via saveGroup (bypasses saveGroupsState so no `order` array is written)
    await saveGroup({ id: 'old', name: 'Old', color: '#fff', updatedAt: 1, windows: [], permanent: false, starred: false })
    await saveGroup({ id: 'new', name: 'New', color: '#fff', updatedAt: 2, windows: [], permanent: false, starred: false })

    // Reset the module so getDb's cache is fresh but the groupsState.order from the initial
    // seed (which only listed nowOpen) is what's on disk — order.length is truthy but doesn't
    // cover 'old'/'new', exercising the `posMap.get(a.id) ?? Infinity` fallback within the
    // explicit-order branch. To hit the *legacy* (no-order) branch we need a groupsState record
    // with no `order` field at all — write one directly via the raw db handle.
    const { getDb } = await import('@/lib/localDb')
    const db = await getDb()
    await db.put('groupsState', { id: 'state', active: { id: nowOpen.id, index: 0 } })

    const result = await getGroupsState()
    // updatedAt desc among non-permanent groups; permanent (Now Open) always first
    expect(result.available.map((g) => g.id)).toEqual([nowOpen.id, 'new', 'old'])
  })

  it('falls back to the first sorted group as active when no active record exists', async () => {
    const { getGroupsState, saveGroup, getDb } = await freshLocalDb()
    const initial = await getGroupsState()
    const nowOpen = initial.available[0]
    await saveGroup({ id: 'g1', name: 'G1', color: '#fff', updatedAt: 5, windows: [], permanent: false, starred: false })

    const db = await getDb()
    // Remove the groupsState record entirely to simulate a fresh groups store with no state row
    await db.delete('groupsState', 'state')

    const result = await getGroupsState()
    expect(result.active).toEqual({ id: nowOpen.id, index: 0 })
  })
})

describe('localDb — settings', () => {
  it('getSetting returns the default value when unset', async () => {
    const { getSetting } = await freshLocalDb()
    const value = await getSetting('appSettings', { theme: 'system' })
    expect(value).toEqual({ theme: 'system' })
  })

  it('setSetting then getSetting round-trips the stored value', async () => {
    const { getSetting, setSetting } = await freshLocalDb()
    await setSetting('appSettings', { theme: 'dark' })
    const value = await getSetting('appSettings', { theme: 'system' })
    expect(value).toEqual({ theme: 'dark' })
  })

  it('getSetting merges a field added to the default after the record was last saved, instead of returning undefined for it', async () => {
    const { getSetting, setSetting } = await freshLocalDb()
    // Simulate a pre-existing install whose stored settings predate a newly-added field.
    await setSetting('appSettings', { theme: 'dark' })
    const value = await getSetting('appSettings', { theme: 'system', aiDailyThrottle: true })
    expect(value).toEqual({ theme: 'dark', aiDailyThrottle: true })
  })
})

describe('localDb — sync-related helpers', () => {
  it('getPendingSyncGroups returns only groups flagged pendingSync=true', async () => {
    const { getGroupsState, saveGroup, getPendingSyncGroups } = await freshLocalDb()
    await getGroupsState()
    await saveGroup({ id: 'p1', name: 'Pending', color: '#fff', updatedAt: 1, windows: [], permanent: false, starred: false, pendingSync: true })
    await saveGroup({ id: 'p2', name: 'Not pending', color: '#fff', updatedAt: 1, windows: [], permanent: false, starred: false, pendingSync: false })

    const pending = await getPendingSyncGroups()
    expect(pending.map((g) => g.id)).toEqual(['p1'])
  })

  it('markGroupSynced clears the pendingSync flag on an existing group', async () => {
    const { saveGroup, markGroupSynced, getPendingSyncGroups } = await freshLocalDb()
    await saveGroup({ id: 'p1', name: 'Pending', color: '#fff', updatedAt: 1, windows: [], permanent: false, starred: false, pendingSync: true })
    await markGroupSynced('p1')
    const pending = await getPendingSyncGroups()
    expect(pending).toHaveLength(0)
  })

  it('markGroupSynced is a no-op for an id that does not exist', async () => {
    const { markGroupSynced } = await freshLocalDb()
    await expect(markGroupSynced('does-not-exist')).resolves.toBeUndefined()
  })
})

describe('localDb — sessions', () => {
  it('saveSession/getSessions round-trips and sorts newest first', async () => {
    const { saveSession, getSessions } = await freshLocalDb()
    await saveSession({ id: 's1', name: 'Old', createdAt: 100, groups: [] })
    await saveSession({ id: 's2', name: 'New', createdAt: 200, groups: [] })
    const sessions = await getSessions()
    expect(sessions.map((s) => s.id)).toEqual(['s2', 's1'])
  })

  it('deleteSession removes it from IDB', async () => {
    const { saveSession, deleteSession, getSessions } = await freshLocalDb()
    await saveSession({ id: 's1', name: 'Old', createdAt: 100, groups: [] })
    await deleteSession('s1')
    expect(await getSessions()).toHaveLength(0)
  })
})

describe('localDb — deleteGroup', () => {
  it('removes a group by id', async () => {
    const { getGroupsState, saveGroup, deleteGroup } = await freshLocalDb()
    await getGroupsState()
    await saveGroup({ id: 'g1', name: 'Work', color: '#fff', updatedAt: 1, windows: [], permanent: false, starred: false })
    await deleteGroup('g1')
    const state = await getGroupsState()
    expect(state.available.find((g) => g.id === 'g1')).toBeUndefined()
  })
})

describe('localDb — clearLocalAccountData', () => {
  it('wipes groups, groupsState, and sessions so a different account starts clean', async () => {
    const { getGroupsState, saveGroup, saveSession, clearLocalAccountData } = await freshLocalDb()
    await getGroupsState()
    await saveGroup({ id: 'g1', name: 'Work', color: '#fff', updatedAt: 1, windows: [], permanent: false, starred: false })
    await saveSession({ id: 's1', name: 'Old', createdAt: 100, groups: [] })

    await clearLocalAccountData()

    const { getSessions } = await import('@/lib/localDb')
    expect(await getSessions()).toHaveLength(0)
    // getGroupsState regenerates a fresh "Now Open" since the store is empty
    const state = await getGroupsState()
    expect(state.available).toHaveLength(1)
    expect(state.available[0].permanent).toBe(true)
    expect(state.available.find((g) => g.id === 'g1')).toBeUndefined()
  })
})
