import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import type { Session } from '@supabase/supabase-js'
import { performSync, performSyncCycle } from '@/lib/syncEngine'
import { getGroupsState, saveGroupsState, updateGroupsState, markPositionSynced, markGroupSynced, setSetting, getSetting } from '@/lib/localDb'
import { onSyncConflict } from '@/lib/foreignChange'
import { restoreSnapshotAsLocalChange, prepareImportedState } from '@/lib/syncDirty'
import { deleteRemoteGroups } from '@/lib/syncEngine'
import { useDuplicateGroup, useGroups } from '@/hooks/useGroups'
import { createGroup, createNowOpenGroup } from '@/lib/utils'
import { getEncryptionKeyState, getDataKey } from '@/lib/encryptionKey'
import type { Group } from '@/lib/types'
import { clearDb } from './dbTestUtils'
import { fakeRemote, type RemoteRow } from './fakeSupabase'
import { testDataKey, remoteName, remoteNames } from './testEncryption'

// Third audit pass (F1-F5, F9): new identities carry no server base, syncs never overlap, stamps are
// compared as instants, the base-seeding flag waits for every pending group, and the pull is paginated.

vi.mock('@/lib/supabase', async () => {
  const m = await import('./fakeSupabase')
  return { supabase: m.fakeSupabase, isSupabaseConfigured: true }
})
vi.mock('@/lib/encryptionKey', () => ({
  getEncryptionKeyState: vi.fn(async () => 'present'),
  getDataKey: vi.fn(async () => (await import('./testEncryption')).testDataKey()),
}))

const session = { user: { id: 'user-1' } } as unknown as Session
const BASE = '2030-01-01T00:00:00.000Z'

const rowOf = (g: Group, stamp = BASE, position = 1): RemoteRow => ({
  id: g.id, user_id: 'user-1', name: g.name, color: g.color, updated_at: stamp,
  windows: g.windows, starred: false, archived: false, note: null, info: g.info ?? '', position,
})
const grp = (id: string, name: string): Group => ({ ...createGroup(id, name), updatedAt: 1000, pendingSync: false })

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
  return nowOpen
}

const names = async () => (await getGroupsState()).available.map((g) => g.name)
const copies = async () => (await names()).filter((n) => n.includes('(conflict copy)'))

let conflicts: ReturnType<typeof vi.fn<(names: string[]) => void>>
let offConflicts: () => void
afterEach(() => offConflicts())
beforeEach(async () => {
  fakeRemote.reset()
  await clearDb()
  vi.mocked(getEncryptionKeyState).mockResolvedValue('present')
  vi.mocked(getDataKey).mockResolvedValue(await testDataKey())
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  conflicts = vi.fn<(names: string[]) => void>()
  offConflicts = onSyncConflict(conflicts)
})

describe('F1 a group with a NEW identity carries no server base', () => {
  it('duplicate group: inserts as a new row, no "(conflict copy)", no conflict toast', async () => {
    await seed(grp('g1', 'Source'))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const w = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
    const { result: groups } = renderHook(() => useGroups(), { wrapper: w })
    await waitFor(() => expect(groups.current.isSuccess).toBe(true))
    const { result: dup } = renderHook(() => useDuplicateGroup(), { wrapper: w })
    await act(async () => { await dup.current.mutateAsync(1) })

    await performSync(session)
    await performSync(session)

    expect(await copies()).toHaveLength(0)
    expect((await getGroupsState()).available).toHaveLength(3)
    expect(fakeRemote.rows.size).toBe(2) // the source and its duplicate
    expect(conflicts).not.toHaveBeenCalled()
  })

  it('undo of a delete: the restored group re-inserts instead of CAS-ing a missing row into a copy', async () => {
    const nowOpen = await seed(grp('g1', 'Keep me'))
    const before = await getGroupsState()
    // delete it everywhere (local prune + remote DELETE landed)
    await saveGroupsState({ ...before, available: [nowOpen] })
    await deleteRemoteGroups(['g1'])
    expect(fakeRemote.rows.has('g1')).toBe(false)

    // undo: the snapshot still carries the OLD base
    const current = await getGroupsState()
    await saveGroupsState(restoreSnapshotAsLocalChange(current, before))

    await performSync(session)
    await performSync(session)

    expect(await copies()).toHaveLength(0)
    expect((await names()).slice(1)).toEqual(['Keep me'])
    expect(await remoteName('g1')).toBe('Keep me')
    expect(conflicts).not.toHaveBeenCalled()
  })

  it('JSON import: imported groups get fresh ids and no bookkeeping, so they never collide with existing rows', async () => {
    const nowOpen = await seed(grp('g1', 'Existing'))
    const exported = await getGroupsState() // an export of this very store, bases and flags included
    const imported = prepareImportedState(exported, await getGroupsState())
    expect(imported.available.slice(1).every((g) => g.id !== 'g1' && !g.remoteUpdatedAt && !g.positionDirty && g.pendingSync)).toBe(true)
    expect(imported.available[0].id).toBe(nowOpen.id)

    await saveGroupsState(imported)
    await performSync(session)
    await performSync(session)

    expect(await copies()).toHaveLength(0)
    expect(fakeRemote.rows.has('g1')).toBe(false) // the replaced group was deleted remotely
    expect((await remoteNames())).toEqual(['Existing'])
    expect(conflicts).not.toHaveBeenCalled()
  })
})

describe('F2 sync cycles never overlap', () => {
  it('a second performSync while one is running is skipped, so a new group cannot be deleted by a stale pull', async () => {
    await seed(grp('g1', 'A'))
    const s = await getGroupsState()
    await saveGroupsState({ ...s, available: [...s.available, { ...createGroup('n1', 'New'), pendingSync: true }] })

    const gate = fakeRemote.hold('upsert') // cycle A pauses while pushing n1
    const a = performSync(session)
    await gate.entered
    await performSync(session) // cycle B: skipped (the lock is held); it must not fetch/merge
    gate.release()
    await a

    expect(fakeRemote.selects).toHaveLength(1) // only cycle A pulled
    expect((await names()).slice(1)).toEqual(['A', 'New'])
    expect(fakeRemote.rows.has('n1')).toBe(true)
  })

  it('G3: a request that never answers blocks neither local reads nor local writes, and an overlapping cycle reports skipped', async () => {
    await seed(grp('g1', 'A'))
    const gate = fakeRemote.hold('select') // cycle A hangs in its pull, holding the sync lock
    const a = performSyncCycle(session)
    await gate.entered

    // the local store stays fully usable while the request hangs
    expect((await names()).slice(1)).toEqual(['A'])
    await updateGroupsState((s) => ({ ...s, available: [...s.available, { ...createGroup('n1', 'Local'), pendingSync: true }] }))
    expect((await names()).slice(1)).toEqual(['A', 'Local'])
    // a second cycle is skipped, and says so (it must not claim it synced)
    expect(await performSyncCycle(session)).toMatchObject({ skipped: true })

    gate.release()
    expect((await a).skipped).toBe(false)
    expect((await names()).slice(1)).toEqual(['A', 'Local']) // the write made mid-cycle survived the merge
  })

  it('sends nothing while the encryption status cannot be checked, then pushes once it can', async () => {
    await seed()
    await updateGroupsState((s) => ({ ...s, available: [...s.available, { ...createGroup('n1', 'Private'), pendingSync: true }] }))

    vi.mocked(getEncryptionKeyState).mockResolvedValue('unknown')
    await performSync(session)
    expect(fakeRemote.upserts).toEqual([]) // no plaintext row left the device
    expect((await getGroupsState()).available[1]).toMatchObject({ id: 'n1', pendingSync: true })

    vi.mocked(getEncryptionKeyState).mockResolvedValue('present')
    await performSync(session)
    expect(await remoteName('n1')).toBe('Private') // stored as ciphertext, readable with the key
    expect(fakeRemote.rows.get('n1')?.name).toBe('')
    expect((await getGroupsState()).available[1].pendingSync).toBe(false)
  })

  it('a clean group is NOT replaced by a remote row whose stamp is older than its base', async () => {
    await seed(grp('g1', 'Fresh'))
    await updateGroupsState((s) => ({ ...s, available: s.available.map((g) => (g.id === 'g1' ? { ...g, remoteUpdatedAt: '2030-01-01T00:10:00.000Z' } : g)) }))
    fakeRemote.rows.set('g1', { ...rowOf(grp('g1', 'Stale snapshot'), '2030-01-01T00:05:00.000Z') }) // older than the base
    await performSync(session)
    expect((await names()).slice(1)).toEqual(['Fresh'])
  })

  it('instants, not strings: the same moment in another format is not a change', async () => {
    await seed(grp('g1', 'Same'))
    await updateGroupsState((s) => ({ ...s, available: s.available.map((g) => (g.id === 'g1' ? { ...g, name: 'Edited', pendingSync: true, remoteUpdatedAt: '2030-01-01T00:00:00.123456+00:00' } : g)) }))
    fakeRemote.rows.set('g1', rowOf(grp('g1', 'Same'), '2030-01-01 00:00:00.123456Z')) // same instant, other spelling
    await performSync(session)
    expect(await copies()).toHaveLength(0)
    expect((await getGroupsState()).available[1].name).toBe('Edited')
  })
})

describe('F4 the seeding flag waits for every pending group', () => {
  it('is not set while a pending group without a base has a (locked) remote row', async () => {
    vi.mocked(getEncryptionKeyState).mockResolvedValue('present')
    vi.mocked(getDataKey).mockResolvedValue(null)
    const nowOpen = createNowOpenGroup()
    await saveGroupsState({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen, { ...grp('g1', 'Old pending'), pendingSync: true }] })
    fakeRemote.rows.set('g1', { ...rowOf(grp('g1', 'x')), windows: { v: 1, iv: 'iv', ct: 'ct' } })
    await performSync(session)
    expect(await getSetting('remoteBaseSeeded', false)).toBe(false)
  })

  it('is set once nothing is left unseeded', async () => {
    const nowOpen = createNowOpenGroup()
    await saveGroupsState({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen, { ...grp('g1', 'New one'), pendingSync: true }] })
    await performSync(session)
    expect(await getSetting('remoteBaseSeeded', false)).toBe(true)
  })
})

describe('F9 the pull is paginated', () => {
  const bulk = (n: number) => {
    for (let i = 0; i < n; i++) {
      const g = grp(`bulk${i}`, `B${i}`)
      fakeRemote.rows.set(g.id, rowOf(g, BASE, i + 1))
    }
  }
  const sortedBulkIds = (n: number) => Array.from({ length: n }, (_, i) => `bulk${i}`).sort()

  it('reads every page, not just the first 1000 rows', async () => {
    await seed()
    bulk(1100)
    await performSync(session)
    expect((await getGroupsState()).available).toHaveLength(1101)
    // keyset pages: no cursor, then `id > last id of page 1` (ids sort as strings)
    expect(fakeRemote.selects).toEqual([null, sortedBulkIds(1100)[999]])
  })

  it('aborts the whole cycle (no merge, no local deletes) when a later page fails', async () => {
    await seed(grp('keep', 'Keep'))
    bulk(1100)
    fakeRemote.failAfterPages = 1
    await performSync(session)
    const ids = (await getGroupsState()).available.map((g) => g.id)
    expect(ids).toEqual([ids[0], 'keep']) // nothing merged in, and the clean group was not treated as deleted
    expect(fakeRemote.selects).toHaveLength(2) // the second page was requested and failed
  })

  it('G1: a row another device updates between two pages is still read (not dropped as "deleted remotely")', async () => {
    bulk(1100)
    const [first, ...rest] = sortedBulkIds(1100)
    const late = rest[rest.length - 1] // only on page 2
    await seed()
    await performSync(session) // this device now holds all 1100 groups, clean
    expect((await getGroupsState()).available).toHaveLength(1101)

    // While the next pull is between its pages, another device edits one row of EACH page. With
    // offset pages ordered by updated_at both rows jumped to the front: the page-2 row was never
    // read and this device deleted it locally and queued a remote DELETE for it.
    fakeRemote.afterPage(1, () => {
      fakeRemote.serverEdit(first, { name: 'Edited page 1' })
      fakeRemote.serverEdit(late, { name: 'Edited page 2' })
    })
    await performSync(session)

    const after = (await getGroupsState()).available
    expect(after).toHaveLength(1101) // nothing was treated as deleted
    expect(after.find((g) => g.id === late)?.name).toBe('Edited page 2') // read on its own page
    expect(fakeRemote.rows.size).toBe(1100)
    expect(fakeRemote.deleteCalls).toEqual([])
    expect(await getSetting('pendingDeleteGroupIds', [])).toEqual([])
  })
})

describe('edit in flight (formerly flaky)', () => {
  it('two edits within the same millisecond are still two versions: the in-flight one keeps the pending flag', async () => {
    await seed(grp('g1', 'Orig'))
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2031-01-01T00:00:00.000Z'))
      const s1 = await getGroupsState()
      await saveGroupsState({ ...s1, available: s1.available.map((g) => (g.id === 'g1' ? { ...g, name: 'v1', updatedAt: Date.now(), pendingSync: true } : g)) })
      const gate = fakeRemote.hold('upsert')
      const sync = performSync(session)
      await gate.entered
      const s2 = await getGroupsState()
      // SAME Date.now() as v1 (the clock is frozen): the version check must still see a newer edit
      await saveGroupsState({ ...s2, available: s2.available.map((g) => (g.id === 'g1' ? { ...g, name: 'v2', updatedAt: Date.now(), pendingSync: true } : g)) })
      gate.release()
      await sync
      expect((await getGroupsState()).available[1].pendingSync).toBe(true)
      void markGroupSynced
    } finally {
      vi.useRealTimers()
    }
  })
})
