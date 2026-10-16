import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import type { Session } from '@supabase/supabase-js'
import { performSync } from '@/lib/syncEngine'
import { getGroupsState, saveGroup, saveGroupsState, markPositionSynced, setSetting, updateGroupsState } from '@/lib/localDb'
import { onForeignGroupsChange } from '@/lib/foreignChange'
import { createGroup, createNowOpenGroup, createWindow } from '@/lib/utils'
import { forgetHistoryCursor, recordStep } from '@/lib/undoHistory'
import { useUIStore } from '@/stores/uiStore'
import { useUndoRedo } from '@/hooks/useUndoRedo'
import { useUpdateGroupName } from '@/hooks/useGroups'
import type { Group, GroupsState } from '@/lib/types'
import { clearDb } from './dbTestUtils'
import { useExternalGroupsChanges } from '@/hooks/useExternalGroupsChanges'
import { applyUrlRule } from '@/lib/urlRuleEngine'
import { noteTabsOpenedByPopup, resetOwnOpenedTabs } from '@/lib/ownOpenedTabs'
import { fakeRemote, type RemoteRow } from './fakeSupabase'

/**
 * Undo/Redo ordering against REAL IndexedDB (fake-indexeddb, real localDb write queue + lock):
 * every history change happens inside its own write's step of the queue, so Undo, Redo and
 * actions apply in issue order (docs/undo-redo-spec.md §4); only a SAVED-data change can refuse an
 * Undo (§3); and an Undo is a local change that syncs cleanly (no conflict copy, history kept).
 */

vi.mock('@/lib/supabase', async () => {
  const m = await import('./fakeSupabase')
  return { supabase: m.fakeSupabase, isSupabaseConfigured: true }
})
vi.mock('@/lib/encryptionKey', () => ({
  getEncryptionKeyState: vi.fn(async () => 'present'),
  getDataKey: vi.fn(async () => (await import('./testEncryption')).testDataKey()),
}))
vi.mock('@/lib/toast', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))

import { toast } from '@/lib/toast'

const session = { user: { id: 'user-1' } } as unknown as Session
const BASE = '2030-01-01T00:00:00.000Z'
const tab = (title: string) => ({ id: 0, title, url: `https://example.com/${title}`, savedAt: 1 })
const rowOf = (g: Group, position: number): RemoteRow => ({
  id: g.id, user_id: 'user-1', name: g.name, color: g.color, updated_at: BASE,
  windows: g.windows, starred: false, archived: false, note: null, info: g.info ?? '', position,
})

/** A device whose two saved groups are in sync with the server. */
async function seed() {
  const nowOpen = { ...createNowOpenGroup(), windows: [{ ...createWindow([{ ...tab('live'), id: 41 }]), id: 7 }] }
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

const names = (s: GroupsState) => s.available.filter((g) => !g.permanent).map((g) => g.name)
const conflictToasts = () => vi.mocked(toast.info).mock.calls.filter(([, o]) => (o as { id?: string } | undefined)?.id === 'undo-conflict')

/** One user action the way every mutation hook writes it: one queued read-modify-write that records its step inside. */
const rename = (id: string, name: string) =>
  updateGroupsState(
    (s) => ({ ...s, available: s.available.map((g) => (g.id === id ? { ...g, name, updatedAt: Date.now(), pendingSync: true } : g)) }),
    { afterWrite: recordStep({ push: (s) => useUIStore.getState().pushUndo(s) }) }
  )

/** What useCurrentTabs does as the user browses: rewrites Now Open only, outside the history. */
const mirrorLiveTabs = (tabId: number) =>
  updateGroupsState((s) => ({
    ...s,
    available: s.available.map((g) => (g.permanent ? { ...g, windows: [{ ...createWindow([{ ...tab(`live${tabId}`), id: tabId }]), id: 7 }] } : g)),
  }))

function mountHistory() {
  const qc = new QueryClient()
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
  return renderHook(() => ({ history: useUndoRedo(), renameHook: useUpdateGroupName() }), { wrapper }).result
}

let foreign: ReturnType<typeof vi.fn<() => void>>
let offForeign: () => void = () => {}

beforeEach(async () => {
  vi.clearAllMocks()
  fakeRemote.reset()
  await clearDb()
  forgetHistoryCursor()
  useUIStore.setState({ undoStack: [], redoStack: [], tourHistory: null })
  foreign = vi.fn<() => void>(() => useUIStore.getState().clearHistory()) // what useSync does
  offForeign = onForeignGroupsChange(foreign)
  await seed()
})

afterEach(() => offForeign())

describe('G1/G2: one write queue, history changes inside the writes', () => {
  it('two quick Undos (the second issued before the first landed) undo two steps with no conflict', async () => {
    const result = mountHistory()
    await rename('work', 'W1')
    await rename('play', 'P1')
    await act(async () => {
      await Promise.all([result.current.history.undo(), result.current.history.undo()])
    })
    expect(names(await getGroupsState())).toEqual(['Work', 'Play'])
    expect(useUIStore.getState().redoStack).toHaveLength(2)
    expect(conflictToasts()).toHaveLength(0)
  })

  it('Undo, Redo, Undo, Redo issued at once apply in order', async () => {
    const result = mountHistory()
    await rename('work', 'W1')
    const { undo, redo } = result.current.history
    await act(async () => {
      await Promise.all([undo(), redo(), undo(), redo()])
    })
    expect(names(await getGroupsState())).toEqual(['W1', 'Play'])
    expect(useUIStore.getState().undoStack).toHaveLength(1)
    expect(conflictToasts()).toHaveLength(0)
  })

  it('an Undo issued while an action is still saving undoes THAT action, and its Redo survives', async () => {
    const result = mountHistory()
    await rename('work', 'W1')
    await act(async () => {
      const action = rename('play', 'P1') // in flight
      const undone = result.current.history.undo()
      await Promise.all([action, undone])
    })
    expect(names(await getGroupsState())).toEqual(['W1', 'Play'])
    expect(useUIStore.getState().undoStack).toHaveLength(1)
    expect(useUIStore.getState().redoStack).toHaveLength(1)
    await act(async () => {
      await result.current.history.redo()
    })
    expect(names(await getGroupsState())).toEqual(['W1', 'P1'])
  })

  it('the real mutation hook: Undo right after the rename call undoes the rename', async () => {
    const result = mountHistory()
    await act(async () => {
      const renamed = result.current.renameHook.mutateAsync({ groupIndex: 1, name: 'Renamed' })
      await new Promise((r) => setTimeout(r, 0)) // (the click on Undo is a later event)
      const undone = result.current.history.undo()
      await Promise.all([renamed, undone])
    })
    expect(names(await getGroupsState())).toEqual(['Work', 'Play'])
    expect(useUIStore.getState().redoStack).toHaveLength(1)
  })
})

describe('G5: only a saved-data change can refuse an Undo', () => {
  it('Now Open writes queued between the action and the Undo, and between two Undos, refuse nothing; the live Now Open is kept', async () => {
    const result = mountHistory()
    await rename('work', 'W1')
    await rename('play', 'P1')
    await mirrorLiveTabs(50)
    await act(async () => {
      const first = result.current.history.undo()
      const mirror = mirrorLiveTabs(51)
      const second = result.current.history.undo()
      await Promise.all([first, mirror, second])
    })
    const s = await getGroupsState()
    expect(conflictToasts()).toHaveLength(0)
    expect(names(s)).toEqual(['Work', 'Play'])
    expect(s.available[0].windows.flatMap((w) => w.tabs.map((t) => t.id))).toEqual([51])
  })

  it('a saved-data change that did not go through the history (another context, before its clear arrives) refuses it', async () => {
    const result = mountHistory()
    await rename('work', 'W1')
    const s = await getGroupsState()
    await saveGroupsState({ ...s, available: s.available.map((g) => (g.id === 'play' ? { ...g, name: 'Elsewhere' } : g)) })
    await act(async () => {
      await result.current.history.undo()
    })
    expect(conflictToasts()).toHaveLength(1)
    expect(names(await getGroupsState())).toEqual(['W1', 'Elsewhere'])
    expect(useUIStore.getState().undoStack).toHaveLength(1)
  })

  it('S1: an action recorded after such a change drops the older steps instead of absorbing it', async () => {
    const result = mountHistory()
    await rename('work', 'W1')
    const s = await getGroupsState()
    await saveGroupsState({ ...s, available: s.available.map((g) => (g.id === 'play' ? { ...g, name: 'Elsewhere' } : g)) })
    await rename('work', 'W2')
    expect(useUIStore.getState().undoStack).toHaveLength(1)
    await act(async () => {
      await result.current.history.undo()
    })
    // the foreign change stays: only W2 was undone
    expect(names(await getGroupsState())).toEqual(['W1', 'Elsewhere'])
  })
})

describe('M1: an Undo is a local change that syncs cleanly', () => {
  it('edit -> sync -> Undo -> sync: the server gets the undone content, no conflict copy, the history is kept', async () => {
    const result = mountHistory()
    await rename('work', 'Edited')
    await performSync(session) // pushed: the server stamps a new updated_at, stored as the base
    const pushedBase = (await getGroupsState()).available.find((g) => g.id === 'work')!.remoteUpdatedAt
    expect(pushedBase).toBeDefined()
    expect(pushedBase).not.toBe(BASE)

    await act(async () => {
      await result.current.history.undo()
    })
    const undone = (await getGroupsState()).available.find((g) => g.id === 'work')!
    expect(undone.name).toBe('Work')
    expect(undone.remoteUpdatedAt).toBe(pushedBase) // the row's current base, not the snapshot's

    await performSync(session)
    const after = await getGroupsState()
    expect(names(after)).toEqual(['Work', 'Play'])
    expect(after.available.some((g) => /conflict copy/i.test(g.name))).toBe(false)
    // the undo was pushed (a successful compare-and-swap on the row's current stamp) and is synced
    expect(fakeRemote.rows.get('work')?.updated_at).not.toBe(pushedBase)
    expect(after.available.find((g) => g.id === 'work')?.pendingSync).toBe(false)
    expect(foreign).not.toHaveBeenCalled()
    expect(useUIStore.getState().redoStack).toHaveLength(1)
  })
})

describe('M1 (clean branch): an Undo leaves a group it does not change exactly as it is now', () => {
  it('rename work, rename play, sync, Undo, sync: work keeps the pushed base, nothing foreign, Redo kept', async () => {
    const result = mountHistory()
    await rename('work', 'W1')
    await rename('play', 'P1')
    await performSync(session) // both pushed: each base is now the stamp the server returned
    const pushedWorkBase = (await getGroupsState()).available.find((g) => g.id === 'work')!.remoteUpdatedAt
    expect(pushedWorkBase).not.toBe(BASE)

    await act(async () => {
      await result.current.history.undo() // takes back the play rename only; work is unchanged by it
    })
    expect((await getGroupsState()).available.find((g) => g.id === 'work')!.remoteUpdatedAt).toBe(pushedWorkBase)

    await performSync(session)
    const after = await getGroupsState()
    expect(after.available.find((g) => g.id === 'work')!.remoteUpdatedAt).toBe(pushedWorkBase)
    expect(names(after)).toEqual(['W1', 'Play'])
    expect(foreign).not.toHaveBeenCalled()
    expect(useUIStore.getState().redoStack).toHaveLength(1)
  })
})

/** Holds the cross-context groups lock: every queued groups step waits until `release()`. */
function holdGroupsLock() {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const locks = (navigator as Navigator & { locks?: LockManager }).locks
  if (locks?.request) {
    void locks.request('tabmerger-groups-write', () => held)
  } else {
    const tail = Symbol.for('tabmerger.groupsLockTail')
    const g = globalThis as unknown as Record<symbol, Promise<unknown> | undefined>
    g[tail] = (g[tail] ?? Promise.resolve()).then(() => held)
  }
  return release
}

describe('S3: a foreign merge drops the history in its own queue step', () => {
  it('an Undo issued while a pull applying another device\'s change is queued is a silent no-op', async () => {
    const result = mountHistory()
    await rename('work', 'W1')
    await performSync(session)
    fakeRemote.serverEdit('play', { name: 'Elsewhere' })

    const release = holdGroupsLock()
    let synced = false
    const sync = performSync(session).then(() => {
      synced = true
    })
    await new Promise((r) => setTimeout(r, 200)) // the pull is answered; its merge waits for the lock
    expect(synced).toBe(false)
    let undone!: Promise<void>
    act(() => {
      undone = result.current.history.undo() // queued behind the merge
    })
    release()
    await act(async () => {
      await Promise.all([sync, undone])
    })
    expect(foreign).toHaveBeenCalledTimes(1)
    expect(conflictToasts()).toHaveLength(0) // the history was already gone: nothing to refuse
    expect(useUIStore.getState().undoStack).toHaveLength(0)
    expect(names(await getGroupsState())).toEqual(['W1', 'Elsewhere'])
  })
})

describe('S2: a URL rule saving a tab this popup opened re-anchors the cursor', () => {
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

  it('the next Undo is not refused for that save, and takes it back together with the action', async () => {
    const result = mountHistory()
    const deliver = popupListening()
    await rename('work', 'W1')
    noteTabsOpenedByPopup([{ id: 610, url: 'https://example.com/ruled' }])
    ;(chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockClear()
    await applyUrlRule({ id: 610, url: 'https://example.com/ruled', title: 'Ruled' } as chrome.tabs.Tab, 'play')
    deliver()
    await act(async () => {
      await result.current.history.undo()
    })
    const s = await getGroupsState()
    expect(conflictToasts()).toHaveLength(0)
    expect(names(s)).toEqual(['Work', 'Play'])
    expect(s.available.find((g) => g.id === 'play')!.windows.flatMap((w) => w.tabs.map((t) => t.title))).not.toContain('Ruled')
  })

  it('R3-1: Now Open writes between the rule write and its message (the live-tab mirror reacts to the same tab events) do not block the re-anchor', async () => {
    const result = mountHistory()
    const deliver = popupListening()
    await rename('work', 'W1')
    noteTabsOpenedByPopup([{ id: 612, url: 'https://example.com/ruled3' }])
    ;(chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockClear()
    await applyUrlRule({ id: 612, url: 'https://example.com/ruled3', title: 'Ruled3' } as chrome.tabs.Tab, 'play')
    const ruleMessage = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]
    await mirrorLiveTabs(612) // status 'complete'
    await mirrorLiveTabs(613) // title / favicon update
    // (this popup's own writes never reach its own listener: deliver only the rule's message)
    ;(chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(undefined)
    ;(chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls.push(ruleMessage)
    deliver()
    await act(async () => {
      await result.current.history.undo()
    })
    expect(conflictToasts()).toHaveLength(0)
    expect(names(await getGroupsState())).toEqual(['Work', 'Play'])
    expect(useUIStore.getState().redoStack).toHaveLength(1)
  })

  it('R3-1 CONTROL: a saved-data change between the rule write and its message blocks the re-anchor (the Undo is refused, safely)', async () => {
    const result = mountHistory()
    const deliver = popupListening()
    await rename('work', 'W1')
    noteTabsOpenedByPopup([{ id: 614, url: 'https://example.com/ruled4' }])
    ;(chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockClear()
    await applyUrlRule({ id: 614, url: 'https://example.com/ruled4', title: 'Ruled4' } as chrome.tabs.Tab, 'play')
    const s = await getGroupsState()
    // another context's saved-data change (its own message not delivered yet)
    await saveGroupsState({ ...s, available: s.available.map((g) => (g.id === 'play' ? { ...g, name: 'Elsewhere' } : g)) })
    const ruleMessage = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]
    ;(chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(undefined)
    ;(chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls.push(ruleMessage)
    deliver()
    await act(async () => {
      await result.current.history.undo()
    })
    expect(conflictToasts()).toHaveLength(1)
    expect(names(await getGroupsState())).toEqual(['W1', 'Elsewhere'])
  })

  it('CONTROL: without the re-anchor (the message not delivered yet) the same Undo is refused, safely', async () => {
    const result = mountHistory()
    await rename('work', 'W1')
    await applyUrlRule({ id: 611, url: 'https://example.com/ruled2', title: 'Ruled2' } as chrome.tabs.Tab, 'play')
    await act(async () => {
      await result.current.history.undo()
    })
    expect(conflictToasts()).toHaveLength(1)
    expect(names(await getGroupsState())).toEqual(['W1', 'Play'])
  })
})

describe('localDb afterWrite (real IndexedDB)', () => {
  it('saveGroupsState hands the hook the stored result and the state it replaced, from its own transaction', async () => {
    const before = await getGroupsState()
    const seen: Array<[GroupsState, GroupsState]> = []
    const next = { ...before, available: before.available.map((g) => (g.id === 'work' ? { ...g, name: 'Hooked' } : g)) }
    const rev = await saveGroupsState(next, { expectedRev: before.rev, afterWrite: (stored, base) => seen.push([stored, base]) })
    expect(seen).toHaveLength(1)
    expect(seen[0][0].rev).toBe(rev)
    expect(names(seen[0][1])).toEqual(['Work', 'Play'])
    expect(seen[0][1].rev).toBe(before.rev)
  })

  it('the replaced state handed to the hook keeps only the oldest Now Open of a legacy store holding two', async () => {
    const before = await getGroupsState()
    await saveGroup({ ...createNowOpenGroup(), id: 'now-dup', updatedAt: Date.now() + 1000 })
    let base: GroupsState | undefined
    await saveGroupsState(before, { afterWrite: (_stored, replaced) => { base = replaced } })
    expect(base!.available.filter((g) => g.permanent).map((g) => g.id)).toEqual([before.available[0].id])
  })

  it('a refused (stale) or skipped write runs no hook; a throwing hook does not fail the stored write', async () => {
    const hook = vi.fn()
    await expect(saveGroupsState(await getGroupsState(), { expectedRev: -1, afterWrite: hook })).rejects.toMatchObject({ name: 'StaleGroupsError' })
    await updateGroupsState(() => null, { afterWrite: hook })
    expect(hook).not.toHaveBeenCalled()

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    // the hook's error is re-thrown on its own (for the global error handler), not into the write
    let rethrow: (() => void) | undefined
    const microtask = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((cb) => {
      rethrow = cb
    })
    try {
      const stored = await updateGroupsState((s) => ({ ...s, available: s.available.map((g) => (g.id === 'play' ? { ...g, name: 'Kept' } : g)) }), {
        afterWrite: () => {
          throw new Error('hook failed')
        }
      })
      expect(names(stored)).toEqual(['Work', 'Kept'])
      expect(names(await getGroupsState())).toEqual(['Work', 'Kept'])
      expect(errors).toHaveBeenCalled()
      expect(rethrow).toThrow('hook failed')
    } finally {
      microtask.mockRestore()
      errors.mockRestore()
    }
  })
})
