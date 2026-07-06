import { describe, it, expect } from 'vitest'
import {
  cn,
  createGroup,
  createNowOpenGroup,
  createTab,
  createWindow,
  formatGroupCounts,
  fuzzyMatch,
  getFaviconUrl,
  getGroupInfo,
  getGroupTabCount,
  parseSearchQuery,
  pluralize,
  relativeTimeStr,
  sortWindowsByStarred,
} from '@/lib/utils'

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('deduplicates conflicting Tailwind classes (last wins)', () => {
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })

  it('handles falsy values', () => {
    expect(cn('a', false && 'b', undefined, 'c')).toBe('a c')
  })
})

describe('pluralize', () => {
  it('returns singular for 1', () => {
    expect(pluralize(1, 'tab')).toBe('tab')
  })

  it('appends s for other counts', () => {
    expect(pluralize(0, 'tab')).toBe('tabs')
    expect(pluralize(2, 'tab')).toBe('tabs')
  })
})

describe('relativeTimeStr', () => {
  const now = Date.now()
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  const month = 30 * day
  const year = 365 * day

  it('returns < 1 min for very recent', () => {
    expect(relativeTimeStr(now - 30_000, now)).toBe('< 1 min')
  })

  it('formats minutes', () => {
    expect(relativeTimeStr(now - 5 * min, now)).toBe('5 mins')
  })

  it('formats hours', () => {
    expect(relativeTimeStr(now - 3 * hour, now)).toBe('3 hours')
  })

  it('formats days', () => {
    expect(relativeTimeStr(now - 2 * day, now)).toBe('2 days')
  })

  it('formats months', () => {
    expect(relativeTimeStr(now - 3 * month, now)).toBe('3 months')
  })

  it('formats years', () => {
    expect(relativeTimeStr(now - 2 * year, now)).toBe('2 years')
  })

  it('uses singular for 1', () => {
    expect(relativeTimeStr(now - 1 * hour, now)).toBe('1 hour')
  })
})

describe('getFaviconUrl', () => {
  it('returns google favicon service URL for valid URLs', () => {
    const url = getFaviconUrl('https://github.com/some/path')
    expect(url).toContain('s2.googleusercontent.com')
    expect(url).toContain('https://github.com')
  })

  it('returns fallback for invalid URLs', () => {
    expect(getFaviconUrl('not-a-url')).toBe('https://www.google.com/favicon.ico')
  })
})

describe('createGroup', () => {
  it('creates a group with defaults', () => {
    const g = createGroup()
    expect(g.permanent).toBe(false)
    expect(g.windows).toEqual([])
    expect(g.pendingSync).toBe(true)
    expect(g.id).toHaveLength(10)
  })

  it('uses provided id and name', () => {
    const g = createGroup('abc', 'Work')
    expect(g.id).toBe('abc')
    expect(g.name).toBe('Work')
  })
})

describe('createNowOpenGroup', () => {
  it('creates a permanent group', () => {
    const g = createNowOpenGroup()
    expect(g.permanent).toBe(true)
    expect(g.pendingSync).toBe(false)
    expect(g.name).toBe('Now Open')
  })
})

describe('createTab', () => {
  it('creates a tab with defaults', () => {
    const t = createTab()
    expect(t.pinned).toBe(false)
    expect(t.url).toBe('https://www.google.com')
  })
})

describe('getGroupTabCount', () => {
  it('sums tabs across all windows', () => {
    const g = createGroup()
    g.windows = [
      createWindow([createTab(), createTab()]),
      createWindow([createTab()]),
    ]
    expect(getGroupTabCount(g)).toBe(3)
  })

  it('returns 0 for empty group', () => {
    expect(getGroupTabCount(createGroup())).toBe(0)
  })
})

describe('getGroupInfo', () => {
  it('formats tab and window counts', () => {
    const g = createGroup()
    g.windows = [createWindow([createTab(), createTab()]), createWindow([createTab()])]
    expect(getGroupInfo(g)).toBe('2 Windows | 3 Tabs')
  })
})

describe('parseSearchQuery', () => {
  it('returns empty strings for an empty query', () => {
    expect(parseSearchQuery('')).toEqual({ groupFilter: '', tagFilter: '', tabQuery: '' })
  })

  it('returns tabQuery only when no prefix token is present', () => {
    expect(parseSearchQuery('github')).toEqual({ groupFilter: '', tagFilter: '', tabQuery: 'github' })
  })

  it('returns groupFilter only when query is just an in: token', () => {
    expect(parseSearchQuery('in:work')).toEqual({ groupFilter: 'work', tagFilter: '', tabQuery: '' })
  })

  // unquoted value is greedy — consumes to next prefix or end
  it('unquoted in: consumes all remaining words as groupFilter', () => {
    expect(parseSearchQuery('in:work github')).toEqual({ groupFilter: 'work github', tagFilter: '', tabQuery: '' })
  })

  it('multi-word unquoted in: value', () => {
    expect(parseSearchQuery('in:My Saved Group')).toEqual({ groupFilter: 'My Saved Group', tagFilter: '', tabQuery: '' })
  })

  it('multi-word unquoted tag: value', () => {
    // ponytail: tag: greedy too — "work research" is the tagFilter, tabQuery empty
    expect(parseSearchQuery('tag:work research')).toEqual({ groupFilter: '', tagFilter: 'work research', tabQuery: '' })
  })

  it('quoted in: value with plain text after', () => {
    expect(parseSearchQuery('in:"My Group" open tabs')).toEqual({ groupFilter: 'My Group', tagFilter: '', tabQuery: 'open tabs' })
  })

  it('case-insensitive prefix matching', () => {
    expect(parseSearchQuery('IN:Work')).toEqual({ groupFilter: 'Work', tagFilter: '', tabQuery: '' })
  })

  it('does not treat embedded in: as a prefix', () => {
    expect(parseSearchQuery('xyzin:work')).toEqual({ groupFilter: '', tagFilter: '', tabQuery: 'xyzin:work' })
  })
})

describe('fuzzyMatch', () => {
  it('matches when all query chars appear in order', () => {
    expect(fuzzyMatch('Linear — Project Board', 'lnear')).toBe(true)
  })

  it('rejects out-of-order characters', () => {
    expect(fuzzyMatch('Work', 'Wrok')).toBe(false)
  })

  it('matches subsequence across gaps', () => {
    expect(fuzzyMatch('GitHub', 'ghb')).toBe(true)
  })

  it('returns true for empty query', () => {
    expect(fuzzyMatch('anything', '')).toBe(true)
  })

  it('returns false when query is longer than text', () => {
    expect(fuzzyMatch('hi', 'hello')).toBe(false)
  })
})

describe('formatGroupCounts', () => {
  it('uses singular for 1 window and 1 tab', () => {
    expect(formatGroupCounts(1, 1)).toBe('1 Window | 1 Tab')
  })

  it('uses plural for counts greater than 1', () => {
    expect(formatGroupCounts(2, 5)).toBe('2 Windows | 5 Tabs')
  })

  it('uses plural for zero counts', () => {
    expect(formatGroupCounts(0, 0)).toBe('0 Windows | 0 Tabs')
  })
})

describe('sortWindowsByStarred', () => {
  it('puts starred windows first', () => {
    const w1 = createWindow([], 'Window', false, false)
    const w2 = createWindow([], 'Window', false, true)
    const w3 = createWindow([], 'Window', false, false)
    const sorted = sortWindowsByStarred([w1, w2, w3])
    expect(sorted[0].starred).toBe(true)
  })

  it('preserves relative order within each group', () => {
    const starred1 = createWindow([], 'A', false, true)
    const starred2 = createWindow([], 'B', false, true)
    const unstarred = createWindow([], 'C', false, false)
    const sorted = sortWindowsByStarred([unstarred, starred1, starred2])
    expect(sorted[0]).toBe(starred1)
    expect(sorted[1]).toBe(starred2)
  })
})
