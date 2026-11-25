/**
 * "Auto-deduplicate on merge" (Settings → General): Merge with current, Unite windows and the
 * banner's Merge groups drop repeated URLs from their result when the setting is on, and leave
 * every tab when it is off. Runs against an in-memory groups store with the real uiStore and the
 * real useUndoRedo, so each merge is checked to stay one write and one undo step.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

const store = vi.hoisted(() => ({ state: null as unknown as GroupsState, rev: 1, settings: {} as Record<string, unknown> | Error }))

vi.mock('@/lib/localDb', () => {
  let tail: Promise<unknown> = Promise.resolve()
  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task)
    tail = run.catch(() => undefined)
    return run
  }
  type UpdateOpts = { afterWrite?: (stored: GroupsState, base: GroupsState) => void }
  return {
    getGroupsState: vi.fn(async () => enqueue(async () => structuredClone(store.state))),
    saveGroupsState: vi.fn((next: GroupsState) =>
      enqueue(async () => {
        store.rev += 1
        store.state = structuredClone({ ...next, rev: store.rev })
        return store.rev
      })
    ),
    updateGroupsState: vi.fn((fn: (s: GroupsState) => GroupsState | null, opts: UpdateOpts = {}) =>
      enqueue(async () => {
        const base = structuredClone(store.state)
        const next = fn(base)
        if (!next) return base
        store.rev += 1
        store.state = structuredClone({ ...next, rev: store.rev })
        opts.afterWrite?.(structuredClone(store.state), base)
        return structuredClone(store.state)
      })
    ),
    setSetting: vi.fn().mockResolvedValue(undefined),
    getSetting: vi.fn(async () => {
      if (store.settings instanceof Error) throw store.settings
      return store.settings
    })
  }
})
vi.mock('@/lib/recentlyClosedDb', () => ({ getRememberClosedTabs: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/syncEngine', () => ({ deleteRemoteGroups: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/hooks/useUrlRules', () => ({
  deleteRulesForGroupIds: vi.fn().mockResolvedValue(undefined),
  retargetRulesToGroup: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/lib/toast', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))

import * as G from '@/hooks/useGroups'
import { APP_SETTINGS_QUERY_KEY, DEFAULT_APP_SETTINGS } from '@/hooks/useAppSettings'
import { useUndoRedo } from '@/hooks/useUndoRedo'
import { useUIStore } from '@/stores/uiStore'
import { forgetHistoryCursor } from '@/lib/undoHistory'

const tab = (path: string, over: Partial<Tab> = {}): Tab => ({ id: 0, title: path, url: `https://example.com/${path}`, savedAt: 1, ...over })
const live = (id: number, path: string): Tab => ({ id, title: path, url: `https://example.com/${path}` })
const win = (tabs: Tab[], over: Partial<ExtWindow> = {}): ExtWindow => ({ id: 0, tabs, incognito: false, focused: false, starred: false, ...over })
const group = (id: string, windows: ExtWindow[], over: Partial<Group> = {}): Group => ({ id, name: id, color: 'rgba(0,0,0,1)', updatedAt: 1, windows, ...over })

function seed(): GroupsState {
  return {
    active: { id: 'now', index: 0 },
    rev: 1,
    available: [
      // Now Open: one tab the saved group "a" already has (a1), one it doesn't, and a repeat of that one
      group('now', [win([live(11, 'a1'), live(12, 'new'), live(13, 'new')], { id: 5 })], { permanent: true }),
      group('a', [win([tab('a1', { note: 'keep me' }), tab('a2')], { name: 'A-win' })]),
      group('b', [win([tab('a2'), tab('b1')], { name: 'B-win' }), win([tab('a1')], { name: 'only-dupes' })]),
      group('u', [win([tab('x'), tab('y')], { name: 'U1' }), win([tab('x'), tab('z')], { name: 'U2' })])
    ]
  }
}

const urls = (g: Group) => g.windows.map((w) => w.tabs.map((t) => t.url.replace('https://example.com/', '')))
const byId = (id: string) => store.state.available.find((g) => g.id === id) as Group
const steps = () => useUIStore.getState().undoStack.length

beforeEach(() => {
  vi.clearAllMocks()
  store.state = seed()
  store.rev = 1
  store.settings = {}
  forgetHistoryCursor()
  useUIStore.setState({ undoStack: [], redoStack: [], tourHistory: null, selectedItems: [], selectionMode: false, activeGroupIndex: 1 })
  vi.stubGlobal('chrome', {
    tabs: { query: vi.fn().mockResolvedValue([]), sendMessage: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) },
    windows: { getCurrent: vi.fn().mockResolvedValue({ id: 7 }) },
    runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) },
    storage: { local: { set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) } }
  })
})

/** `dedup`: the cached setting; `undefined` leaves the settings uncached (read from IndexedDB). */
function setup(dedup: boolean | undefined) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  qc.setQueryData(G.GROUPS_QUERY_KEY, structuredClone(store.state))
  if (dedup !== undefined) qc.setQueryData(APP_SETTINGS_QUERY_KEY, { ...DEFAULT_APP_SETTINGS, autoDedupOnMerge: dedup })
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
  return renderHook(
    () => ({
      mergeWithCurrent: G.useMergeWithCurrent(),
      unite: G.useUniteWindows(),
      mergeGroups: G.useMergeGroups(),
      history: useUndoRedo()
    }),
    { wrapper }
  ).result
}

const run = (fn: () => Promise<unknown>) =>
  act(async () => {
    await fn()
  })

describe('Merge with current', () => {
  it('off (the default): every copied tab is added, repeats included', async () => {
    const result = setup(false)
    await run(() => result.current.mergeWithCurrent.mutateAsync(1))
    expect(urls(byId('a'))).toEqual([['a1', 'new', 'new'], ['a1', 'a2']])
  })

  it("on: the group's own tab stays (with its note), the copy and Now Open's own repeat are left out", async () => {
    const result = setup(true)
    await run(() => result.current.mergeWithCurrent.mutateAsync(1))
    const a = byId('a')
    expect(urls(a)).toEqual([['new'], ['a1', 'a2']])
    expect(a.windows[1].tabs[0].note).toBe('keep me')
    expect(a.pendingSync).toBe(true)
  })

  it('on: recounts the group info and never changes Now Open', async () => {
    const result = setup(true)
    const nowOpenBefore = structuredClone(byId('now'))
    await run(() => result.current.mergeWithCurrent.mutateAsync(1))
    expect(byId('a').info).toMatch(/3/)
    expect(byId('now')).toEqual(nowOpenBefore)
  })

  it('on: a Now Open window holding only tabs the group has is not added at all', async () => {
    store.state.available[0] = group('now', [win([live(11, 'a1'), live(14, 'a2')], { id: 5 })], { permanent: true })
    const result = setup(true)
    await run(() => result.current.mergeWithCurrent.mutateAsync(1))
    expect(urls(byId('a'))).toEqual([['a1', 'a2']])
  })

  it('on: is still one undo step, and Undo brings the group back as it was', async () => {
    const result = setup(true)
    const before = structuredClone(byId('a'))
    await run(() => result.current.mergeWithCurrent.mutateAsync(1))
    expect(steps()).toBe(1)
    await run(() => result.current.history.undo())
    expect(urls(byId('a'))).toEqual(urls(before))
  })
})

describe('Unite windows', () => {
  it('off: the united window keeps every tab', async () => {
    const result = setup(false)
    await run(() => result.current.unite.mutateAsync(3))
    expect(urls(byId('u'))).toEqual([['x', 'y', 'x', 'z']])
  })

  it('on: the united window keeps the first tab of each URL, as one undo step', async () => {
    const result = setup(true)
    await run(() => result.current.unite.mutateAsync(3))
    expect(urls(byId('u'))).toEqual([['x', 'y', 'z']])
    expect(byId('u').windows[0].name).toBe('U1')
    expect(steps()).toBe(1)
  })

  it("on: Now Open's tabs are united as before; removing one would close a real tab", async () => {
    const result = setup(true)
    await run(() => result.current.unite.mutateAsync(0))
    expect(urls(byId('now'))).toEqual([['a1', 'new', 'new']])
    expect(chrome.tabs.remove).not.toHaveBeenCalled()
  })
})

describe('Merge groups (AI banner)', () => {
  it('off: the merged group holds every tab of both', async () => {
    const result = setup(false)
    await run(() => result.current.mergeGroups.mutateAsync(['a', 'b']))
    expect(urls(byId('a'))).toEqual([['a1', 'a2'], ['a2', 'b1'], ['a1']])
  })

  it("on: the target's tabs stay; the source's repeats go, and a window of only repeats goes with them", async () => {
    const result = setup(true)
    await run(() => result.current.mergeGroups.mutateAsync(['a', 'b']))
    expect(urls(byId('a'))).toEqual([['a1', 'a2'], ['b1']])
    expect(byId('a').windows.map((w) => w.name)).toEqual(['A-win', 'B-win'])
    expect(store.state.available.map((g) => g.id)).toEqual(['now', 'a', 'u'])
    expect(steps()).toBe(1)
  })
})

describe('reading the setting', () => {
  it('reads it from IndexedDB when the popup has not cached the settings yet', async () => {
    store.settings = { ...DEFAULT_APP_SETTINGS, autoDedupOnMerge: true }
    const result = setup(undefined)
    await run(() => result.current.unite.mutateAsync(3))
    expect(urls(byId('u'))).toEqual([['x', 'y', 'z']])
  })

  it('treats a failed settings read as off: the merge still happens, nothing is removed', async () => {
    store.settings = new Error('IDB closed')
    const result = setup(undefined)
    await run(() => result.current.unite.mutateAsync(3))
    expect(urls(byId('u'))).toEqual([['x', 'y', 'x', 'z']])
  })

  it('treats settings saved before the option existed as off', async () => {
    store.settings = { theme: 'dark' }
    const result = setup(undefined)
    await run(() => result.current.unite.mutateAsync(3))
    expect(urls(byId('u'))).toEqual([['x', 'y', 'x', 'z']])
  })
})
