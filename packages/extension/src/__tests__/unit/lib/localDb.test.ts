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
