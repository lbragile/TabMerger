import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import type { Session } from '@supabase/supabase-js'
import { performSync } from '@/lib/syncEngine'
import { getGroupsState, getPendingGroupDeletes, saveGroupsState, markPositionSynced, setSetting } from '@/lib/localDb'
import { GROUPS_QUERY_KEY, useDeleteGroup, useReplaceSavedGroups } from '@/hooks/useGroups'
import { useBulkDelete } from '@/hooks/useBulkActions'
import { useUndoRedo } from '@/hooks/useUndoRedo'
import { useUIStore } from '@/stores/uiStore'
import { createGroup, createNowOpenGroup, createWindow } from '@/lib/utils'
import type { Group } from '@/lib/types'
import { clearDb } from './dbTestUtils'
import { fakeRemote, type RemoteRow } from './fakeSupabase'
import { remoteNames } from './testEncryption'

/**
 * A remote delete that arrives LATE must not undo an Undo. The forward action (delete, bulk
 * delete, replace / JSON import) asks for the remote delete after `auth.getSession()`, which can
 * wait on a token refresh. If the user's Undo lands first, the late marker used to re-mark the
 * restored groups "pending delete": their server rows were deleted and the next merge pruned them
 * locally, leaving neither the old nor the new groups. Real fake-indexeddb + real localDb /
 * syncEngine / hooks; only the Supabase edge and the key are faked.
 */

vi.mock('@/lib/supabase', async () => {
  const m = await import('./fakeSupabase')
  return { supabase: m.fakeSupabase, isSupabaseConfigured: true }
})
vi.mock('@/lib/encryptionKey', () => ({
  getEncryptionKeyState: vi.fn(async () => 'present'),
  getDataKey: vi.fn(async () => (await import('./testEncryption')).testDataKey()),
}))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))

const session = { user: { id: 'user-1' } } as unknown as Session
const BASE = '2030-01-01T00:00:00.000Z'
const tab = (title: string) => ({ id: 0, title, url: `https://example.com/${title}`, savedAt: 1 })
const rowOf = (g: Group, position: number): RemoteRow => ({
  id: g.id, user_id: 'user-1', name: g.name, color: g.color, updated_at: BASE,
  windows: g.windows, starred: false, archived: false, note: null, info: g.info ?? '', position,
})

/** Signed-in device in sync with the server. `cloudSyncActive` is what the write's own marker gate reads. */
async function seed(cloudSyncActive = true) {
  const nowOpen = createNowOpenGroup()
  const groups = ['Work', 'Play', 'Read'].map((name, i) => ({
    ...createGroup(name.toLowerCase(), name),
    windows: [createWindow([tab(`${name}-${i}`)])],
    updatedAt: 1000,
    remoteUpdatedAt: BASE,
    pendingSync: false,
  }))
  await saveGroupsState({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen, ...groups] })
  for (const [i, g] of groups.entries()) {
    await markPositionSynced(g.id, i + 1)
    fakeRemote.rows.set(g.id, rowOf(g, i + 1))
  }
  await setSetting('remoteBaseSeeded', true)
  await setSetting('cloudSyncActive', cloudSyncActive)
}

async function setup<T>(useAction: () => T) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  qc.setQueryData(GROUPS_QUERY_KEY, await getGroupsState())
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
  const { result } = renderHook(() => ({ action: useAction(), history: useUndoRedo() }), { wrapper })
  await waitFor(() => expect(qc.isFetching()).toBe(0))
  return result
}

const localNames = async () => (await getGroupsState()).available.filter((g) => !g.permanent).map((g) => g.name).sort()
/** Lets every fire-and-forget remote delete settle. */
const settle = () => new Promise((r) => setTimeout(r, 20))

beforeEach(async () => {
  fakeRemote.reset()
  await clearDb()
  useUIStore.setState({ undoStack: [], redoStack: [], tourHistory: null, selectedItems: [], selectionMode: false, activeGroupIndex: 1 })
})

describe('a late remote-delete marker never deletes groups an Undo restored', () => {
  const cases: Array<[string, () => unknown, (a: never) => Promise<unknown>, string[]]> = [
    ['delete group', () => useDeleteGroup(), (a: ReturnType<typeof useDeleteGroup>) => a.mutateAsync(2), ['Play']],
    ['bulk delete of groups', () => useBulkDelete(), (a: ReturnType<typeof useBulkDelete>) => a.mutateAsync([{ type: 'group', id: 'group-1' }, { type: 'group', id: 'group-3' }]), ['Read', 'Work']],
    ['replace (JSON import / restore a backup)', () => useReplaceSavedGroups(), (a: ReturnType<typeof useReplaceSavedGroups>) => a.mutateAsync([{ ...createGroup('imp', 'Imported'), windows: [createWindow([tab('i1')])] }]), ['Play', 'Read', 'Work']],
  ]

  it.each(cases)('%s, Undo while getSession() is still in flight: the groups survive locally and on the server', async (_n, useAction, run, removed) => {
    await seed()
    const result = await setup(useAction)
    const gate = fakeRemote.hold('getSession')
    await act(async () => {
      await run(result.current.action as never)
    })
    await gate.entered // the forward action's remote delete is waiting on the session
    for (const name of removed) expect(await localNames()).not.toContain(name)

    await act(async () => {
      await result.current.history.undo()
    })
    expect(await localNames()).toEqual(['Play', 'Read', 'Work'])
    gate.release()
    await settle()

    // the late request recorded none of the restored groups and deleted none of their rows (an Undo
    // of the replace does delete the IMPORTED group, which it removed)
    const restored = ['work', 'play', 'read']
    expect((await getPendingGroupDeletes()).filter((id) => restored.includes(id))).toEqual([])
    expect(fakeRemote.deleteCalls.flat().filter((id) => restored.includes(id))).toEqual([])
    await performSync(session)
    expect(await localNames()).toEqual(['Play', 'Read', 'Work'])
    expect((await remoteNames()).sort()).toEqual(['Play', 'Read', 'Work'])
  })
})

describe('JSON import, Undo, sync', () => {
  it('the old groups go back to the server and the imported ones are deleted remotely', async () => {
    await seed()
    const result = await setup(() => useReplaceSavedGroups())
    await act(async () => {
      await result.current.action.mutateAsync([{ ...createGroup('imp', 'Imported'), windows: [createWindow([tab('i1')])] }])
    })
    await settle()
    await performSync(session)
    expect(await remoteNames()).toEqual(['Imported'])

    await act(async () => {
      await result.current.history.undo()
    })
    await settle()
    await performSync(session)
    expect(await localNames()).toEqual(['Play', 'Read', 'Work'])
    expect((await remoteNames()).sort()).toEqual(['Play', 'Read', 'Work'])
  })
})

describe('Redo of a delete or a replace deletes remotely like the forward action', () => {
  it('even while cloudSyncActive is still false (entitlements not loaded), Redo of a replace deletes the old rows', async () => {
    await seed(false)
    const result = await setup(() => useReplaceSavedGroups())
    await act(async () => {
      await result.current.action.mutateAsync([{ ...createGroup('imp', 'Imported'), windows: [createWindow([tab('i1')])] }])
    })
    await settle()
    await act(async () => {
      await result.current.history.undo()
    })
    await settle()
    await performSync(session) // the old groups are re-inserted
    expect((await remoteNames()).sort()).toEqual(['Play', 'Read', 'Work'])

    await act(async () => {
      await result.current.history.redo()
    })
    await settle()
    expect(await localNames()).toEqual(['Imported'])
    // the removed groups' rows are gone from the server and stay gone after a sync
    await performSync(session)
    expect(await remoteNames()).toEqual(['Imported'])
    expect(await localNames()).toEqual(['Imported'])
  })

  it('Redo of a group delete deletes its row', async () => {
    await seed(false)
    const result = await setup(() => useDeleteGroup())
    await act(async () => {
      await result.current.action.mutateAsync(1)
    })
    await settle()
    await act(async () => {
      await result.current.history.undo()
    })
    await settle()
    await performSync(session)
    expect((await remoteNames()).sort()).toEqual(['Play', 'Read', 'Work'])
    await act(async () => {
      await result.current.history.redo()
    })
    await settle()
    await performSync(session)
    expect((await remoteNames()).sort()).toEqual(['Play', 'Read'])
  })
})
