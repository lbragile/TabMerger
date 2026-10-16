import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { performSync, subscribeToRemoteChanges } from '@/lib/syncEngine'
import { getGroupsState, saveGroupsState, markPositionSynced, setSetting } from '@/lib/localDb'
import { onForeignGroupsChange } from '@/lib/foreignChange'
import { GROUPS_CHANGED_MESSAGE } from '@/lib/groupsChangedMessage'
import { createGroup, createNowOpenGroup, createWindow } from '@/lib/utils'
import { restoreSnapshotAsLocalChange } from '@/lib/syncDirty'
import { useUIStore } from '@/stores/uiStore'
import type { Group, GroupsState } from '@/lib/types'
import { clearDb } from './dbTestUtils'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useExternalGroupsChanges } from '@/hooks/useExternalGroupsChanges'
import { runSideEffects } from '@/hooks/useDndHandlers'
import { applyUrlRule } from '@/lib/urlRuleEngine'
import { resetOwnOpenedTabs } from '@/lib/ownOpenedTabs'
import { fakeRemote, type RemoteRow } from './fakeSupabase'

/**
 * Does cloud sync wipe the undo history of THIS device's own change? Two paths clear it in the popup:
 *  1. `onForeignGroupsChange` (a pull or a realtime event that APPLIED remote changes);
 *  2. a groups write broadcast (`TM_GROUPS_CHANGED`) from another context, e.g. a SYNC_NOW cycle
 *     run by the service worker.
 * Both must stay silent for the push of our own change, its realtime echo and the pulls after it,
 * and both must still fire for a genuine change made on another device.
 * Real fake-indexeddb + real localDb/syncEngine; only the Supabase edge and the key are faked.
 */

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

const rowOf = (g: Group, position: number): RemoteRow => ({
  id: g.id, user_id: 'user-1', name: g.name, color: g.color, updated_at: BASE,
  windows: g.windows, starred: false, archived: false, note: null, info: g.info ?? '', position,
})
const tab = (title: string) => ({ id: 0, title, url: `https://example.com/${title}`, savedAt: 1 })

/** A device whose saved groups are in sync with the server (base stamp BASE). */
async function seed() {
  const nowOpen = createNowOpenGroup()
  const work = { ...createGroup('work', 'Work'), windows: [createWindow([tab('a1'), tab('a2')])], updatedAt: 1000 }
  const play = { ...createGroup('play', 'Play'), windows: [createWindow([tab('p1')])], updatedAt: 1000 }
  const groups = [work, play].map((g) => ({ ...g, remoteUpdatedAt: BASE, pendingSync: false }))
  await saveGroupsState({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen, ...groups] })
  for (const [i, g] of groups.entries()) {
    await markPositionSynced(g.id, i + 1)
    fakeRemote.rows.set(g.id, rowOf(g, i + 1))
  }
  await setSetting('remoteBaseSeeded', true)
  await setSetting('cloudSyncActive', true)
}

/** The reported action's shape: a tab leaves Work and lands in a NEW window in Play; one undo step. */
async function crossGroupDropIntoNewWindow(): Promise<GroupsState> {
  const before = await getGroupsState()
  useUIStore.getState().pushUndo(before)
  const now = Date.now()
  const available = before.available.map((g) => {
    if (g.id === 'work') return { ...g, windows: [{ ...g.windows[0], tabs: g.windows[0].tabs.slice(1) }], updatedAt: now, pendingSync: true }
    if (g.id === 'play') return { ...g, windows: [...g.windows, createWindow([{ ...tab('a1') }])], updatedAt: now, pendingSync: true }
    return g
  })
  await saveGroupsState({ ...before, available })
  return before
}

const groupsBroadcasts = () =>
  (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls.filter(([m]) => (m as { type?: string })?.type === GROUPS_CHANGED_MESSAGE).length

let foreign: ReturnType<typeof vi.fn<() => void>>
let offForeign: () => void = () => {}

beforeEach(async () => {
  fakeRemote.reset()
  await clearDb()
  useUIStore.setState({ undoStack: [], redoStack: [], tourHistory: null })
  foreign = vi.fn<() => void>(() => useUIStore.getState().clearHistory()) // what useSync does
  offForeign = onForeignGroupsChange(foreign)
  await seed()
  ;(chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockClear()
})

afterEach(() => offForeign())

describe('path 2: onForeignGroupsChange for this device\'s own change', () => {
  it('push -> pull -> next poll: never foreign, the undo step survives', async () => {
    await crossGroupDropIntoNewWindow()
    await performSync(session) // pushes both groups, then pulls them back
    await performSync(session) // the next 30 s poll
    expect(fakeRemote.upserts.map((u) => u.id).sort()).toEqual(['play', 'work'])
    expect(foreign).not.toHaveBeenCalled()
    expect(useUIStore.getState().undoStack).toHaveLength(1)
  })

  it('the realtime echo of each pushed row is ignored: not foreign, the undo step survives', async () => {
    await crossGroupDropIntoNewWindow()
    const onUpdate = vi.fn()
    await subscribeToRemoteChanges(session, onUpdate)
    await performSync(session)
    for (const id of ['work', 'play']) await fakeRemote.realtimeCb!({ eventType: 'UPDATE', new: fakeRemote.rows.get(id) })
    expect(onUpdate).not.toHaveBeenCalled()
    expect(foreign).not.toHaveBeenCalled()
    expect(useUIStore.getState().undoStack).toHaveLength(1)
  })

  it('an echo that arrives while the push is still in flight is ignored too', async () => {
    await crossGroupDropIntoNewWindow()
    await subscribeToRemoteChanges(session, vi.fn())
    const gate = fakeRemote.hold('upsert')
    const sync = performSync(session)
    await gate.entered
    gate.release()
    // the server has the row; its echo can beat markGroupSynced to the queue
    await new Promise((r) => setTimeout(r, 0))
    for (const id of ['work', 'play']) {
      const row = fakeRemote.rows.get(id)
      if (row) await fakeRemote.realtimeCb!({ eventType: 'UPDATE', new: row })
    }
    await sync
    expect(foreign).not.toHaveBeenCalled()
    expect(useUIStore.getState().undoStack).toHaveLength(1)
  })

  it('a reorder (position-only push, the server bumps updated_at) and its echo are not foreign', async () => {
    const s = await getGroupsState()
    useUIStore.getState().pushUndo(s)
    await saveGroupsState({ ...s, available: [s.available[0], s.available[2], s.available[1]] })
    await subscribeToRemoteChanges(session, vi.fn())
    await performSync(session)
    for (const id of ['work', 'play']) await fakeRemote.realtimeCb!({ eventType: 'UPDATE', new: fakeRemote.rows.get(id) })
    await performSync(session)
    expect(foreign).not.toHaveBeenCalled()
    expect(useUIStore.getState().undoStack).toHaveLength(1)
  })

  it('undo, push, echo, pull: the redo step survives as well', async () => {
    const before = await crossGroupDropIntoNewWindow()
    await subscribeToRemoteChanges(session, vi.fn())
    await performSync(session)
    const current = await getGroupsState()
    const snapshot = useUIStore.getState().undo(current)!
    await saveGroupsState(restoreSnapshotAsLocalChange(current, snapshot))
    expect((await getGroupsState()).available.find((g) => g.id === 'work')?.windows[0].tabs).toHaveLength(before.available[1].windows[0].tabs.length)
    await performSync(session)
    for (const id of ['work', 'play']) await fakeRemote.realtimeCb!({ eventType: 'UPDATE', new: fakeRemote.rows.get(id) })
    await performSync(session)
    expect(foreign).not.toHaveBeenCalled()
    expect(useUIStore.getState().redoStack).toHaveLength(1)
  })

  it('CONTROL: an edit made on another device is foreign and clears the history', async () => {
    await crossGroupDropIntoNewWindow()
    await performSync(session)
    fakeRemote.serverEdit('play', { name: 'Renamed elsewhere' })
    await performSync(session)
    expect(foreign).toHaveBeenCalledTimes(1)
    expect(useUIStore.getState().undoStack).toHaveLength(0)
  })
})

describe('path 1: a groups write broadcast from a sync of this device\'s own change', () => {
  it('a sync cycle that only pushes and re-reads our own rows writes nothing that is broadcast (a SYNC_NOW cycle in the worker would not reach the popup)', async () => {
    await crossGroupDropIntoNewWindow()
    ;(chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockClear()
    await performSync(session)
    await performSync(session)
    expect(groupsBroadcasts()).toBe(0)
  })

  it('a reorder cycle (position-only push, then the pull) is not broadcast either', async () => {
    const s = await getGroupsState()
    await saveGroupsState({ ...s, available: [s.available[0], s.available[2], s.available[1]] })
    ;(chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockClear()
    await performSync(session)
    await performSync(session)
    expect(groupsBroadcasts()).toBe(0)
  })

  it('CONTROL: a pull that applies another device\'s change IS broadcast', async () => {
    fakeRemote.serverEdit('play', { name: 'Renamed elsewhere' })
    await performSync(session)
    expect(groupsBroadcasts()).toBe(1)
  })
})

describe('path 1: the service worker saving a tab by URL rule (real IndexedDB)', () => {
  /** Mount the popup's listener and hand it every groups broadcast the write sends. */
  function popupListening() {
    const listeners: Array<(m: unknown) => void> = []
    const runtime = chrome.runtime as unknown as Record<string, unknown>
    runtime.onMessage = { addListener: (l: (m: unknown) => void) => listeners.push(l), removeListener: vi.fn() }
    const qc = new QueryClient()
    renderHook(() => useExternalGroupsChanges(), { wrapper: ({ children }) => React.createElement(QueryClientProvider, { client: qc }, children) })
    return () => {
      for (const [m] of (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls) listeners.forEach((l) => l(m))
    }
  }

  beforeEach(() => resetOwnOpenedTabs())

  it('a rule saving a tab THIS popup opened (a drop into Now Open) keeps the undo step; the write is stored and broadcast with its cause', async () => {
    const before = await getGroupsState()
    useUIStore.getState().pushUndo(before)
    ;(chrome.tabs.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 610 })
    const deliver = popupListening()
    await runSideEffects([{ type: 'tabs.create', windowId: 1, url: 'https://example.com/ruled', active: false }])
    ;(chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockClear()

    await applyUrlRule({ id: 610, url: 'https://example.com/ruled', title: 'Ruled' } as chrome.tabs.Tab, 'work')
    expect((await getGroupsState()).available.find((g) => g.id === 'work')?.windows[0].tabs.map((t) => t.title)).toContain('Ruled')
    expect((chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({ type: GROUPS_CHANGED_MESSAGE, cause: { kind: 'url-rule', tabId: 610, url: 'https://example.com/ruled' }, saved: expect.any(String) })
    deliver()
    expect(useUIStore.getState().undoStack).toHaveLength(1)
  })

  it('a rule capturing the popup-opened tab LONG after the action (or after it navigated) clears the history', async () => {
    useUIStore.getState().pushUndo(await getGroupsState())
    ;(chrome.tabs.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 611 }).mockResolvedValueOnce({ id: 612 })
    const deliver = popupListening()
    const t0 = Date.now()
    await runSideEffects([
      { type: 'tabs.create', windowId: 1, url: 'https://example.com/late', active: false },
      { type: 'tabs.create', windowId: 1, url: 'https://example.com/moved', active: false }
    ])
    ;(chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockClear()
    // the second tab was navigated before the rule saw it
    await applyUrlRule({ id: 612, url: 'https://example.com/elsewhere', title: 'Elsewhere' } as chrome.tabs.Tab, 'work')
    deliver()
    expect(useUIStore.getState().undoStack).toHaveLength(0)

    useUIStore.getState().pushUndo(await getGroupsState())
    ;(chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockClear()
    const spy = vi.spyOn(Date, 'now').mockReturnValue(t0 + 11 * 60_000) // minutes later
    try {
      await applyUrlRule({ id: 611, url: 'https://example.com/late', title: 'Late' } as chrome.tabs.Tab, 'work')
    } finally {
      spy.mockRestore()
    }
    const late = vi.spyOn(Date, 'now').mockReturnValue(t0 + 11 * 60_000)
    try {
      deliver()
    } finally {
      late.mockRestore()
    }
    expect(useUIStore.getState().undoStack).toHaveLength(0)
  })

  it('CONTROL: a rule saving a tab the popup did not open is a change made elsewhere: the history is cleared', async () => {
    useUIStore.getState().pushUndo(await getGroupsState())
    const deliver = popupListening()
    ;(chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockClear()
    await applyUrlRule({ id: 999, url: 'https://example.com/other', title: 'Other' } as chrome.tabs.Tab, 'work')
    deliver()
    expect(useUIStore.getState().undoStack).toHaveLength(0)
  })

  it('every other groups write is broadcast without a cause (and clears an open popup history as before)', async () => {
    useUIStore.getState().pushUndo(await getGroupsState())
    const deliver = popupListening()
    ;(chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockClear()
    const s = await getGroupsState()
    await saveGroupsState({ ...s, available: s.available.map((g) => (g.id === 'play' ? { ...g, name: 'P' } : g)) })
    expect((chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({ type: GROUPS_CHANGED_MESSAGE })
    deliver()
    expect(useUIStore.getState().undoStack).toHaveLength(0)
  })
})
