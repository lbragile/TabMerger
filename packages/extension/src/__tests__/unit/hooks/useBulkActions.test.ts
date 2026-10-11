/**
 * Branch-coverage batch for useBulkActions.ts targeting specific uncovered conditionals:
 * malformed-id regex fallbacks, cross-group/cross-window comparator tiebreaks, missing-group/
 * missing-window continue guards, permanent-source guards, and the "delete all groups" ?? '' fallback.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useBulkDelete, useBulkMoveToGroup, useBulkStar } from '@/hooks/useBulkActions'
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups'
import { createGroup, createNowOpenGroup } from '@/lib/utils'
import type { GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

vi.mock('@/lib/localDb', async () => (await import('@/__tests__/unit/_helpers/updateGroupsStateMock')).withUpdateGroupsState({
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  getGroupsState: vi.fn(),
  setSetting: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/syncEngine', () => ({ deleteRemoteGroups: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/hooks/useUrlRules', () => ({ deleteRulesForGroupIds: vi.fn().mockResolvedValue(undefined) }))

import { saveGroupsState, getGroupsState } from '@/lib/localDb'
import { deleteRulesForGroupIds } from '@/hooks/useUrlRules'

globalThis.chrome = {
  tabs: { remove: vi.fn().mockResolvedValue(undefined), create: vi.fn().mockResolvedValue(undefined) },
  windows: { create: vi.fn().mockResolvedValue(undefined) },
} as unknown as typeof chrome

function tab(id: number, url: string, title = 'Tab'): Tab {
  return { id, url, title, favIconUrl: '', pinned: false }
}
function win(tabs: Tab[]): ExtWindow {
  return { id: Date.now() + Math.random(), tabs, incognito: false, focused: false }
}
function makeState(groups: GroupsState['available']): GroupsState {
  return { active: { id: groups[0].id, index: 0 }, available: groups }
}
function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  return { qc, wrapper }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(saveGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
})

function lastSaved(): GroupsState {
  const calls = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls
  return calls[calls.length - 1][0] as GroupsState
}

describe('useBulkDelete — malformed ids and cross-group/window comparator branches', () => {
  it('silently ignores tab ids that fail the parser regex', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://a.com')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkDelete(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([{ type: 'tab' as const, id: 'not-a-valid-id' }])
    })

    // Nothing parsed → group untouched, but save still happens with unchanged state
    expect(lastSaved().available[0].windows[0].tabs).toHaveLength(1)
  })

  it('silently ignores window ids that fail the parser regex', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://a.com')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkDelete(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([{ type: 'window' as const, id: 'garbage' }])
    })

    expect(lastSaved().available[0].windows).toHaveLength(1)
  })

  it('silently ignores group ids that fail the parser regex', async () => {
    const group = createGroup('a', 'A')
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkDelete(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([{ type: 'group' as const, id: 'garbage' }])
    })

    expect(lastSaved().available).toHaveLength(1)
  })

  it('cleans up URL rules pointing at bulk-deleted groups', async () => {
    const group = createGroup('a', 'A')
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkDelete(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([{ type: 'group' as const, id: 'group-0' }])
    })

    expect(deleteRulesForGroupIds).toHaveBeenCalledWith(['a'])
  })

  it('sorts tab selections across different groups (groupIndex tiebreak) and same window (tabIndex tiebreak)', async () => {
    const groupA = createGroup('a', 'A')
    groupA.windows = [win([tab(1, 'https://a1.com'), tab(2, 'https://a2.com')])]
    const groupB = createGroup('b', 'B')
    groupB.windows = [win([tab(3, 'https://b.com')])]
    const state = makeState([groupA, groupB])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkDelete(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([
        { type: 'tab' as const, id: 'tab-0-0-0' }, // group A, tabIndex 0
        { type: 'tab' as const, id: 'tab-0-0-1' }, // group A, tabIndex 1 (same group+window, tiebreak)
        { type: 'tab' as const, id: 'tab-1-0-0' }, // group B (different groupIndex tiebreak)
      ])
    })

    const saved = lastSaved()
    expect(saved.available[0].windows[0].tabs).toHaveLength(0)
    expect(saved.available[1].windows[0].tabs).toHaveLength(0)
  })

  it('skips a parsed tab id whose group does not exist, and one whose window does not exist', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://a.com')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkDelete(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([
        { type: 'tab' as const, id: 'tab-9-0-0' }, // group OOB
        { type: 'tab' as const, id: 'tab-0-9-0' }, // window OOB
      ])
    })

    expect(lastSaved().available[0].windows[0].tabs).toHaveLength(1)
  })

  it('sorts window selections across different groups', async () => {
    const groupA = createGroup('a', 'A')
    groupA.windows = [win([tab(1, 'https://a.com')])]
    const groupB = createGroup('b', 'B')
    groupB.windows = [win([tab(2, 'https://b.com')])]
    const state = makeState([groupA, groupB])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkDelete(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([
        { type: 'window' as const, id: 'window-0-0' },
        { type: 'window' as const, id: 'window-1-0' },
      ])
    })

    const saved = lastSaved()
    expect(saved.available[0].windows).toHaveLength(0)
    expect(saved.available[1].windows).toHaveLength(0)
  })

  it('falls back to [] via nullish coalescing when a selected window id has no matching window', async () => {
    const group = createGroup('a', 'A')
    group.windows = []
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkDelete(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([{ type: 'window' as const, id: 'window-0-0' }])
    })

    expect(chrome.tabs.remove).not.toHaveBeenCalled()
  })

  it('skips a parsed window id whose group does not exist', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://a.com')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkDelete(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([{ type: 'window' as const, id: 'window-9-0' }])
    })

    expect(lastSaved().available[0].windows).toHaveLength(1)
  })

  it('skips a parsed group id that does not exist in available', async () => {
    const group = createGroup('a', 'A')
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkDelete(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([{ type: 'group' as const, id: 'group-9' }])
    })

    expect(lastSaved().available).toHaveLength(1)
  })

  it('falls back to empty active id when every group is deleted', async () => {
    const a = createGroup('a', 'A')
    const b = createGroup('b', 'B')
    const state = makeState([a, b])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkDelete(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([
        { type: 'group' as const, id: 'group-0' },
        { type: 'group' as const, id: 'group-1' },
      ])
    })

    const saved = lastSaved()
    expect(saved.available).toHaveLength(0)
    expect(saved.active.id).toBe('')
  })
})

describe('useBulkMoveToGroup — cross-group comparator, permanent-source guard, self-target refresh skip', () => {
  it('sorts tab selections across different groups and same-group/window tabIndex tiebreak', async () => {
    const groupA = createGroup('a', 'A')
    groupA.windows = [win([tab(1, 'https://a1.com'), tab(2, 'https://a2.com')])]
    const groupB = createGroup('b', 'B')
    groupB.windows = [win([tab(3, 'https://b.com')])]
    const target = createGroup('t', 'Target')
    target.windows = []
    const state = makeState([groupA, groupB, target])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        items: [
          { type: 'tab' as const, id: 'tab-0-0-0' },
          { type: 'tab' as const, id: 'tab-0-0-1' },
          { type: 'tab' as const, id: 'tab-1-0-0' },
        ],
        targetGroupIndex: 2,
      })
    })

    const saved = lastSaved()
    const targetTabCount = saved.available[2].windows.reduce((n, w) => n + w.tabs.length, 0)
    expect(targetTabCount).toBe(3)
  })

  it('keeps multiple tabs from the same source window together as one window in the target group', async () => {
    const groupA = createGroup('a', 'A')
    groupA.windows = [win([tab(1, 'https://a1.com'), tab(2, 'https://a2.com'), tab(3, 'https://a3.com')])]
    const target = createGroup('t', 'Target')
    target.windows = []
    const state = makeState([groupA, target])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        items: [
          { type: 'tab' as const, id: 'tab-0-0-0' },
          { type: 'tab' as const, id: 'tab-0-0-2' },
        ],
        targetGroupIndex: 1,
      })
    })

    const saved = lastSaved()
    expect(saved.available[1].windows).toHaveLength(1)
    expect(saved.available[1].windows[0].tabs.map((t) => t.url)).toEqual(['https://a1.com', 'https://a3.com'])
  })

  it('creates separate windows in the target group for tabs from different source windows', async () => {
    const groupA = createGroup('a', 'A')
    groupA.windows = [win([tab(1, 'https://a1.com')])]
    const groupB = createGroup('b', 'B')
    groupB.windows = [win([tab(2, 'https://b1.com')])]
    const target = createGroup('t', 'Target')
    target.windows = []
    const state = makeState([groupA, groupB, target])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        items: [
          { type: 'tab' as const, id: 'tab-0-0-0' },
          { type: 'tab' as const, id: 'tab-1-0-0' },
        ],
        targetGroupIndex: 2,
      })
    })

    const saved = lastSaved()
    expect(saved.available[2].windows).toHaveLength(2)
    expect(saved.available[2].windows.map((w) => w.tabs.map((t) => t.url))).toEqual([
      ['https://a1.com'],
      ['https://b1.com'],
    ])
  })

  it('mixed selection: 2 tabs from window A + 1 tab from window B produces exactly 2 target windows', async () => {
    const groupA = createGroup('a', 'A')
    groupA.windows = [
      win([tab(1, 'https://a1.com'), tab(2, 'https://a2.com')]),
      win([tab(3, 'https://a-win2.com')]),
    ]
    const target = createGroup('t', 'Target')
    target.windows = []
    const state = makeState([groupA, target])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        items: [
          { type: 'tab' as const, id: 'tab-0-0-0' },
          { type: 'tab' as const, id: 'tab-0-0-1' },
          { type: 'tab' as const, id: 'tab-0-1-0' },
        ],
        targetGroupIndex: 1,
      })
    })

    const saved = lastSaved()
    expect(saved.available[1].windows).toHaveLength(2)
    expect(saved.available[1].windows.map((w) => w.tabs.map((t) => t.url))).toEqual([
      ['https://a1.com', 'https://a2.com'],
      ['https://a-win2.com'],
    ])
  })

  it('does not remove tabs from a permanent (Now Open) source group when moving elsewhere', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win([tab(5, 'https://live.com')])]
    const target = createGroup('t', 'Target')
    target.windows = []
    const state = makeState([nowOpen, target])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        items: [{ type: 'tab' as const, id: 'tab-0-0-0' }],
        targetGroupIndex: 1,
      })
    })

    const saved = lastSaved()
    // Now Open source untouched (copy semantics)
    expect(saved.available[0].windows[0].tabs).toHaveLength(1)
    expect(saved.available[1].windows[0].tabs).toHaveLength(1)
  })

  it('skips the source-refresh step when the affected source group is also the target group', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://a.com')]), win([tab(2, 'https://b.com')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        items: [{ type: 'tab' as const, id: 'tab-0-0-0' }],
        targetGroupIndex: 0,
      })
    })

    expect(saveGroupsState).toHaveBeenCalled()
  })

  it('sorts window selections across different groups', async () => {
    const groupA = createGroup('a', 'A')
    groupA.windows = [win([tab(1, 'https://a.com')])]
    const groupB = createGroup('b', 'B')
    groupB.windows = [win([tab(2, 'https://b.com')])]
    const target = createGroup('t', 'Target')
    target.windows = []
    const state = makeState([groupA, groupB, target])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        items: [
          { type: 'window' as const, id: 'window-0-0' },
          { type: 'window' as const, id: 'window-1-0' },
        ],
        targetGroupIndex: 2,
      })
    })

    expect(lastSaved().available[2].windows).toHaveLength(2)
  })

  it('does not remove windows from a permanent (Now Open) source group when moving elsewhere', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win([tab(6, 'https://live.com')])]
    const target = createGroup('t', 'Target')
    target.windows = []
    const state = makeState([nowOpen, target])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        items: [{ type: 'window' as const, id: 'window-0-0' }],
        targetGroupIndex: 1,
      })
    })

    expect(lastSaved().available[0].windows).toHaveLength(1)
  })

  it('skips the window-move source-refresh step when the source group is also the target group', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://a.com')]), win([tab(2, 'https://b.com')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        items: [{ type: 'window' as const, id: 'window-0-0' }],
        targetGroupIndex: 0,
      })
    })

    expect(saveGroupsState).toHaveBeenCalled()
  })
})

/**
 * "Copy to group" from Now Open stores detached saved copies: id 0, no `pinned`, a `savedAt`
 * stamp, and for a window id 0 / unfocused with the window's star kept. Now Open itself keeps
 * its live items, and nothing in the browser is closed or opened.
 */
describe('useBulkMoveToGroup — a Now Open source is stored as detached saved copies', () => {
  it('tabs: the target gets id-0 copies with savedAt and no pinned flag; Now Open keeps the live tabs', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [
      { id: 501, tabs: [{ ...tab(11, 'https://a.com'), pinned: true }, tab(12, 'https://b.com')], incognito: false, focused: true },
      { id: 502, tabs: [tab(13, 'https://c.com')], incognito: false, focused: false },
    ]
    const target = createGroup('t', 'Target')
    target.windows = []
    const state = makeState([nowOpen, target])
    const nowOpenBefore = structuredClone(nowOpen)
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        items: [
          { type: 'tab' as const, id: 'tab-0-0-0' },
          { type: 'tab' as const, id: 'tab-0-0-1' },
          { type: 'tab' as const, id: 'tab-0-1-0' },
        ],
        targetGroupIndex: 1,
      })
    })

    const saved = lastSaved()
    expect(saved.available[0]).toEqual(nowOpenBefore)
    const copies = saved.available[1].windows.flatMap((w) => w.tabs)
    expect(copies.map((t) => t.url)).toEqual(['https://a.com', 'https://b.com', 'https://c.com'])
    expect(copies.every((t) => t.id === 0 && typeof t.savedAt === 'number' && !('pinned' in t))).toBe(true)
    expect(saved.available[1].windows.every((w) => w.focused === false)).toBe(true)
    expect(chrome.tabs.remove).not.toHaveBeenCalled()
    expect(chrome.tabs.create).not.toHaveBeenCalled()
  })

  it('windows: the target gets a detached copy (id 0, unfocused, id-0 tabs) that keeps the star; Now Open keeps the live window', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [
      { id: 501, tabs: [{ ...tab(11, 'https://a.com'), pinned: true }, tab(12, 'https://b.com')], incognito: true, focused: true, starred: true, name: 'live' },
    ]
    const target = createGroup('t', 'Target')
    target.windows = []
    const state = makeState([nowOpen, target])
    const nowOpenBefore = structuredClone(nowOpen)
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        items: [{ type: 'window' as const, id: 'window-0-0' }],
        targetGroupIndex: 1,
      })
    })

    const saved = lastSaved()
    expect(saved.available[0]).toEqual(nowOpenBefore)
    const [copy] = saved.available[1].windows
    expect(copy).toMatchObject({ id: 0, focused: false, starred: true, incognito: true, name: 'live' })
    expect(copy.tabs.map((t) => t.url)).toEqual(['https://a.com', 'https://b.com'])
    expect(copy.tabs.every((t) => t.id === 0 && typeof t.savedAt === 'number' && !('pinned' in t))).toBe(true)
    expect(copy).not.toBe(nowOpen.windows[0])
    expect(chrome.tabs.remove).not.toHaveBeenCalled()
    expect(chrome.windows.create).not.toHaveBeenCalled()
  })

  it('windows: a starred copy lands before the target\'s starred windows, an unstarred copy after them and before its unstarred windows', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [
      { id: 501, tabs: [tab(11, 'https://a.com')], incognito: false, focused: true, starred: true, name: 'live star' },
      { id: 502, tabs: [tab(12, 'https://b.com')], incognito: false, focused: false, name: 'live plain' },
    ]
    const target = createGroup('t', 'Target')
    target.windows = [
      { ...win([{ ...tab(0, 'https://s.com'), savedAt: 5 }]), starred: true, name: 'old star' },
      { ...win([{ ...tab(0, 'https://p.com'), savedAt: 5 }]), name: 'old plain' },
    ]
    const state = makeState([nowOpen, target])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        items: [{ type: 'window' as const, id: 'window-0-0' }, { type: 'window' as const, id: 'window-0-1' }],
        targetGroupIndex: 1,
      })
    })

    const windows = lastSaved().available[1].windows
    expect(windows.map((w) => [w.name, w.starred ?? false])).toEqual([
      ['live star', true],
      ['old star', true],
      ['live plain', false],
      ['old plain', false],
    ])
    const copies = [windows[0], windows[2]]
    expect(copies.every((w) => w.id === 0 && w.focused === false)).toBe(true)
    expect(copies.flatMap((w) => w.tabs).every((t) => t.id === 0 && typeof t.savedAt === 'number' && !('pinned' in t))).toBe(true)
  })

  it('a saved source is moved as it is: its tabs keep their savedAt and the window keeps its star', async () => {
    const source = createGroup('s', 'Source')
    source.windows = [{ ...win([{ ...tab(0, 'https://a.com'), savedAt: 123 }]), starred: true }]
    const target = createGroup('t', 'Target')
    target.windows = []
    const state = makeState([createNowOpenGroup(), source, target])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        items: [{ type: 'window' as const, id: 'window-1-0' }],
        targetGroupIndex: 2,
      })
    })

    const saved = lastSaved()
    expect(saved.available[1].windows).toHaveLength(0)
    expect(saved.available[2].windows[0].starred).toBe(true)
    expect(saved.available[2].windows[0].tabs[0].savedAt).toBe(123)
  })
})

describe('useBulkStar — malformed ids, missing group/window guards, permanent guard', () => {
  it('ignores window items with malformed ids, missing groups, and missing windows', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://a.com')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkStar(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        items: [
          { type: 'window' as const, id: 'garbage' },
          { type: 'window' as const, id: 'window-9-0' }, // group OOB
          { type: 'window' as const, id: 'window-0-9' }, // window OOB
        ],
        starred: true,
      })
    })

    expect(lastSaved().available[0].windows[0].starred).toBeFalsy()
  })

  it('ignores group items with malformed ids and a permanent target', async () => {
    const nowOpen = createNowOpenGroup()
    const state = makeState([nowOpen])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkStar(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        items: [
          { type: 'group' as const, id: 'garbage' },
          { type: 'group' as const, id: 'group-0' }, // permanent → skipped
        ],
        starred: true,
      })
    })

    expect(lastSaved().available[0].starred).toBeFalsy()
  })
})
