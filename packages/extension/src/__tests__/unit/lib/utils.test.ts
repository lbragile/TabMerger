import { describe, it, expect } from 'vitest'
import {
  cn,
  createGroup,
  createNowOpenGroup,
  createTab,
  createWindow,
  formatGroupCounts,
  getFaviconUrl,
  getGroupInfo,
  getGroupTabCount,
  parseSearchQuery,
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

  it('builds the service URL from the origin of an https URL', () => {
    expect(getFaviconUrl('https://example.com/a/b?c=1')).toBe(
      'https://s2.googleusercontent.com/s2/favicons?domain_url=https://example.com'
    )
  })

  it.each([
    'about:blank',
    'data:text/html,<p>hi</p>',
    'file:///tmp/page.html',
    'blob:null/1234',
    'chrome-extension://abcdefghijklmnop/popup.html',
    'chrome://settings',
  ])('returns fallback (never domain_url=null) for non-http(s) URL %s', (input) => {
    const result = getFaviconUrl(input)
    expect(result).toBe('https://www.google.com/favicon.ico')
    expect(result).not.toContain('domain_url=null')
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
    expect(getGroupInfo(g)).toBe('2 Windows ◆ 3 Tabs')
  })
})

describe('parseSearchQuery', () => {
  it('returns empty strings for an empty query', () => {
    expect(parseSearchQuery('')).toEqual({ groupFilter: '', windowFilter: '', tagFilter: '', tabQuery: '' })
  })

  it('returns tabQuery only when no prefix token is present', () => {
    expect(parseSearchQuery('github')).toEqual({ groupFilter: '', windowFilter: '', tagFilter: '', tabQuery: 'github' })
  })

  it('returns groupFilter only when query is just a group: token', () => {
    expect(parseSearchQuery('group:work')).toEqual({ groupFilter: 'work', windowFilter: '', tagFilter: '', tabQuery: '' })
  })

  // unquoted value is greedy — consumes to next prefix or end
  it('unquoted group: consumes all remaining words as groupFilter', () => {
    expect(parseSearchQuery('group:work github')).toEqual({ groupFilter: 'work github', windowFilter: '', tagFilter: '', tabQuery: '' })
  })

  it('multi-word unquoted group: value', () => {
    expect(parseSearchQuery('group:My Saved Group')).toEqual({ groupFilter: 'My Saved Group', windowFilter: '', tagFilter: '', tabQuery: '' })
  })

  it('returns windowFilter when query uses window: prefix', () => {
    expect(parseSearchQuery('window:Morning')).toEqual({ groupFilter: '', windowFilter: 'Morning', tagFilter: '', tabQuery: '' })
  })

  it('multi-word unquoted tag: value', () => {
    // ponytail: tag: greedy too — "work research" is the tagFilter, tabQuery empty
    expect(parseSearchQuery('tag:work research')).toEqual({ groupFilter: '', windowFilter: '', tagFilter: 'work research', tabQuery: '' })
  })

  it('quoted group: value with plain text after', () => {
    expect(parseSearchQuery('group:"My Group" open tabs')).toEqual({ groupFilter: 'My Group', windowFilter: '', tagFilter: '', tabQuery: 'open tabs' })
  })

  it('case-insensitive prefix matching', () => {
    expect(parseSearchQuery('GROUP:Work')).toEqual({ groupFilter: 'Work', windowFilter: '', tagFilter: '', tabQuery: '' })
  })

  it('does not treat embedded group: as a prefix', () => {
    expect(parseSearchQuery('xyzgroup:work')).toEqual({ groupFilter: '', windowFilter: '', tagFilter: '', tabQuery: 'xyzgroup:work' })
  })
})

describe('formatGroupCounts', () => {
  it('uses singular for 1 window and 1 tab', () => {
    expect(formatGroupCounts(1, 1)).toBe('1 Window ◆ 1 Tab')
  })

  it('uses plural for counts greater than 1', () => {
    expect(formatGroupCounts(2, 5)).toBe('2 Windows ◆ 5 Tabs')
  })

  it('uses plural for zero counts', () => {
    expect(formatGroupCounts(0, 0)).toBe('0 Windows ◆ 0 Tabs')
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
