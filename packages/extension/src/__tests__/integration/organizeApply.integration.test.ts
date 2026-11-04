import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import type { Session } from '@supabase/supabase-js'
import { performSync } from '@/lib/syncEngine'
import { getGroupsState, getSetting, markPositionSynced, saveGroupsState, setSetting } from '@/lib/localDb'
import { createGroup, createNowOpenGroup, createWindow, createTab } from '@/lib/utils'
import { forgetHistoryCursor } from '@/lib/undoHistory'
import { useGroups } from '@/hooks/useGroups'
import { useApplyOrganize } from '@/hooks/useApplyOrganize'
import { useUndoRedo } from '@/hooks/useUndoRedo'
import { useUIStore } from '@/stores/uiStore'
import type { Group, UrlRule } from '@/lib/types'
import { clearDb } from './dbTestUtils'
import { fakeRemote, type RemoteRow } from './fakeSupabase'

/**
 * AI Organize "Apply selected" against REAL IndexedDB (fake-indexeddb, the real localDb write queue)
 * and the real sync engine with a faked Supabase edge: the selected actions land as one write and
 * one undo step, the URL rules follow a merge, and a sync deletes the merged-away row and pushes the
 * archive, so a later pull neither brings the merged group back nor un-archives the archived one.
 */

vi.mock('@/lib/supabase', async () => {
  const m = await import('./fakeSupabase')
  return { supabase: m.fakeSupabase, isSupabaseConfigured: true }
})
vi.mock('@/lib/encryptionKey', () => ({
  getEncryptionKeyState: vi.fn(async () => 'present'),
  getDataKey: vi.fn(async () => (await import('./testEncryption')).testDataKey())
}))
vi.mock('@/lib/toast', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))

const session = { user: { id: 'user-1' } } as unknown as Session
const BASE = '2030-01-01T00:00:00.000Z'
const rowOf = (g: Group, position: number): RemoteRow => ({
  id: g.id, user_id: 'user-1', name: g.name, color: g.color, updated_at: BASE,
  windows: g.windows, starred: false, archived: false, note: null, info: g.info ?? '', position
})

/** A signed-in device whose four saved groups are in sync with the server. */
async function seed() {
  const nowOpen = createNowOpenGroup()
  const make = (id: string, name: string, tabs: string[]): Group => ({
    ...createGroup(id, name),
    windows: [createWindow(tabs.map((t) => ({ ...createTab(t, `https://${t}.example.com`), savedAt: 1 })))],
    updatedAt: 1000,
    remoteUpdatedAt: BASE,
    pendingSync: false
  })
  const groups = [make('shop', 'Shopping', ['s1']), make('errands', 'Errands', ['e1', 'e2']), make('docs', 'Docs', ['d1']), make('old', 'Old', ['o1'])]
  await saveGroupsState({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen, ...groups] })
  for (const [i, g] of groups.entries()) {
    await markPositionSynced(g.id, i + 1)
    fakeRemote.rows.set(g.id, rowOf(g, i + 1))
  }
  await setSetting('remoteBaseSeeded', true)
  await setSetting('cloudSyncActive', true)
  const rules: UrlRule[] = [
    { id: 'r1', pattern: 's1.example.com/*', groupId: 'shop', createdAt: 1 },
    { id: 'r2', pattern: 'd1.example.com/*', groupId: 'docs', createdAt: 2 }
  ]
  await setSetting('urlRules', rules)
  return nowOpen
}

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
  const { result } = renderHook(() => ({ groups: useGroups(), apply: useApplyOrganize(), history: useUndoRedo() }), { wrapper })
  await waitFor(() => expect(result.current.groups.isSuccess).toBe(true))
  return result
}

const saved = async () => (await getGroupsState()).available.filter((g) => !g.permanent)

beforeEach(async () => {
  vi.clearAllMocks()
  fakeRemote.reset()
  await clearDb()
  forgetHistoryCursor()
  useUIStore.setState({ undoStack: [], redoStack: [], tourHistory: null, activeGroupIndex: 0 })
})

describe('AI Organize apply — real IndexedDB + sync', () => {
  it('persists every selected action in one write and one undo step; URL rules follow the merge', async () => {
    await seed()
    const result = await mount()
    const revBefore = (await getGroupsState()).rev ?? 0

    await act(async () => {
      await result.current.apply.mutateAsync([
        { type: 'merge', sourceGroupId: 'shop', targetGroupId: 'errands' },
        { type: 'rename', groupId: 'errands', newName: 'To do' },
        { type: 'delete', groupId: 'old' },
        { type: 'reorder', groupIds: ['docs', 'errands'] }
      ])
    })

    const state = await getGroupsState()
    expect((state.rev ?? 0) - revBefore).toBe(1) // ONE groups write
    expect(useUIStore.getState().undoStack).toHaveLength(1) // ONE undo step
    const groups = await saved()
    expect(groups.map((g) => [g.id, g.name, !!g.archived])).toEqual([
      ['docs', 'Docs', false],
      ['errands', 'To do', false],
      ['old', 'Old', true]
    ])
    const errands = groups.find((g) => g.id === 'errands') as Group
    expect(errands.windows.flatMap((w) => w.tabs.map((t) => t.title))).toEqual(['e1', 'e2', 's1'])
    expect(errands.pendingSync).toBe(true)
    expect(groups.find((g) => g.id === 'old')?.pendingSync).toBe(true)
    // The reorder is a position change only: the write flags it, the content stamp is untouched
    expect(groups.find((g) => g.id === 'docs')).toMatchObject({ positionDirty: true, updatedAt: 1000 })

    await expect.poll(async () => (await getSetting<UrlRule[]>('urlRules', [])).map((r) => r.groupId)).toEqual(['errands', 'docs'])

    // Undo brings every group back as it was
    await act(async () => {
      await result.current.history.undo()
    })
    expect((await saved()).map((g) => [g.id, g.name, !!g.archived])).toEqual([
      ['shop', 'Shopping', false],
      ['errands', 'Errands', false],
      ['docs', 'Docs', false],
      ['old', 'Old', false]
    ])
  })

  it('a sync deletes the merged-away row and pushes the archive; the next pull resurrects nothing', async () => {
    await seed()
    const result = await mount()

    await act(async () => {
      await result.current.apply.mutateAsync([
        { type: 'merge', sourceGroupId: 'shop', targetGroupId: 'errands' },
        { type: 'delete', groupId: 'old' }
      ])
    })
    await performSync(session)

    expect(fakeRemote.rows.has('shop')).toBe(false)
    expect(fakeRemote.rows.get('old')?.archived).toBe(true)
    expect(fakeRemote.rows.has('errands')).toBe(true)

    // A second cycle (a pull of the server state) keeps the result as applied
    await performSync(session)
    const groups = await saved()
    expect(groups.map((g) => g.id)).toEqual(['errands', 'docs', 'old'])
    expect(groups.find((g) => g.id === 'old')?.archived).toBe(true)
    expect(groups.find((g) => g.id === 'errands')?.windows.flatMap((w) => w.tabs.map((t) => t.title))).toEqual(['e1', 'e2', 's1'])
    expect(groups.every((g) => !g.pendingSync)).toBe(true)
  })

  it('writes nothing when no selected action still applies', async () => {
    await seed()
    const result = await mount()
    const before = await getGroupsState()

    let out: { applied: number } | undefined
    await act(async () => {
      out = await result.current.apply.mutateAsync([
        { type: 'delete', groupId: 'missing' },
        { type: 'delete', groupId: before.available[0].id }
      ])
    })

    expect(out).toEqual({ applied: 0 })
    expect((await getGroupsState()).rev).toBe(before.rev)
    expect(useUIStore.getState().undoStack).toHaveLength(0)
  })
})
