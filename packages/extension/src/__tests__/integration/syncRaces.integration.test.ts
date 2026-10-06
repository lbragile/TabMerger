import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import type { Session } from '@supabase/supabase-js'
import { performSync, pushPendingChanges, deleteRemoteGroups, subscribeToRemoteChanges } from '@/lib/syncEngine'
import {
  getGroupsState,
  saveGroupsState,
  saveGroup,
  clearLocalAccountData,
  getPendingSyncGroups,
  markPositionSynced,
} from '@/lib/localDb'
import { createGroup, createNowOpenGroup } from '@/lib/utils'
import { useReorderGroups, useUpdateGroupName, useGroups } from '@/hooks/useGroups'
import { useUndoRedo } from '@/hooks/useUndoRedo'
import { useUIStore } from '@/stores/uiStore'
import { applyUrlRule } from '@/lib/urlRuleEngine'
import type { Group } from '@/lib/types'
import { clearDb } from './dbTestUtils'
import { fakeRemote, type RemoteRow } from './fakeSupabase'
import { remoteName } from './testEncryption'

// ponytail: TESTS-FIRST for known, UNFIXED sync/IndexedDB bugs. Every `it` below is expected to
// FAIL today for the reason stated in its describe name, and to pass once the bug is fixed.
// Real fake-indexeddb + real localDb/syncEngine/hooks; only the Supabase network edge and the
// encryption key are faked (see fakeSupabase.ts). Do NOT "fix" a red test by weakening it.

vi.mock('@/lib/supabase', async () => {
  const m = await import('./fakeSupabase')
  return { supabase: m.fakeSupabase, isSupabaseConfigured: true }
})
vi.mock('@/lib/encryptionKey', () => ({
  getEncryptionKeyState: vi.fn(async () => 'present'),
  getDataKey: vi.fn(async () => (await import('./testEncryption')).testDataKey()),
  ENCRYPTION_MIGRATION_DONE_KEY: 'encryptionMigrationDone',
  SESSIONS_MIGRATION_DONE_KEY: 'sessionsEncryptionMigrationDone',
}))

const session = { user: { id: 'user-1' } } as unknown as Session

function synced(id: string, over: Partial<Group> = {}): Group {
  return { ...createGroup(id, `name-${id}`), updatedAt: 1000, pendingSync: false, ...over }
}

function remoteRow(g: Group): RemoteRow {
  return {
    id: g.id,
    user_id: 'user-1',
    name: g.name,
    color: g.color,
    updated_at: new Date(g.updatedAt).toISOString(),
    windows: g.windows,
    starred: false,
    archived: false,
    note: null,
    info: g.info ?? '',
  }
}

async function seed(...groups: Group[]): Promise<Group> {
  const nowOpen = createNowOpenGroup()
  await saveGroupsState({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen, ...groups] })
  return nowOpen
}

async function editGroup(id: string, patch: Partial<Group>): Promise<void> {
  const s = await getGroupsState()
  await saveGroupsState({ ...s, available: s.available.map((g) => (g.id === id ? { ...g, ...patch } : g)) })
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return React.createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(async () => {
  fakeRemote.reset()
  await clearDb()
  useUIStore.setState({ undoStack: [], redoStack: [] })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('BUG #1 (HIGH) performSync writes a stale snapshot over edits made during the network wait', () => {
  it('does not revert a local edit made while the pull is in flight', async () => {
    const g = synced('g1', { name: 'Old' })
    await seed(g)
    fakeRemote.rows.set('g1', remoteRow(g))

    const gate = fakeRemote.hold('select')
    const sync = performSync(session)
    await gate.entered // performSync has already read its snapshot; pull is awaiting the network

    await editGroup('g1', { name: 'Edited', updatedAt: 2000, pendingSync: true })

    gate.release()
    await sync

    const after = (await getGroupsState()).available.find((x) => x.id === 'g1')
    expect(after?.name).toBe('Edited')
    expect(after?.pendingSync).toBe(true)
  })

  it('does not delete a group created while the pull is in flight (and it stays pending push)', async () => {
    await seed(synced('g1'))
    fakeRemote.rows.set('g1', remoteRow(synced('g1')))

    const gate = fakeRemote.hold('select')
    const sync = performSync(session)
    await gate.entered

    const created = createGroup('new1', 'Created mid-sync') // pendingSync:true, never pushed
    const s = await getGroupsState()
    await saveGroupsState({ ...s, available: [...s.available, created] })

    gate.release()
    await sync

    const ids = (await getGroupsState()).available.map((x) => x.id)
    expect(ids).toContain('new1')
    expect((await getPendingSyncGroups()).map((x) => x.id)).toContain('new1')
  })
})

describe('BUG #2 (HIGH) remote delete is attempted once and never retried (resurrection)', () => {
  it('retries a failed (offline) DELETE on a later sync, even after a module reload', async () => {
    const g = synced('g1')
    await seed(g)
    fakeRemote.rows.set('g1', remoteRow(g))

    // Delete locally, then the DELETE request fails (offline).
    const s = await getGroupsState()
    await saveGroupsState({ ...s, available: s.available.filter((x) => x.id !== 'g1') })
    fakeRemote.failDelete = true
    await deleteRemoteGroups(['g1'])
    expect(fakeRemote.rows.has('g1')).toBe(true) // precondition: delete did not land

    // "Restart": brand-new module instances (popup closed / SW evicted), network is back.
    vi.resetModules()
    const fresh = await import('@/lib/syncEngine')
    fakeRemote.failDelete = false
    await fresh.performSync(session)

    expect(fakeRemote.rows.has('g1')).toBe(false)
  })

  it('removes a row re-created by an upsert that was in flight when the DELETE ran', async () => {
    const g = synced('g1', { pendingSync: true })
    await seed(g)

    const gate = fakeRemote.hold('upsert')
    const push = pushPendingChanges(session)
    await gate.entered // upsert sent, not yet applied server-side

    const s = await getGroupsState()
    await saveGroupsState({ ...s, available: s.available.filter((x) => x.id !== 'g1') })
    await deleteRemoteGroups(['g1']) // DELETE lands first (matches nothing)

    gate.release() // ...then the upsert lands and re-creates the row
    await push
    expect(fakeRemote.rows.has('g1')).toBe(true) // precondition: resurrected remotely

    await performSync(session)
    expect(fakeRemote.rows.has('g1')).toBe(false)
  })
})

describe('BUG #3 (HIGH) clearLocalAccountData does not order against queued groups writes', () => {
  it('a groups write issued before the wipe cannot restore the previous account groups after it', async () => {
    const nowOpen = createNowOpenGroup()
    const prevAccountGroup = synced('prev-acct')
    const write = saveGroupsState({
      active: { id: nowOpen.id, index: 0 },
      available: [nowOpen, prevAccountGroup],
    })
    const wipe = clearLocalAccountData() // issued after the write, outside the write queue
    await Promise.all([write, wipe])

    const ids = (await getGroupsState()).available.map((x) => x.id)
    expect(ids).not.toContain('prev-acct')
  })
})

describe('BUG #4 (MEDIUM) popup vs background worker: cross-context read-modify-write loses a write', () => {
  // Two module graphs = two JS contexts (each with its OWN write queue/gen) on one IndexedDB.
  // A blind read-then-saveGroupsState can never merge two writers (the second would prune the
  // first's new group), so writers use the atomic `updateGroupsState` (fresh read inside the
  // queue + cross-context lock) -- these tests drive it from both contexts at once.
  async function twoContexts() {
    vi.resetModules()
    const popup = await import('@/lib/localDb')
    vi.resetModules()
    const worker = await import('@/lib/localDb')
    expect(popup).not.toBe(worker)
    const nowOpen = createNowOpenGroup()
    await popup.saveGroupsState({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen] })
    return { popup, worker }
  }

  it('keeps both groups when two independent module instances run read-modify-writes concurrently', async () => {
    const { popup, worker } = await twoContexts()

    // Both started in the same tick: without cross-context exclusion both read the same base
    // state and the second writer prunes the first's new group.
    await Promise.all([
      popup.updateGroupsState((s) => ({ ...s, available: [...s.available, createGroup('from-popup', 'P')] })),
      worker.updateGroupsState((s) => ({ ...s, available: [...s.available, createGroup('from-worker', 'W')] })),
    ])

    const ids = (await popup.getGroupsState()).available.map((x) => x.id)
    expect(ids).toContain('from-popup')
    expect(ids).toContain('from-worker')
  })

  it('keeps a popup-created group and the service worker URL-rule tab when they race (real writers)', async () => {
    vi.resetModules()
    const popup = await import('@/lib/localDb')
    vi.resetModules()
    const workerRules = await import('@/lib/urlRuleEngine') // brings its OWN localDb instance
    const nowOpen = createNowOpenGroup()
    await popup.saveGroupsState({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen, synced('g1')] })

    const tab = { id: 7, url: 'https://example.com/', title: 'Example', favIconUrl: '' } as chrome.tabs.Tab
    await Promise.all([
      popup.updateGroupsState((s) => ({ ...s, available: [...s.available, createGroup('from-popup', 'P')] })),
      workerRules.applyUrlRule(tab, 'g1'),
    ])

    const after = (await popup.getGroupsState()).available
    expect(after.map((x) => x.id)).toContain('from-popup')
    expect(after.find((x) => x.id === 'g1')?.windows[0].tabs).toHaveLength(1)
  })

  it('serialises many interleaved read-modify-writes from both contexts without losing any', async () => {
    const { popup, worker } = await twoContexts()
    const add = (db: typeof popup, id: string) =>
      db.updateGroupsState((s) => ({ ...s, available: [...s.available, createGroup(id, id)] }))

    await Promise.all(Array.from({ length: 6 }, (_, i) => (i % 2 ? add(worker, `w${i}`) : add(popup, `p${i}`))))

    const ids = (await popup.getGroupsState()).available.map((x) => x.id)
    for (const id of ['p0', 'w1', 'p2', 'w3', 'p4', 'w5']) expect(ids).toContain(id)
  })
})

describe('BUG #5 (MEDIUM) groups.position is never pushed / reorder does not mark groups dirty', () => {
  it('pushes rows carrying position = local sidebar index (Now Open is 0 and never pushed)', async () => {
    const a = synced('a', { pendingSync: true })
    const b = synced('b', { pendingSync: true })
    const c = synced('c', { pendingSync: true })
    const nowOpen = await seed(a, b, c)

    await pushPendingChanges(session)

    expect(fakeRemote.upserts.some((r) => r.id === nowOpen.id)).toBe(false)
    const pos = (id: string) => fakeRemote.upserts.find((r) => r.id === id)?.position
    expect(pos('a')).toBe(1)
    expect(pos('b')).toBe(2)
    expect(pos('c')).toBe(3)
  })

  // Phase 4b: a reorder flags `positionDirty`, NOT `pendingSync` -- pendingSync re-pushes the
  // whole (possibly stale) row, so a reorder could overwrite another device's newer content.
  it('a reorder marks every group whose index changed positionDirty (and none pendingSync)', async () => {
    await seed(synced('a'), synced('b'), synced('c'))
    for (const [i, id] of ['a', 'b', 'c'].entries()) await markPositionSynced(id, i + 1) // already in sync
    const { result: groups } = renderHook(() => useGroups(), { wrapper })
    await waitFor(() => expect(groups.current.isSuccess).toBe(true))
    const { result: reorder } = renderHook(() => useReorderGroups(), { wrapper })

    // c: 3 -> 1, so a: 1 -> 2 and b: 2 -> 3 also moved
    await reorder.current.mutateAsync({ from: 3, to: 1 })

    const after = (await getGroupsState()).available
    expect(after.filter((g) => g.positionDirty).map((g) => g.id).sort()).toEqual(['a', 'b', 'c'])
    expect(await getPendingSyncGroups()).toHaveLength(0)
  })
})

describe('BUG #6 (LOW) markGroupSynced clears pendingSync on a newer, unpushed edit', () => {
  it('keeps pendingSync when the group was edited between push start and markGroupSynced', async () => {
    await seed(synced('g1', { name: 'v1', pendingSync: true }))

    const gate = fakeRemote.hold('upsert')
    const push = pushPendingChanges(session)
    await gate.entered // v1 is on the wire

    await editGroup('g1', { name: 'v2', updatedAt: 5000, pendingSync: true })

    gate.release()
    await push

    const after = (await getGroupsState()).available.find((x) => x.id === 'g1')
    expect(after?.name).toBe('v2')
    expect(after?.pendingSync).toBe(true) // v2 was never pushed
  })
})

describe('BUG #7 (LOW) realtime last-write-wins check is a no-op (saveGroup runs before comparison)', () => {
  it('an older remote update does not overwrite a newer local edit in IndexedDB', async () => {
    const local = synced('g1', { name: 'Local newer', updatedAt: 5000, pendingSync: true })
    await seed(local)

    await subscribeToRemoteChanges(session, () => {})
    expect(fakeRemote.realtimeCb).toBeTruthy()

    const older = synced('g1', { name: 'Remote older', updatedAt: 1000 })
    await fakeRemote.realtimeCb!({ eventType: 'UPDATE', new: remoteRow(older) })

    const after = (await getGroupsState()).available.find((x) => x.id === 'g1')
    expect(after?.name).toBe('Local newer')
  })
})

describe('BUG #8 (LOW) applyUrlRule never sets pendingSync / savedAt', () => {
  const tab = { id: 7, url: 'https://example.com/', title: 'Example', favIconUrl: '' } as chrome.tabs.Tab

  it('marks the target group pendingSync so the URL-rule save is pushed', async () => {
    await seed(synced('g1'))
    await applyUrlRule(tab, 'g1')

    const g = (await getGroupsState()).available.find((x) => x.id === 'g1')
    expect(g?.windows[0].tabs).toHaveLength(1)
    expect(g?.pendingSync).toBe(true)
    expect((await getPendingSyncGroups()).map((x) => x.id)).toContain('g1')
  })

  it('stamps savedAt on the tab it adds to a saved group', async () => {
    await seed(synced('g1'))
    await applyUrlRule(tab, 'g1')

    const g = (await getGroupsState()).available.find((x) => x.id === 'g1')
    expect(g?.windows[0].tabs[0].savedAt).toEqual(expect.any(Number))
  })
})

describe('BUG #9 (LOW) undo restores the snapshot old updatedAt with pendingSync:false', () => {
  it('an undone edit is not re-applied from remote by the next sync, and the undo is pushed', async () => {
    const g = synced('g1', { name: 'A' })
    await seed(g)
    fakeRemote.rows.set('g1', remoteRow(g))

    const { result: groups } = renderHook(() => useGroups(), { wrapper })
    await waitFor(() => expect(groups.current.isSuccess).toBe(true))
    const { result: rename } = renderHook(() => useUpdateGroupName(), { wrapper })
    await rename.current.mutateAsync({ groupIndex: 1, name: 'B' })
    await performSync(session) // remote now has name B

    // Hook shares the query client with `groups`: render both in one tree.
    const { result } = renderHook(() => ({ g: useGroups(), u: useUndoRedo() }), { wrapper })
    await waitFor(() => expect(result.current.g.isSuccess).toBe(true))
    await act(async () => {
      await result.current.u.undo()
    })
    expect((await getGroupsState()).available[1].name).toBe('A') // precondition: local undo worked

    await performSync(session)

    expect((await getGroupsState()).available[1].name).toBe('A') // pull must not bring B back
    expect(await remoteName('g1')).toBe('A') // and the undo reaches the server
  })
})
