import { describe, it, expect } from 'vitest'
import { dedupeMergedWindows, findDuplicateTabs } from '@/lib/deduplication'
import type { Tab } from '@tabmerger/shared'

function makeTab(id: number, url: string, title = 'Tab'): Tab {
  return { id, url, title, pinned: false }
}

/** One window per argument, so a test reads as the group's layout. */
function windows(...tabsPerWindow: Tab[][]): { tabs: Tab[] }[] {
  return tabsPerWindow.map((tabs) => ({ tabs }))
}

describe('findDuplicateTabs', () => {
  it('returns no duplicates when all URLs are unique', () => {
    const result = findDuplicateTabs(
      windows([makeTab(1, 'https://a.com'), makeTab(2, 'https://b.com')], [makeTab(3, 'https://c.com')])
    )
    expect(result).toEqual([])
  })

  it('keeps the first occurrence and lists the rest with their position', () => {
    const second = makeTab(2, 'https://a.com')
    const result = findDuplicateTabs(windows([makeTab(1, 'https://a.com'), second, makeTab(3, 'https://b.com')]))
    expect(result).toEqual([{ windowIndex: 0, tabIndex: 1, tab: second }])
    expect(result[0].tab).toBe(second)
  })

  it('treats tabs with the same URL but different titles as duplicates', () => {
    const result = findDuplicateTabs(
      windows([makeTab(1, 'https://a.com', 'Title A'), makeTab(2, 'https://a.com', 'Title B')])
    )
    expect(result).toHaveLength(1)
  })

  it('finds duplicates across windows, in reading order', () => {
    const result = findDuplicateTabs(
      windows(
        [makeTab(1, 'https://a.com'), makeTab(2, 'https://a.com')],
        [makeTab(3, 'https://b.com'), makeTab(4, 'https://a.com')],
        [makeTab(5, 'https://b.com')]
      )
    )
    expect(result.map(({ windowIndex, tabIndex }) => [windowIndex, tabIndex])).toEqual([
      [0, 1],
      [1, 1],
      [2, 0],
    ])
  })

  it('addresses tabs by position, so tabs that share id 0 are told apart', () => {
    const result = findDuplicateTabs(
      windows([makeTab(0, 'https://a.com'), makeTab(0, 'https://b.com')], [makeTab(0, 'https://c.com'), makeTab(0, 'https://a.com')])
    )
    expect(result.map(({ windowIndex, tabIndex }) => [windowIndex, tabIndex])).toEqual([[1, 1]])
  })

  it('compares URLs case-insensitively after normalisation, and falls back to the raw text for a non-URL', () => {
    const result = findDuplicateTabs(
      windows([
        makeTab(1, 'https://A.com/Path'),
        makeTab(2, 'https://a.com/path'),
        makeTab(3, 'not a url'),
        makeTab(4, 'NOT A URL'),
      ])
    )
    expect(result.map(({ tabIndex }) => tabIndex)).toEqual([1, 3])
  })

  it('returns an empty list for no windows and for empty windows', () => {
    expect(findDuplicateTabs([])).toEqual([])
    expect(findDuplicateTabs(windows([], []))).toEqual([])
  })
})

describe('findDuplicateTabs — tabs without a string url', () => {
  it('does not throw and compares such tabs as an empty address', () => {
    const odd = (url: unknown) => ({ id: 0, title: 'T', url }) as unknown as Tab
    const result = findDuplicateTabs(windows([odd(undefined), makeTab(0, 'https://a.com'), odd(42), odd(null)]))
    expect(result.map(({ tabIndex }) => tabIndex)).toEqual([2, 3])
  })
})

describe('dedupeMergedWindows', () => {
  it('returns both lists untouched (same objects) when nothing repeats', () => {
    const kept = windows([makeTab(0, 'https://a.com')])
    const added = windows([makeTab(0, 'https://b.com')])
    const result = dedupeMergedWindows(kept, added)
    expect(result.kept).toBe(kept)
    expect(result.added).toBe(added)
  })

  it("keeps the group's own tab and drops the incoming copy, matching URLs the way Deduplicate does", () => {
    const own = { ...makeTab(0, 'https://A.com/'), note: 'mine' }
    const kept = windows([own, makeTab(0, 'https://b.com')])
    const added = windows([makeTab(7, 'https://a.com'), makeTab(8, 'https://c.com')])
    const result = dedupeMergedWindows(kept, added)
    expect(result.kept[0]).toBe(kept[0])
    expect(result.kept[0].tabs[0]).toBe(own)
    expect(result.added.map((w) => w.tabs.map((t) => t.url))).toEqual([['https://c.com']])
  })

  it('also removes repeats inside each side, first in reading order kept', () => {
    const kept = windows([makeTab(0, 'https://a.com'), makeTab(0, 'https://a.com')], [makeTab(0, 'https://b.com')])
    const added = windows([makeTab(0, 'https://c.com'), makeTab(0, 'https://c.com'), makeTab(0, 'https://b.com')])
    const result = dedupeMergedWindows(kept, added)
    expect(result.kept.map((w) => w.tabs.map((t) => t.url))).toEqual([['https://a.com'], ['https://b.com']])
    expect(result.added.map((w) => w.tabs.map((t) => t.url))).toEqual([['https://c.com']])
  })

  it('drops a window that only held duplicates, keeps one that was already empty, and keeps window fields', () => {
    const kept = [{ tabs: [] as Tab[], name: 'empty' }, { tabs: [makeTab(0, 'https://a.com')], name: 'own' }]
    const added = [{ tabs: [makeTab(0, 'https://a.com')], name: 'all dupes' }, { tabs: [makeTab(0, 'https://a.com'), makeTab(0, 'https://d.com')], name: 'mixed', starred: true }]
    const result = dedupeMergedWindows(kept, added)
    expect(result.kept.map((w) => w.name)).toEqual(['empty', 'own'])
    expect(result.added).toEqual([{ tabs: [makeTab(0, 'https://d.com')], name: 'mixed', starred: true }])
  })

  it('works on one list alone (Unite windows)', () => {
    const result = dedupeMergedWindows(windows([makeTab(0, 'https://a.com'), makeTab(0, 'https://b.com'), makeTab(0, 'https://a.com')]))
    expect(result.kept.map((w) => w.tabs.map((t) => t.url))).toEqual([['https://a.com', 'https://b.com']])
    expect(result.added).toEqual([])
  })
})
