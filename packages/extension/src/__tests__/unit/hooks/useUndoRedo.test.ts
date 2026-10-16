/**
 * useUndoRedo against the real uiStore and an in-memory groups store that, like the real one,
 * applies writes one at a time in issue order and runs `afterWrite` inside the write's step.
 * The end-to-end "every action is one step" matrix and the ordering cases are in
 * useGroupsUndo.test.tsx; this file covers the cursor move itself: the buttons, nothing to undo, a
 * refused or failed write, a history cleared mid-write, the tour, remote deletes and live tabs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import type { Group, GroupsState } from '@/lib/types'

const db = vi.hoisted(() => ({ state: null as unknown as GroupsState, rev: 1, failNext: false, beforeStore: null as (() => void) | null }))

vi.mock('@/lib/localDb', () => {
  let tail: Promise<unknown> = Promise.resolve()
  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task)
    tail = run.catch(() => undefined)
    return run
  }
  return {
    updateGroupsState: vi.fn((fn: (s: GroupsState) => GroupsState | null, opts: { afterWrite?: (stored: GroupsState, base: GroupsState) => void } = {}) =>
      enqueue(async () => {
        const base = structuredClone(db.state)
        const next = fn(base)
        if (!next) return base
        db.beforeStore?.()
        if (db.failNext) {
          db.failNext = false
          throw new Error('QuotaExceeded')
        }
        db.rev += 1
        db.state = structuredClone({ ...next, rev: db.rev })
        const stored = structuredClone(db.state)
        opts.afterWrite?.(stored, base)
        return stored
      })
    ),
    setSetting: vi.fn().mockResolvedValue(undefined),
    getSetting: vi.fn().mockResolvedValue({})
  }
})
vi.mock('@/lib/toast', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/syncEngine', () => ({ deleteRemoteGroups: vi.fn().mockResolvedValue(undefined) }))

import { useUndoRedo } from '@/hooks/useUndoRedo'
import { useUIStore } from '@/stores/uiStore'
import { updateGroupsState } from '@/lib/localDb'
import { toast } from '@/lib/toast'
import { deleteRemoteGroups } from '@/lib/syncEngine'
import { forgetHistoryCursor, noteHistoryCursor } from '@/lib/undoHistory'
import { historyEntryEffect, tagHistoryEntry } from '@/lib/undoLiveTabs'
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups'

const g = (id: string, over: Partial<Group> = {}): Group => ({ id, name: id, color: 'rgba(0,0,0,1)', updatedAt: 1, windows: [], ...over })
const state = (...saved: Group[]): GroupsState => ({ active: { id: 'now', index: 0 }, rev: 1, available: [g('now', { permanent: true }), ...saved] })
const names = () => db.state.available.filter((x) => !x.permanent).map((x) => x.name)

let qc: QueryClient
function setup() {
  qc = new QueryClient()
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
  return renderHook(() => useUndoRedo(), { wrapper }).result
}

let chromeStub: { tabs: Record<string, ReturnType<typeof vi.fn>>; windows: Record<string, ReturnType<typeof vi.fn>> }

beforeEach(() => {
  vi.clearAllMocks()
  db.state = state(g('a', { name: 'after' }))
  db.rev = 1
  db.failNext = false
  db.beforeStore = null
  forgetHistoryCursor()
  useUIStore.setState({ undoStack: [], redoStack: [], tourHistory: null, tourActive: false, tourSignals: {} })
  chromeStub = {
    tabs: { get: vi.fn(async (id: number) => ({ id, url: 'https://example.com/x', windowId: 7, index: 0 })), remove: vi.fn().mockResolvedValue(undefined), create: vi.fn(), query: vi.fn().mockResolvedValue([]) },
    windows: { get: vi.fn().mockResolvedValue({ id: 7 }), getCurrent: vi.fn().mockResolvedValue({ id: 99 }), create: vi.fn() }
  }
  vi.stubGlobal('chrome', chromeStub)
})

describe('useUndoRedo: the buttons follow the stacks', () => {
  it('canUndo/canRedo are false when both stacks are empty, true when they hold entries', () => {
    const result = setup()
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
    act(() => useUIStore.setState({ undoStack: [state()], redoStack: [state()] }))
    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(true)
  })
})

describe('useUndoRedo: moving the cursor', () => {
  it('undo restores the top entry, moves it to Redo with the left state as its counterpart, and updates the cache', async () => {
    useUIStore.setState({ undoStack: [state(g('a', { name: 'before' }))] })
    const result = setup()
    await act(async () => { await result.current.undo() })
    expect(names()).toEqual(['before'])
    expect(useUIStore.getState().undoStack).toHaveLength(0)
    expect(useUIStore.getState().redoStack[0].available.find((x) => x.id === 'a')?.name).toBe('after')
    expect(qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)?.rev).toBe(db.rev)
    await act(async () => { await result.current.redo() })
    expect(names()).toEqual(['after'])
    expect(useUIStore.getState().undoStack).toHaveLength(1)
  })

  it('does nothing (no write) when there is nothing to undo or redo', async () => {
    const result = setup()
    await act(async () => {
      await result.current.undo()
      await result.current.redo()
    })
    expect(db.rev).toBe(1)
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('the restore is a new local change: re-stamped and pending', async () => {
    useUIStore.setState({ undoStack: [state(g('a', { name: 'before', updatedAt: 1 }))] })
    const result = setup()
    await act(async () => { await result.current.undo() })
    const a = db.state.available.find((x) => x.id === 'a')!
    expect(a.pendingSync).toBe(true)
    expect(a.updatedAt).toBeGreaterThan(1)
  })

  it('every restore is one step of the write queue (updateGroupsState with an afterWrite hook)', async () => {
    useUIStore.setState({ undoStack: [state(g('a', { name: 'before' }))] })
    const result = setup()
    await act(async () => { await result.current.undo() })
    expect(updateGroupsState).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ afterWrite: expect.any(Function) }))
  })
})

describe('useUndoRedo: refused and failed writes', () => {
  it('a saved-data change outside the history refuses the Undo: toast, no write, the entry stays', async () => {
    useUIStore.setState({ undoStack: [state(g('a', { name: 'before' }))], tourActive: true })
    noteHistoryCursor(state(g('a', { name: 'after' })))
    db.state = state(g('a', { name: 'changed elsewhere' }))
    const result = setup()
    await act(async () => { await result.current.undo() })
    expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/changed elsewhere/i), expect.objectContaining({ id: 'undo-conflict' }))
    expect(names()).toEqual(['changed elsewhere'])
    expect(useUIStore.getState().undoStack).toHaveLength(1)
    expect(useUIStore.getState().tourSignals).toEqual({})
  })

  it('a change to Now Open alone (or to practice groups) is not a conflict, and the current Now Open is kept', async () => {
    useUIStore.setState({ undoStack: [state(g('a', { name: 'before' }))] })
    noteHistoryCursor(state(g('a', { name: 'after' })))
    db.state = {
      ...state(),
      available: [g('now', { permanent: true, windows: [{ id: 3, tabs: [], incognito: false, focused: false }] }), g('a', { name: 'after' }), g('practice', { tourDemo: true })]
    }
    const result = setup()
    await act(async () => { await result.current.undo() })
    expect(toast.info).not.toHaveBeenCalled()
    expect(names()).toEqual(['before', 'practice'])
    expect(db.state.available[0].windows).toHaveLength(1)
  })

  it('a practice Undo during the tour is not refused by a change to the user\'s own groups', async () => {
    db.state = state(g('a', { name: 'changed elsewhere' }), g('practice', { name: 'p-after', tourDemo: true }))
    noteHistoryCursor(state(g('a', { name: 'mine' }), g('practice', { name: 'p-after', tourDemo: true })))
    useUIStore.setState({ undoStack: [state(g('practice', { name: 'p-before', tourDemo: true }))], tourHistory: { undoStack: [], redoStack: [] } })
    const result = setup()
    await act(async () => { await result.current.undo() })
    expect(toast.info).not.toHaveBeenCalled()
    expect(names()).toEqual(['changed elsewhere', 'p-before'])
  })

  it('a failed write changes no history and rejects', async () => {
    const entry = state(g('a', { name: 'before' }))
    useUIStore.setState({ undoStack: [entry] })
    db.failNext = true
    const result = setup()
    await act(async () => {
      await expect(result.current.undo()).rejects.toThrow('QuotaExceeded')
    })
    expect(useUIStore.getState().undoStack).toEqual([entry])
    expect(useUIStore.getState().redoStack).toHaveLength(0)
  })

  it('a history cleared while the write is in flight stays cleared (the restore stands)', async () => {
    useUIStore.setState({ undoStack: [state(g('a', { name: 'before' }))] })
    db.beforeStore = () => useUIStore.getState().clearHistory()
    const result = setup()
    await act(async () => { await result.current.undo() })
    expect(names()).toEqual(['before'])
    expect(useUIStore.getState().undoStack).toHaveLength(0)
    expect(useUIStore.getState().redoStack).toHaveLength(0)
  })
})

describe('useUndoRedo: side effects', () => {
  it('asks for the remote delete of the saved groups the restore removed (never Now Open or practice data)', async () => {
    db.state = state(g('a'), g('added'), g('practice', { tourDemo: true }))
    useUIStore.setState({ undoStack: [state(g('a'))] })
    const result = setup()
    await act(async () => { await result.current.undo() })
    expect(deleteRemoteGroups).toHaveBeenCalledWith(['added'])
  })

  it('tells the tour about an Undo and a Redo that went through', async () => {
    useUIStore.setState({ undoStack: [state(g('a', { name: 'before' }))], tourActive: true })
    const result = setup()
    await act(async () => { await result.current.undo() })
    await act(async () => { await result.current.redo() })
    expect(useUIStore.getState().tourSignals).toEqual({ undo: 1, redo: 1 })
  })

  it('runs the entry effect after the restore and tags the counterpart with its inverse', async () => {
    const entry = state(g('a', { name: 'before' }))
    tagHistoryEntry(entry, { kind: 'close', tabs: [{ tabId: 900, url: 'https://example.com/x' }] })
    useUIStore.setState({ undoStack: [entry] })
    const result = setup()
    await act(async () => { await result.current.undo() })
    expect(chromeStub.tabs.remove).toHaveBeenCalledWith([900])
    const counterpart = useUIStore.getState().redoStack[0]
    await expect(Promise.resolve(historyEntryEffect(counterpart))).resolves.toMatchObject({ kind: 'reopen', tabs: [{ tabId: 900 }] })
  })

  it('an entry with no effect gives its counterpart none', async () => {
    useUIStore.setState({ undoStack: [state(g('a', { name: 'before' }))] })
    const result = setup()
    await act(async () => { await result.current.undo() })
    expect(historyEntryEffect(useUIStore.getState().redoStack[0])).toBeUndefined()
  })

  it('during the tour practice history the restore is practice-only and runs no effect', async () => {
    db.state = state(g('a', { name: 'mine' }), g('practice', { name: 'p-after', tourDemo: true }))
    const entry = state(g('a', { name: 'old' }), g('practice', { name: 'p-before', tourDemo: true }))
    tagHistoryEntry(entry, { kind: 'close', tabs: [{ tabId: 900, url: 'https://example.com/x' }] })
    useUIStore.setState({ undoStack: [entry], tourHistory: { undoStack: [], redoStack: [] } })
    const result = setup()
    await act(async () => { await result.current.undo() })
    expect(names()).toEqual(['mine', 'p-before'])
    expect(chromeStub.tabs.remove).not.toHaveBeenCalled()
    expect(historyEntryEffect(useUIStore.getState().redoStack[0])).toBeUndefined()
  })

  it('an effect that fails leaves the restore in place and gives the counterpart no effect', async () => {
    const entry = state(g('a', { name: 'before' }))
    const failing = Promise.reject(new Error('boom'))
    failing.catch(() => undefined)
    tagHistoryEntry(entry, failing)
    useUIStore.setState({ undoStack: [entry] })
    const result = setup()
    await act(async () => { await result.current.undo() })
    expect(names()).toEqual(['before'])
    await expect(Promise.resolve(historyEntryEffect(useUIStore.getState().redoStack[0]))).resolves.toBeNull()
  })
})
