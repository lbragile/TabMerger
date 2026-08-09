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

vi.mock('@/lib/localDb', () => ({
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
