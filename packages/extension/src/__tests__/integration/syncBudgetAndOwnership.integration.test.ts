import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { performSyncCycle } from '@/lib/syncEngine'
import {
  getGroupsState, saveGroupsState, updateGroupsState, markPositionSynced, setSetting, getSetting,
  addPendingGroupDeletes, getPendingGroupDeletes, clearAllLocalData,
} from '@/lib/localDb'
import { ensureAccountScope, resetAccountScopeForTests } from '@/lib/accountScope'
import { SYNC_CYCLE_BUDGET_MS } from '@/lib/syncRequest'
import { LAST_USER_ID_KEY, DELETE_BACKOFF_KEY } from '@/lib/syncSettingKeys'
import { createGroup, createNowOpenGroup } from '@/lib/utils'
import type { Group } from '@/lib/types'
import { clearDb } from './dbTestUtils'
import { fakeRemote, type RemoteRow } from './fakeSupabase'

// Follow-up to the cycle deadline: the push must not use up the pull's time, running out of time is
// not a failed delete, and "Clear all data" must not leave the store without an owner.

vi.mock('@/lib/supabase', async () => {
  const m = await import('./fakeSupabase')
  return { supabase: m.fakeSupabase, isSupabaseConfigured: true }
})
vi.mock('@/lib/encryptionKey', () => ({
  getEncryptionKeyState: vi.fn(async () => 'present'),
  getDataKey: vi.fn(async () => (await import('./testEncryption')).testDataKey()),
  reportUndecryptableRows: vi.fn(async () => undefined),
}))

const session = { user: { id: 'user-1' } } as unknown as Session
const BASE = '2030-01-01T00:00:00.000Z'

const grp = (id: string, name: string): Group => ({ ...createGroup(id, name), updatedAt: 1000, pendingSync: false })
const rowOf = (g: Group, stamp = BASE, position = 1): RemoteRow => ({
  id: g.id, user_id: 'user-1', name: g.name, color: g.color, updated_at: stamp,
  windows: g.windows, starred: false, archived: false, note: null, info: g.info ?? '', position,
})

/** Clean local groups that are also on the server. */
async function seed(...groups: Group[]) {
  const nowOpen = createNowOpenGroup()
  await saveGroupsState({
    active: { id: nowOpen.id, index: 0 },
    available: [nowOpen, ...groups.map((g) => ({ ...g, remoteUpdatedAt: BASE, pendingSync: false }))],
  })
  for (const [i, g] of groups.entries()) {
    await markPositionSynced(g.id, i + 1)
    fakeRemote.rows.set(g.id, rowOf(g, BASE, i + 1))
  }
  await setSetting('remoteBaseSeeded', true)
  await setSetting('cloudSyncActive', true)
}

const addNew = (...created: Array<[string, string]>) =>
  updateGroupsState((s) => ({ ...s, available: [...s.available, ...created.map(([id, name]) => ({ ...createGroup(id, name), pendingSync: true }))] }))
const editLocally = (id: string, name: string) =>
  updateGroupsState((s) => ({ ...s, available: s.available.map((g) => (g.id === id ? { ...g, name, pendingSync: true, updatedAt: 2000 } : g)) }))
const local = async () => (await getGroupsState()).available.slice(1)
const ids = async () => (await local()).map((g) => g.id)

/** From now on the clock reads "one whole cycle budget later": the request in flight took that long. */
function jumpPastBudget(): void {
  const later = Date.now() + SYNC_CYCLE_BUDGET_MS + 1
  vi.spyOn(Date, 'now').mockReturnValue(later)
}

/** Runs one cycle whose FIRST content push takes longer than the whole push budget. */
async function cycleWithSlowFirstPush() {
  const gate = fakeRemote.hold('upsert')
  const cycle = performSyncCycle(session)
  await gate.entered
  jumpPastBudget()
  gate.release()
  return cycle
}

beforeEach(async () => {
  fakeRemote.reset()
  await clearDb()
  resetAccountScopeForTests()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('N1 the pull has its own time budget', () => {
  it('a push phase that used up its budget still ends with a pull and a merge', async () => {
    await seed(grp('a', 'A'))
    await addNew(['n1', 'New 1'], ['n2', 'New 2'])
    fakeRemote.rows.set('remote', rowOf(grp('remote', 'From another device'), BASE, 4))

    const result = await cycleWithSlowFirstPush()

    expect(result.status).toBe('synced')
    expect(await ids()).toContain('remote') // pulled and merged
    expect(fakeRemote.selects).toHaveLength(1)
    // the push budget itself still holds: the second new group waits for the next cycle
    expect(['n1', 'n2'].filter((id) => fakeRemote.rows.has(id))).toHaveLength(1)
    expect((await local()).filter((g) => g.pendingSync)).toHaveLength(1)
  })

  it('a pull that runs out of ITS time is abandoned after the page in flight, with the local state untouched', async () => {
    await seed(grp('a', 'A'))
    await addNew(['n1', 'New 1'])
    for (let i = 0; i < 5; i++) fakeRemote.rows.set(`r${i}`, rowOf(grp(`r${i}`, `Remote ${i}`), BASE, i + 2))
    fakeRemote.maxRows = 2 // several pages
    fakeRemote.afterPage(1, jumpPastBudget) // the first page takes longer than the whole pull budget

    const result = await cycleWithSlowFirstPush()

    expect(result.status).toBe('pull-failed')
    expect(fakeRemote.selects).toHaveLength(1) // the pull started (own budget) and stopped after one page
    expect(await ids()).toEqual(['a', 'n1']) // nothing merged from the partial pull
    expect(fakeRemote.deleteCalls).toEqual([])
    expect(await getPendingGroupDeletes()).toEqual([])
  })
})

describe('a partial push followed by a failed pull', () => {
  it('leaves the pushed group synced with its new base, the rest pending, and merges nothing', async () => {
    await seed(grp('a', 'A'), grp('b', 'B'), grp('c', 'Clean, missing remotely'))
    await editLocally('a', 'A edited')
    await editLocally('b', 'B edited')
    fakeRemote.rows.delete('c') // a merge would drop it locally
    fakeRemote.rows.set('remote', rowOf(grp('remote', 'From another device'), BASE, 4)) // a merge would adopt it
    fakeRemote.failAfterPages = 0 // the pull request fails

    const result = await cycleWithSlowFirstPush()

    expect(result.status).toBe('pull-failed')
    expect(fakeRemote.upserts).toHaveLength(1) // one content push went out before the push budget ended
    const pushedId = fakeRemote.upserts[0].id
    const otherId = pushedId === 'a' ? 'b' : 'a'
    const byId = new Map((await local()).map((g) => [g.id, g]))
    const newBase = fakeRemote.rows.get(pushedId)?.updated_at
    expect(newBase).not.toBe(BASE)
    expect(byId.get(pushedId)).toMatchObject({ pendingSync: false, remoteUpdatedAt: newBase })
    expect(byId.get(otherId)).toMatchObject({ pendingSync: true, remoteUpdatedAt: BASE })
    expect(fakeRemote.rows.get(otherId)?.updated_at).toBe(BASE) // the server row of the unsent edit is untouched
    // nothing merged: no remote row adopted, no local group dropped, no delete queued
    expect(await ids()).toEqual(['a', 'b', 'c'])
    expect(await getPendingGroupDeletes()).toEqual([])
  })
})

describe('N2 the delete backoff only grows when a delete was actually refused', () => {
  it('stopping at the cycle deadline leaves the stored backoff as it was; the unsent ids stay pending', async () => {
    await seed(grp('a', 'A'))
    await addNew(['n1', 'New 1'])
    fakeRemote.rows.set('gone', rowOf(grp('gone', 'Deleted on this device'), BASE, 2))
    await addPendingGroupDeletes(['gone'])
    const stored = { failures: 2, nextAt: 1 }
    await setSetting(DELETE_BACKOFF_KEY, stored)

    const result = await cycleWithSlowFirstPush() // the delete flush shares the push budget: no time left

    expect(result.status).toBe('synced')
    expect(fakeRemote.deleteCalls).toEqual([]) // nothing was sent, so nothing was refused
    expect(await getSetting(DELETE_BACKOFF_KEY, null)).toEqual(stored)
    expect(await getPendingGroupDeletes()).toEqual(['gone'])
    expect(await ids()).not.toContain('gone') // still pending: the pull does not resurrect it
  })

  it('a delete the server or the network failed grows the backoff', async () => {
    await seed(grp('a', 'A'))
    fakeRemote.rows.set('gone', rowOf(grp('gone', 'Deleted on this device'), BASE, 2))
    await addPendingGroupDeletes(['gone'])
    fakeRemote.failDelete = true
    const startedAt = Date.now()

    await performSyncCycle(session)

    expect(fakeRemote.deleteCalls).toEqual([['gone']])
    const backoff = await getSetting<{ failures: number; nextAt: number } | null>(DELETE_BACKOFF_KEY, null)
    expect(backoff?.failures).toBe(1)
    expect(backoff?.nextAt).toBeGreaterThanOrEqual(startedAt + 30_000)
    expect(await getPendingGroupDeletes()).toEqual(['gone'])
  })

  it('a delete that went through resets the backoff', async () => {
    await seed(grp('a', 'A'))
    fakeRemote.rows.set('gone', rowOf(grp('gone', 'Deleted on this device'), BASE, 2))
    await addPendingGroupDeletes(['gone'])
    await setSetting(DELETE_BACKOFF_KEY, { failures: 2, nextAt: 1 })

    await performSyncCycle(session)

    expect(fakeRemote.rows.has('gone')).toBe(false)
    expect(await getSetting(DELETE_BACKOFF_KEY, null)).toEqual({ failures: 0, nextAt: 0 })
    expect(await getPendingGroupDeletes()).toEqual([])
  })
})

describe('N7 "Clear all data" does not leave the store without an owner', () => {
  const addGroup = (id: string) => updateGroupsState((s) => ({ ...s, available: [...s.available, createGroup(id, id)] }))

  it('still signed in: the owner record survives, the same user keeps what they create afterwards, another account gets a wipe', async () => {
    await ensureAccountScope('user-A')
    await addGroup('before')

    await clearAllLocalData() // the popup stays open: the scope check stays memoised for user-A

    expect(await getSetting(LAST_USER_ID_KEY, null)).toBe('user-A')
    expect(await ids()).toEqual([])
    await addGroup('after')
    await expect(ensureAccountScope('user-A')).resolves.toBe(false)
    resetAccountScopeForTests() // popup reopened, same user
    await expect(ensureAccountScope('user-A')).resolves.toBe(false)
    expect(await ids()).toEqual(['after']) // never wiped for the user who owns the store

    await expect(ensureAccountScope('user-B')).resolves.toBe(true) // a different account signs in
    expect(await ids()).toEqual([])
    expect(await getSetting(LAST_USER_ID_KEY, null)).toBe('user-B')
  })

  it('a different account signing in before the popup reopens never inherits the groups of the account that cleared', async () => {
    await ensureAccountScope('user-A')
    await clearAllLocalData()
    await addGroup('belongs-to-A') // e.g. pulled back by the next sync, or created by A

    await expect(ensureAccountScope('user-B')).resolves.toBe(true) // same popup: no reset of the memo

    expect(await ids()).toEqual([])
  })

  it('the service worker still refuses a cycle for another account after a clear-all', async () => {
    await ensureAccountScope('account-A')
    await clearAllLocalData()
    await setSetting('cloudSyncActive', true)
    await addNew(['a1', 'Belongs to A'])

    const result = await performSyncCycle(session) // user-1, bridged in by the web app

    expect(result.status).toBe('account-mismatch')
    expect(fakeRemote.writes).toEqual([])
  })

  it('a store nobody ever signed in to stays unowned: the first sign-in adopts the local groups without a wipe', async () => {
    await addGroup('anonymous-before')
    await clearAllLocalData()
    expect(await getSetting(LAST_USER_ID_KEY, null)).toBeNull()
    await addGroup('anonymous-after')

    await expect(ensureAccountScope('user-A')).resolves.toBe(false)

    expect(await ids()).toEqual(['anonymous-after'])
  })

  it('signed out when clearing: the last account signing back in keeps the groups created since', async () => {
    await ensureAccountScope('user-A')
    resetAccountScopeForTests() // signed out, popup reopened
    await clearAllLocalData()
    await addGroup('made-while-signed-out')

    await expect(ensureAccountScope('user-A')).resolves.toBe(false)

    expect(await ids()).toEqual(['made-while-signed-out'])
  })
})
