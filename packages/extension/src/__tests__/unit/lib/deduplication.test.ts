import { describe, it, expect } from 'vitest'
import { findDuplicateTabs } from '@/lib/deduplication'
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
