import { describe, it, expect } from 'vitest'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'
import { formatGroupCounts } from '@/lib/utils'
import { applyAiSuggestionsToState, clampAiSuggestionsToSlots, findAiMergeTarget } from '@/lib/aiAutoGroup'

/**
 * Auto-group never makes a second group with a name the sidebar already shows: a suggestion with
 * an existing saved group's name (trimmed, any case) adds its tabs to that group as one new window,
 * minus URLs the group already has. Only new groups count against the Free-tier group slots.
 */

const live = (id: number, url: string): Tab => ({ id, url, title: url, favIconUrl: '', pinned: false })
const savedTab = (url: string): Tab => ({ id: 0, url, title: url, savedAt: 1 })
const win = (tabs: Tab[], over: Partial<ExtWindow> = {}): ExtWindow => ({ id: 1, tabs, incognito: false, focused: false, ...over })
const group = (id: string, name: string, over: Partial<Group> = {}): Group => ({ id, name, color: 'rgba(0,0,0,1)', updatedAt: 1, windows: [], ...over })
const nowOpen = (tabs: Tab[]): Group => group('now', 'Now Open', { permanent: true, windows: [win(tabs)] })
const state = (available: Group[]): GroupsState => ({ active: { id: 'now', index: 0 }, available })
const s = (name: string, tabIds: number[]) => ({ name, color: 'rgba(9,9,9,1)', tabIds })

describe('findAiMergeTarget', () => {
  it('matches trimmed and ignoring case', () => {
    const available = [nowOpen([]), group('a', 'Local Dev')]
    expect(findAiMergeTarget(available, '  local dev ')).toBe(1)
    expect(findAiMergeTarget(available, 'Local')).toBe(-1)
  })

  it('never matches Now Open, a permanent, archived or guided-tour group, or a blank name', () => {
    const available = [
      nowOpen([]),
      group('p', 'Pinned', { permanent: true }),
      group('ar', 'Old', { archived: true }),
      group('t', 'Practice', { tourDemo: true } as Partial<Group>),
      group('blank', ' '),
    ]
    for (const name of ['Now Open', 'Pinned', 'Old', 'Practice', '  ']) expect(findAiMergeTarget(available, name)).toBe(-1)
  })

  it('with several matches, takes the first in sidebar order (starred groups first)', () => {
    const available = [nowOpen([]), group('a', 'News'), group('b', 'news', { starred: true }), group('c', 'NEWS')]
    expect(findAiMergeTarget(available, 'News')).toBe(2)
    expect(findAiMergeTarget([nowOpen([]), group('a', 'News'), group('c', 'NEWS')], 'news')).toBe(1)
  })
})

describe('applyAiSuggestionsToState', () => {
  it('adds the tabs to the same-named group as one new window, in a different case', () => {
    const yt = group('yt', 'YouTube', { windows: [win([savedTab('https://yt.com/1')], { starred: true })] })
    const prev = state([nowOpen([live(11, 'https://yt.com/2'), live(12, 'https://yt.com/3')]), yt])
    const result = applyAiSuggestionsToState(prev, [s('youtube', [11, 12])])

    expect(result).toMatchObject({ createdGroups: 0, mergedGroups: 1, appliedTabs: 2 })
    expect(result.nextAvailable).toHaveLength(2)
    const merged = result.nextAvailable[1]
    expect(merged.id).toBe('yt')
    expect(merged.name).toBe('YouTube') // the existing name and colour are kept
    expect(merged.windows).toHaveLength(2)
    expect(merged.windows[0].starred).toBe(true) // starred window stays on top
    expect(merged.windows[1].tabs.map((t) => [t.id, t.url])).toEqual([[0, 'https://yt.com/2'], [0, 'https://yt.com/3']])
    expect(merged.pendingSync).toBe(true)
    expect(merged.updatedAt).toBeGreaterThan(1)
    expect(merged.info).toBe(formatGroupCounts(2, 3))
  })

  it('skips a tab whose URL the group already has, and the tab still leaves Now Open', () => {
    const yt = group('yt', 'YouTube', { windows: [win([savedTab('https://yt.com/1')])] })
    const prev = state([nowOpen([live(11, 'https://yt.com/1'), live(12, 'https://yt.com/2'), live(13, 'https://yt.com/2')]), yt])
    const result = applyAiSuggestionsToState(prev, [s('YouTube', [11, 12, 13])])

    expect(result).toMatchObject({ createdGroups: 0, mergedGroups: 1, appliedTabs: 1 })
    expect(result.nextAvailable[1].windows[1].tabs.map((t) => t.url)).toEqual(['https://yt.com/2'])
    expect(result.nextAvailable[0].windows).toHaveLength(1)
    expect(result.nextAvailable[0].windows[0].tabs).toHaveLength(0)
  })

  it('leaves the group untouched when every tab is already in it, but still counts it as the target', () => {
    const yt = group('yt', 'YouTube', { windows: [win([savedTab('https://yt.com/1')])] })
    const prev = state([nowOpen([live(11, 'https://yt.com/1'), live(20, 'https://other.com')]), yt])
    const result = applyAiSuggestionsToState(prev, [s('YouTube', [11])])

    expect(result).toMatchObject({ createdGroups: 0, mergedGroups: 1, appliedTabs: 0 })
    expect(result.nextAvailable[1]).toBe(yt)
    expect(result.nextAvailable[0].windows[0].tabs.map((t) => t.id)).toEqual([20])
  })

  it('makes a new group, never merging into an archived or permanent group of that name', () => {
    const prev = state([
      nowOpen([live(11, 'https://a.com'), live(12, 'https://b.com')]),
      group('ar', 'Reddit', { archived: true }),
      group('p', 'Work', { permanent: true }),
    ])
    const result = applyAiSuggestionsToState(prev, [s('Reddit', [11]), s('Work', [12])])

    expect(result).toMatchObject({ createdGroups: 2, mergedGroups: 0, appliedTabs: 2 })
    expect(result.nextAvailable.slice(3).map((g) => g.name)).toEqual(['Reddit', 'Work'])
    expect(result.nextAvailable[1].windows).toHaveLength(0)
    expect(result.nextAvailable[2].windows).toHaveLength(0)
  })

  it('collapses two same-named suggestions in one reply into one new group with one window', () => {
    const prev = state([nowOpen([live(11, 'https://a.com'), live(12, 'https://b.com'), live(13, 'https://a.com')])])
    const result = applyAiSuggestionsToState(prev, [s('Local Dev', [11]), s(' local dev', [12, 13])])

    expect(result).toMatchObject({ createdGroups: 1, mergedGroups: 0, appliedTabs: 2 })
    expect(result.nextAvailable).toHaveLength(2)
    const created = result.nextAvailable[1]
    expect(created.name).toBe('Local Dev')
    expect(created.windows).toHaveLength(1)
    expect(created.windows[0].tabs.map((t) => t.url)).toEqual(['https://a.com', 'https://b.com'])
    expect(created.info).toBe(formatGroupCounts(1, 2))
  })

  it('collapses two suggestions naming the same existing group into one new window there', () => {
    const prev = state([nowOpen([live(11, 'https://a.com'), live(12, 'https://b.com')]), group('r', 'Reddit', { windows: [win([savedTab('https://x.com')])] })])
    const result = applyAiSuggestionsToState(prev, [s('reddit', [11]), s('REDDIT', [12])])

    expect(result).toMatchObject({ createdGroups: 0, mergedGroups: 1, appliedTabs: 2 })
    expect(result.nextAvailable[1].windows).toHaveLength(2)
    expect(result.nextAvailable[1].windows[1].tabs.map((t) => t.url)).toEqual(['https://a.com', 'https://b.com'])
  })

  it('a brand-new group keeps every tab of its first suggestion, as before', () => {
    const prev = state([nowOpen([live(11, 'https://a.com'), live(12, 'https://a.com')])])
    const result = applyAiSuggestionsToState(prev, [s('New', [11, 12])])
    expect(result.nextAvailable[1].windows[0].tabs).toHaveLength(2)
    expect(result.appliedTabs).toBe(2)
  })

  it('counts new and merged groups separately, and ignores suggestions with no live tab', () => {
    const prev = state([
      nowOpen([live(11, 'https://1.com'), live(12, 'https://2.com'), live(13, 'https://3.com')]),
      group('yt', 'YouTube'),
      group('br', 'Browser'),
    ])
    const result = applyAiSuggestionsToState(prev, [s('YouTube', [11]), s('browser', [12]), s('Shopping', [13]), s('Ghost', [999])])
    expect(result).toMatchObject({ createdGroups: 1, mergedGroups: 2, appliedTabs: 3 })
    expect(result.nextAvailable.map((g) => g.name)).toEqual(['Now Open', 'YouTube', 'Browser', 'Shopping'])
  })

  it('does not change the state it is given', () => {
    const yt = group('yt', 'YouTube', { windows: [win([savedTab('https://yt.com/1')])] })
    const prev = state([nowOpen([live(11, 'https://yt.com/2')]), yt])
    const snapshot = structuredClone(prev)
    applyAiSuggestionsToState(prev, [s('YouTube', [11])])
    expect(prev).toEqual(snapshot)
  })
})

describe('clampAiSuggestionsToSlots', () => {
  const available = [nowOpen([]), group('yt', 'YouTube'), group('ar', 'Archived', { archived: true })]

  it('keeps suggestions that go into an existing group even with no slot left', () => {
    const { kept, skipped } = clampAiSuggestionsToSlots(available, [s('youtube', [1]), s('News', [2])], 0)
    expect(kept.map((k) => k.name)).toEqual(['youtube'])
    expect(skipped).toBe(1)
  })

  it('spends slots only on new groups, and a repeated new name rides on its first slot', () => {
    const { kept, skipped } = clampAiSuggestionsToSlots(
      available,
      [s('News', [1]), s('YouTube', [2]), s('news', [3]), s('Shop', [4]), s('Archived', [5]), s('shop', [6])],
      1
    )
    expect(kept.map((k) => k.name)).toEqual(['News', 'YouTube', 'news'])
    // "Shop" (twice) and "Archived" (an archived group is not a target, so it would be new)
    expect(skipped).toBe(2)
  })

  it('keeps everything with unlimited slots', () => {
    const all = [s('A', [1]), s('B', [2]), s('C', [3])]
    expect(clampAiSuggestionsToSlots(available, all, Infinity)).toEqual({ kept: all, skipped: 0 })
  })
})
