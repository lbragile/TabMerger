import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

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
    await expect(good).resolves.toEqual(expect.any(Number)) // the new rev
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
    await markGroupSynced('p1', 1, 1)
    const pending = await getPendingSyncGroups()
    expect(pending).toHaveLength(0)
  })

  it('markGroupSynced keeps pendingSync when the group changed after the pushed version (newer updatedAt)', async () => {
    const { saveGroup, markGroupSynced, getPendingSyncGroups } = await freshLocalDb()
    await saveGroup({ id: 'p1', name: 'Edited mid-push', color: '#fff', updatedAt: 9, windows: [], permanent: false, starred: false, pendingSync: true })
    await markGroupSynced('p1', 1, 1) // the push that finished carried version 1
    expect((await getPendingSyncGroups()).map((g) => g.id)).toEqual(['p1'])
  })

  it('markGroupSynced is a no-op for an id that does not exist', async () => {
    const { markGroupSynced } = await freshLocalDb()
    await expect(markGroupSynced('does-not-exist', 1, 1)).resolves.toBeUndefined()
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

const grpForNotifyTests = (id: string) => ({ id, name: id, color: '#fff', updatedAt: 1, windows: [], permanent: false, starred: false })

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

// Context-menu rebuild notification — see notifyGroupsChanged's doc comment in localDb.ts.
// Covers the two delivery paths (direct in-SW callback vs. chrome.runtime.sendMessage) and
// confirms sync-flag-only writes (markGroupSynced/markAllGroupsPendingSync) never trigger it.
describe('localDb — groups-change notification (context menu rebuild trigger)', () => {
  function stubChromeRuntime() {
    const sendMessage = vi.fn((_msg: unknown, cb?: (r?: unknown) => void) => cb?.())
    ;(globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { sendMessage, lastError: undefined },
    }
    return sendMessage
  }

  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome
  })

  it('a group-changing write (saveGroupsState) notifies via sendMessage when no direct listener is registered', async () => {
    const sendMessage = stubChromeRuntime()
    const { getGroupsState, saveGroupsState } = await freshLocalDb()
    const initial = await getGroupsState()
    sendMessage.mockClear()

    await saveGroupsState({ active: initial.active, available: [initial.available[0], grpForNotifyTests('a')] })

    expect(sendMessage).toHaveBeenCalledWith({ type: 'TM_GROUPS_CHANGED' }, expect.any(Function))
  })

  it('saveGroup and deleteGroup also notify', async () => {
    const sendMessage = stubChromeRuntime()
    const { saveGroup, deleteGroup } = await freshLocalDb()
    sendMessage.mockClear()
    await saveGroup({ id: 'g1', name: 'Work', color: '#fff', updatedAt: 1, windows: [], permanent: false, starred: false })
    expect(sendMessage).toHaveBeenCalledWith({ type: 'TM_GROUPS_CHANGED' }, expect.any(Function))

    sendMessage.mockClear()
    await deleteGroup('g1')
    expect(sendMessage).toHaveBeenCalledWith({ type: 'TM_GROUPS_CHANGED' }, expect.any(Function))
  })

  it('clearLocalAccountData notifies', async () => {
    const sendMessage = stubChromeRuntime()
    const { clearLocalAccountData } = await freshLocalDb()
    sendMessage.mockClear()
    await clearLocalAccountData()
    expect(sendMessage).toHaveBeenCalledWith({ type: 'TM_GROUPS_CHANGED' }, expect.any(Function))
  })

  it('calls a directly-registered listener AND still sendMessage (the in-SW path also has to reach open popups)', async () => {
    const sendMessage = stubChromeRuntime()
    const { getGroupsState, saveGroupsState, registerGroupsChangeListener } = await freshLocalDb()
    const initial = await getGroupsState()
    const directListener = vi.fn()
    registerGroupsChangeListener(directListener)
    sendMessage.mockClear()

    await saveGroupsState({ active: initial.active, available: [initial.available[0], grpForNotifyTests('b')] })

    expect(directListener).toHaveBeenCalledTimes(1)
    // sendMessage never delivers to the sender's own listeners, so this reaches OTHER
    // contexts only (the popup's useExternalGroupsChanges refetch)
    expect(sendMessage).toHaveBeenCalledWith({ type: 'TM_GROUPS_CHANGED' }, expect.any(Function))
  })

  it('does NOT notify for sync-flag-only writes (markGroupSynced, markAllGroupsPendingSync)', async () => {
    const sendMessage = stubChromeRuntime()
    const { getGroupsState, saveGroup, markGroupSynced, markAllGroupsPendingSync } = await freshLocalDb()
    await getGroupsState()
    await saveGroup({ id: 'g1', name: 'Work', color: '#fff', updatedAt: 1, windows: [], permanent: false, starred: false })
    sendMessage.mockClear()

    await markGroupSynced('g1', 1, 1)
    await markAllGroupsPendingSync()

    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('swallows the "Receiving end does not exist" rejection surfaced via chrome.runtime.lastError', async () => {
    const sendMessage = vi.fn((_msg: unknown, cb?: (r?: unknown) => void) => {
      ;(globalThis as unknown as { chrome: { runtime: { lastError?: unknown } } }).chrome.runtime.lastError =
        { message: 'Could not establish connection. Receiving end does not exist.' }
      cb?.()
      ;(globalThis as unknown as { chrome: { runtime: { lastError?: unknown } } }).chrome.runtime.lastError = undefined
    })
    ;(globalThis as unknown as { chrome: unknown }).chrome = { runtime: { sendMessage, lastError: undefined } }

    const { getGroupsState, saveGroupsState } = await freshLocalDb()
    const initial = await getGroupsState()

    await expect(
      saveGroupsState({ active: initial.active, available: [initial.available[0], grpForNotifyTests('c')] })
    ).resolves.toEqual(expect.any(Number))
  })
})

describe('localDb — updateGroupsState (atomic read-modify-write)', () => {
  const grp = (id: string) => ({ id, name: id, color: '#fff', updatedAt: 1, windows: [], permanent: false, starred: false })

  it('hands fn a FRESH read that includes writes issued before it, and persists the result', async () => {
    const { getGroupsState, saveGroupsState, updateGroupsState } = await freshLocalDb()
    const initial = await getGroupsState()
    const nowOpen = initial.available[0]
    // not awaited: the RMW must still observe it (issued order = applied order)
    void saveGroupsState({ active: initial.active, available: [nowOpen, grp('a')] })

    const next = await updateGroupsState((cur) => {
      expect(cur.available.map((g) => g.id)).toEqual([nowOpen.id, 'a'])
      return { ...cur, available: [...cur.available, grp('b')] }
    })

    expect(next.available.map((g) => g.id)).toEqual([nowOpen.id, 'a', 'b'])
    expect((await getGroupsState()).available.map((g) => g.id)).toEqual([nowOpen.id, 'a', 'b'])
  })

  it('concurrent RMWs all land (each sees the previous one)', async () => {
    const { getGroupsState, updateGroupsState } = await freshLocalDb()
    await getGroupsState()
    await Promise.all(['x', 'y', 'z'].map((id) => updateGroupsState((cur) => ({ ...cur, available: [...cur.available, grp(id)] }))))
    expect((await getGroupsState()).available.map((g) => g.id).slice(1).sort()).toEqual(['x', 'y', 'z'])
  })

  it('returning null skips the write and resolves with the unchanged state', async () => {
    const { getGroupsState, updateGroupsState } = await freshLocalDb()
    const before = await getGroupsState()
    const result = await updateGroupsState(() => null)
    expect(result.available.map((g) => g.id)).toEqual(before.available.map((g) => g.id))
  })

  it('presents an EMPTY store as the initial Now Open state and persists the result', async () => {
    const { getGroupsState, updateGroupsState } = await freshLocalDb()
    const next = await updateGroupsState((cur) => {
      expect(cur.available).toHaveLength(1)
      expect(cur.available[0].permanent).toBe(true)
      return { ...cur, available: [...cur.available, grp('first')] }
    })
    const stored = await getGroupsState()
    expect(stored.available.map((g) => g.id)).toEqual(next.available.map((g) => g.id))
    expect(stored.available.filter((g) => g.permanent)).toHaveLength(1)
  })

  it('a throwing fn rejects for its caller but does not wedge later reads or writes', async () => {
    const { getGroupsState, updateGroupsState } = await freshLocalDb()
    const before = await getGroupsState()
    await expect(updateGroupsState(() => { throw new Error('boom') })).rejects.toThrow('boom')
    const next = await updateGroupsState((cur) => ({ ...cur, available: [...cur.available, grp('after')] }))
    expect(next.available.map((g) => g.id)).toContain('after')
    expect((await getGroupsState()).available).toHaveLength(before.available.length + 1)
  })
})

describe('localDb — cross-context write lock', () => {
  const grp = (id: string) => ({ id, name: id, color: '#fff', updatedAt: 1, windows: [], permanent: false, starred: false })

  // A real mutual-exclusion lock manager (single name) that records every request.
  function stubWebLocks() {
    let tail: Promise<unknown> = Promise.resolve()
    const request = vi.fn((_name: string, cb: () => Promise<unknown>) => {
      const run = tail.then(() => cb())
      tail = run.catch(() => undefined)
      return run
    })
    Object.defineProperty(globalThis.navigator, 'locks', { value: { request }, configurable: true })
    return request
  }

  afterEach(() => {
    delete (globalThis.navigator as unknown as { locks?: unknown }).locks
  })

  it('takes the shared Web Lock around every groups-store mutation', async () => {
    const request = stubWebLocks()
    const { getGroupsState, saveGroupsState, updateGroupsState, markAllGroupsPendingSync, clearLocalAccountData } = await freshLocalDb()
    const init = await getGroupsState() // first-run init is a (locked) write too
    request.mockClear()

    await saveGroupsState({ active: init.active, available: [init.available[0], grp('a')] })
    await updateGroupsState((cur) => cur)
    await markAllGroupsPendingSync()
    await clearLocalAccountData()

    expect(request).toHaveBeenCalledTimes(4)
    for (const [name] of request.mock.calls) expect(name).toBe('tabmerger-groups-write')
  })

  it('without navigator.locks (jsdom/old browsers) two module copies still exclude each other', async () => {
    expect((globalThis.navigator as unknown as { locks?: unknown }).locks).toBeUndefined()
    const a = await freshLocalDb()
    vi.resetModules()
    const c = await import('@/lib/localDb')
    expect(c).not.toBe(a)
    await a.getGroupsState()
    await Promise.all([
      a.updateGroupsState((cur) => ({ ...cur, available: [...cur.available, grp('from-a')] })),
      c.updateGroupsState((cur) => ({ ...cur, available: [...cur.available, grp('from-c')] })),
    ])
    const ids = (await a.getGroupsState()).available.map((g) => g.id)
    expect(ids).toContain('from-a')
    expect(ids).toContain('from-c')
  })
})

describe('localDb — clearLocalAccountData ordering', () => {
  it('a write issued before the wipe cannot restore groups after it', async () => {
    const { saveGroupsState, clearLocalAccountData, getGroupsState } = await freshLocalDb()
    const init = await getGroupsState()
    const prev = { id: 'prev', name: 'p', color: '#fff', updatedAt: 1, windows: [], permanent: false, starred: false }
    const write = saveGroupsState({ active: init.active, available: [init.available[0], prev] })
    const wipe = clearLocalAccountData()
    await Promise.all([write, wipe])
    expect((await getGroupsState()).available.map((g) => g.id)).not.toContain('prev')
  })
})

describe('localDb — durable pending remote deletes', () => {
  const grp = (id: string) => ({ id, name: id, color: '#fff', updatedAt: 1, windows: [], permanent: false, starred: false })

  it('a write that prunes a group records its id as pending-delete in the same step, and re-creating it clears the marker', async () => {
    const { getGroupsState, saveGroupsState, getPendingGroupDeletes, setSetting } = await freshLocalDb()
    const init = await getGroupsState()
    const nowOpen = init.available[0]
    await setSetting('cloudSyncActive', true) // a signed-in cloud-sync user (useSync sets this)
    await saveGroupsState({ active: init.active, available: [nowOpen, grp('a'), grp('b')] })
    expect(await getPendingGroupDeletes()).toEqual([])

    await saveGroupsState({ active: init.active, available: [nowOpen, grp('b')] })
    expect(await getPendingGroupDeletes()).toEqual(['a'])

    await saveGroupsState({ active: init.active, available: [nowOpen, grp('a'), grp('b')] }) // undone delete
    expect(await getPendingGroupDeletes()).toEqual([])
  })

  it('add/remove helpers edit the persisted set and clearLocalAccountData wipes it', async () => {
    const { addPendingGroupDeletes, removePendingGroupDeletes, getPendingGroupDeletes, clearLocalAccountData } = await freshLocalDb()
    await addPendingGroupDeletes(['x', 'y'])
    await addPendingGroupDeletes(['y', 'z'])
    expect((await getPendingGroupDeletes()).sort()).toEqual(['x', 'y', 'z'])
    await removePendingGroupDeletes(['y'])
    expect((await getPendingGroupDeletes()).sort()).toEqual(['x', 'z'])
    await clearLocalAccountData()
    expect(await getPendingGroupDeletes()).toEqual([])
  })

  it('updateGroupsState can read the pending set inside its locked step', async () => {
    const { addPendingGroupDeletes, updateGroupsState } = await freshLocalDb()
    await addPendingGroupDeletes(['gone'])
    let seen: string[] = []
    await updateGroupsState((_cur, aux) => { seen = [...aux.pendingDeletes]; return null }, { readPendingDeletes: true })
    expect(seen).toEqual(['gone'])
  })
})

describe('localDb — optimistic concurrency (rev)', () => {
  const grp = (id: string) => ({ id, name: id, color: '#fff', updatedAt: 1, windows: [], permanent: false, starred: false })

  it('every write bumps the stored rev and reads carry it', async () => {
    const { getGroupsState, saveGroupsState, updateGroupsState } = await freshLocalDb()
    const init = await getGroupsState()
    const r1 = (await getGroupsState()).rev!
    const r2 = await saveGroupsState({ active: init.active, available: [init.available[0], grp('a')] })
    expect(r2).toBe(r1 + 1)
    const after = await updateGroupsState((cur) => ({ ...cur, available: [...cur.available, grp('b')] }))
    expect(after.rev).toBe(r2 + 1)
    expect((await getGroupsState()).rev).toBe(r2 + 1)
  })

  it('a write whose expectedRev is stale is refused: nothing is written and it rejects with StaleGroupsError', async () => {
    const { getGroupsState, saveGroupsState } = await freshLocalDb()
    const init = await getGroupsState()
    const base = init.rev!
    await saveGroupsState({ active: init.active, available: [init.available[0], grp('foreign')] }) // someone else wrote
    await expect(
      saveGroupsState({ active: init.active, available: [init.available[0], grp('mine')] }, { expectedRev: base })
    ).rejects.toMatchObject({ name: 'StaleGroupsError' })
    expect((await getGroupsState()).available.map((g) => g.id)).toEqual([init.available[0].id, 'foreign'])
  })

  it('a write with the current rev succeeds', async () => {
    const { getGroupsState, saveGroupsState } = await freshLocalDb()
    const init = await getGroupsState()
    await expect(saveGroupsState({ active: init.active, available: [init.available[0], grp('a')] }, { expectedRev: init.rev })).resolves.toBe(init.rev! + 1)
  })
})

describe('localDb — positionDirty derived from the stored order', () => {
  const grp = (id: string) => ({ id, name: id, color: '#fff', updatedAt: 1, windows: [], permanent: false, starred: false })

  it('a blind cache-derived write cannot erase a stored flag; markPositionSynced clears it only at a matching index', async () => {
    const { getGroupsState, saveGroupsState, markPositionSynced } = await freshLocalDb()
    const init = await getGroupsState()
    const nowOpen = init.available[0]
    await saveGroupsState({ active: init.active, available: [nowOpen, grp('a'), grp('b')] }) // new groups: dirty
    const cacheCopy = (await getGroupsState()).available // objects as a cache would hold them
    await markPositionSynced('a', 1)
    expect((await getGroupsState()).available.find((g) => g.id === 'a')?.positionDirty).toBeUndefined()
    // a write from a stale cache copy (still carrying the old flag) at the SAME index changes nothing
    await saveGroupsState({ active: init.active, available: cacheCopy })
    await markPositionSynced('b', 2)
    await markPositionSynced('a', 1)
    const s = await getGroupsState()
    expect(s.available.every((g) => !g.positionDirty)).toBe(true)
    // moving flags exactly the groups whose index changed
    await saveGroupsState({ active: init.active, available: [nowOpen, s.available[2], s.available[1]] })
    expect((await getGroupsState()).available.map((g) => !!g.positionDirty)).toEqual([false, true, true])
  })

  it('never flags Now Open', async () => {
    const { getGroupsState, saveGroupsState } = await freshLocalDb()
    const init = await getGroupsState()
    await saveGroupsState({ active: init.active, available: [init.available[0], grp('a')] })
    expect((await getGroupsState()).available[0].positionDirty).toBeUndefined()
  })
})

describe('localDb — round 3 (first-run rev, Now Open, clear all)', () => {
  const grp = (id: string) => ({ id, name: id, color: '#fff', updatedAt: 1, windows: [], permanent: false, starred: false })

  it('the first-run state carries a rev, so a cache-derived write on it can be guarded', async () => {
    const { getGroupsState, saveGroupsState } = await freshLocalDb()
    const first = await getGroupsState()
    expect(first.rev).toEqual(expect.any(Number))
    await expect(saveGroupsState({ active: first.active, available: [first.available[0], grp('a')] }, { expectedRev: first.rev })).resolves.toEqual(expect.any(Number))
  })

  it('updateGroupsState on an empty store presents a state with a rev', async () => {
    const { updateGroupsState } = await freshLocalDb()
    let seen: number | undefined
    await updateGroupsState((cur) => { seen = cur.rev; return null })
    expect(seen).toEqual(expect.any(Number))
  })

  it('markAllGroupsPendingSync never marks Now Open (permanent, never synced)', async () => {
    const { getGroupsState, saveGroupsState, markAllGroupsPendingSync } = await freshLocalDb()
    const init = await getGroupsState()
    await saveGroupsState({ active: init.active, available: [init.available[0], grp('a')] })
    await markAllGroupsPendingSync()
    const s = await getGroupsState()
    expect(s.available[0].pendingSync).toBeFalsy()
    expect(s.available[1].pendingSync).toBe(true)
  })

  it('clearAllLocalData wipes every store as a queued step: an earlier groups write cannot survive it', async () => {
    const { getGroupsState, saveGroupsState, setSetting, getSetting, clearAllLocalData } = await freshLocalDb()
    const init = await getGroupsState()
    await setSetting('theme', 'dark')
    const write = saveGroupsState({ active: init.active, available: [init.available[0], grp('late')] })
    const wipe = clearAllLocalData()
    await Promise.all([write, wipe])
    expect((await getGroupsState()).available.map((g) => g.id)).not.toContain('late')
    expect(await getSetting('theme', 'light')).toBe('light')
  })

  it('clearAllLocalData keeps the record of whose store this is (the signed-in account does not change)', async () => {
    const { setSetting, getSetting, clearAllLocalData } = await freshLocalDb()
    await setSetting('lastSignedInUserId', 'user-A')
    await setSetting('cloudSyncActive', true)
    await setSetting('remoteBaseSeeded', true)
    await clearAllLocalData()
    expect(await getSetting('lastSignedInUserId', null)).toBe('user-A')
    expect(await getSetting('cloudSyncActive', false)).toBe(true)
    expect(await getSetting('remoteBaseSeeded', false)).toBe(false) // sync progress is data about the wiped groups: gone
  })
})

describe('localDb — server base stamp (remoteUpdatedAt)', () => {
  const grp = (id: string, over = {}) => ({ id, name: id, color: '#fff', updatedAt: 1, windows: [], permanent: false, starred: false, ...over })

  it('markGroupSynced stores the returned stamp as the new base, even when an in-flight edit keeps the group pending', async () => {
    const { getGroupsState, saveGroupsState, markGroupSynced } = await freshLocalDb()
    const init = await getGroupsState()
    await saveGroupsState({ active: init.active, available: [init.available[0], grp('a', { pendingSync: true, updatedAt: 9, remoteUpdatedAt: 'OLD' })] })
    await markGroupSynced('a', 1, 1, 'NEW') // an older version was pushed; the group was edited meanwhile
    const a = (await getGroupsState()).available[1]
    expect(a.remoteUpdatedAt).toBe('NEW')
    expect(a.pendingSync).toBe(true)
  })

  it('a blind (cache-derived) saveGroupsState cannot regress a stored base, but an RMW can set a fresh one', async () => {
    const { getGroupsState, saveGroupsState, updateGroupsState } = await freshLocalDb()
    const init = await getGroupsState()
    await saveGroupsState({ active: init.active, available: [init.available[0], grp('a', { remoteUpdatedAt: 'S2' })] })
    await saveGroupsState({ active: init.active, available: [init.available[0], grp('a', { remoteUpdatedAt: 'S1-stale-cache' })] })
    expect((await getGroupsState()).available[1].remoteUpdatedAt).toBe('S2')
    await updateGroupsState((cur) => ({ ...cur, available: cur.available.map((g) => (g.id === 'a' ? { ...g, remoteUpdatedAt: 'S3' } : g)) }))
    expect((await getGroupsState()).available[1].remoteUpdatedAt).toBe('S3')
  })
})

// REGRESSION GUARD: a change must not need the page to stay alive after the write was issued.
// Chrome destroys the popup the moment it loses focus. Left to auto-commit, a transaction is only
// committed after every request's success event came back to the page (one more round trip); a
// page destroyed in that gap aborts it and the change is silently gone. So the groups write
// requests its commit itself, in the same synchronous run as its last request.
describe('localDb: a groups write requests its commit with its last request', () => {
  const grp = (id: string) => ({ id, name: id, color: '#fff', updatedAt: 1, windows: [], permanent: false, starred: false })
  const realPut = IDBObjectStore.prototype.put
  const realCommit = IDBTransaction.prototype.commit

  /** Records the last request of a groups write, the commit request, and the first microtask after that last request. */
  function recordWriteOrder(): string[] {
    const events: string[] = []
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.transaction.mode === 'readwrite' && this.name === 'groupsState') {
        events.push('last request')
        queueMicrotask(() => events.push('next microtask'))
      }
      return realPut.apply(this, args)
    })
    vi.spyOn(IDBTransaction.prototype, 'commit').mockImplementation(function (this: IDBTransaction) {
      events.push('commit requested')
      return realCommit.call(this)
    })
    return events
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('updateGroupsState (every user action): the commit is requested before the page gets control back', async () => {
    const { getGroupsState, updateGroupsState } = await freshLocalDb()
    await getGroupsState()
    const events = recordWriteOrder()

    await updateGroupsState((cur) => ({ ...cur, available: [...cur.available, grp('a')] }))

    expect(events).toEqual(['last request', 'commit requested', 'next microtask'])
    vi.restoreAllMocks()
    expect((await getGroupsState()).available.map((g) => g.id)).toContain('a')
  })

  it('saveGroupsState (drag and drop, undo/redo, import): same', async () => {
    const { getGroupsState, saveGroupsState } = await freshLocalDb()
    const initial = await getGroupsState()
    const events = recordWriteOrder()

    await saveGroupsState({ active: initial.active, available: [initial.available[0], grp('a')] })

    expect(events).toEqual(['last request', 'commit requested', 'next microtask'])
    vi.restoreAllMocks()
    expect((await getGroupsState()).available.map((g) => g.id)).toContain('a')
  })

  it('a write refused for a stale rev issues no request and no commit', async () => {
    const { getGroupsState, saveGroupsState } = await freshLocalDb()
    const initial = await getGroupsState()
    await saveGroupsState({ active: initial.active, available: [initial.available[0], grp('a')] })
    const events = recordWriteOrder()

    const stale = saveGroupsState({ active: initial.active, available: [initial.available[0]] }, { expectedRev: initial.rev })
    await expect(stale).rejects.toMatchObject({ name: 'StaleGroupsError' })

    expect(events).toEqual([])
    vi.restoreAllMocks()
    expect((await getGroupsState()).available.map((g) => g.id)).toContain('a')
  })

  it('a read resolves from its results without waiting for the read-only transaction to complete', async () => {
    const { getGroupsState, saveGroupsState } = await freshLocalDb()
    const initial = await getGroupsState()
    await saveGroupsState({ active: initial.active, available: [initial.available[0], grp('a')] })

    // A read-only transaction whose `complete` never reaches the page must not hold the read up.
    const realAdd = IDBTransaction.prototype.addEventListener
    vi.spyOn(IDBTransaction.prototype, 'addEventListener').mockImplementation(function (
      this: IDBTransaction,
      ...args: Parameters<IDBTransaction['addEventListener']>
    ) {
      if (this.mode === 'readonly' && args[0] === 'complete') return
      return realAdd.apply(this, args)
    })

    const state = await Promise.race([getGroupsState(), new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 500))])

    expect(state).not.toBe('timeout')
    expect((state as Awaited<ReturnType<typeof getGroupsState>>).available.map((g) => g.id)).toContain('a')
  })
})
