import { describe, expect, it } from 'vitest'
import { RECENTLY_CLOSED_CLEAR_DELAY_MS, RECENTLY_CLOSED_LIMITS, RECENTLY_CLOSED_MAX_TITLE_LENGTH, RECENTLY_CLOSED_QUIET_CLOSE_TTL_MS } from '@tabmerger/shared'
import {
  buildEntry,
  cleanClosedTitle,
  cleanFavIconUrl,
  closedTabFromSnapshot,
  isQuietCloseKey,
  isQuietMarkFresh,
  isRecordableUrl,
  isSnapshotChange,
  limitsForPlan,
  nextClearedPurgeAt,
  parseRecentlyClosedEntry,
  planPrune,
  quietCloseTabKey,
  quietCloseWindowKey,
  readRememberClosedTabs,
  skipReason,
  snapshotFromTab,
  type RecentlyClosedEntry,
  type TabSnapshot,
} from '@/lib/recentlyClosed'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date(2026, 10, 13, 12, 0, 0).getTime()

const snap = (over: Partial<TabSnapshot> = {}): TabSnapshot => ({
  url: 'https://example.com/a',
  title: 'A',
  pinned: false,
  windowId: 1,
  incognito: false,
  index: 0,
  ...over,
})

const tabEntry = (id: string, url: string, closedAt: number, over: Partial<RecentlyClosedEntry> = {}): RecentlyClosedEntry => ({
  id,
  closedAt,
  kind: 'tab',
  tabs: [{ url, title: url }],
  ...over,
})

describe('isRecordableUrl', () => {
  it.each([
    ['https://example.com', true],
    ['http://localhost:3000/x', true],
    ['file:///C:/notes.txt', true],
    ['chrome://newtab/', false],
    ['chrome://settings', false],
    ['about:blank', false],
    ['chrome-extension://abc/popup.html', false],
    ['moz-extension://abc/popup.html', false],
    ['edge://settings', false],
    ['view-source:https://example.com', false],
    ['javascript:alert(1)', false],
    ['data:text/html,hi', false],
    ['', false],
    [42, false],
  ])('%s -> %s', (url, expected) => {
    expect(isRecordableUrl(url)).toBe(expected)
  })

  it('refuses a URL over the stored cap (a cut URL would be broken)', () => {
    expect(isRecordableUrl(`https://example.com/${'a'.repeat(5000)}`)).toBe(false)
  })
})

describe('cleaning untrusted text', () => {
  it('strips control and bidi-override characters and collapses whitespace', () => {
    expect(cleanClosedTitle('  Hello\u0000\u202e  world\n\t ')).toBe('Hello world')
  })

  it('falls back for a non-string or empty title', () => {
    expect(cleanClosedTitle(undefined, 'https://x.test')).toBe('https://x.test')
    expect(cleanClosedTitle('\u0007', 'fb')).toBe('fb')
  })

  it('caps the title without leaving half a surrogate pair', () => {
    const long = 'a'.repeat(RECENTLY_CLOSED_MAX_TITLE_LENGTH - 1) + '😀'
    const out = cleanClosedTitle(long)
    expect(out.length).toBe(RECENTLY_CLOSED_MAX_TITLE_LENGTH - 1)
  })

  it('keeps web and data:image favicons, drops script URLs', () => {
    expect(cleanFavIconUrl('https://x.test/f.ico')).toBe('https://x.test/f.ico')
    expect(cleanFavIconUrl('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA')
    expect(cleanFavIconUrl('javascript:alert(1)')).toBeUndefined()
    expect(cleanFavIconUrl('')).toBeUndefined()
  })
})

describe('snapshot cache helpers', () => {
  it('builds a snapshot from a browser tab, with its group', () => {
    const s = snapshotFromTab(
      { id: 5, windowId: 2, index: 3, url: '', pendingUrl: 'https://p.test', title: 'P', pinned: true, incognito: false, groupId: 9 } as chrome.tabs.Tab,
      { title: 'Work', color: 'blue' }
    )
    expect(s).toEqual({ url: 'https://p.test', title: 'P', pinned: true, windowId: 2, incognito: false, index: 3, groupId: 9, tabGroup: { title: 'Work', color: 'blue' } })
  })

  it('returns null for a tab without an id or window', () => {
    expect(snapshotFromTab({ windowId: 1 } as chrome.tabs.Tab)).toBeNull()
  })

  it('counts only real changes, never status', () => {
    expect(isSnapshotChange({ status: 'loading' })).toBe(false)
    expect(isSnapshotChange({ title: 'x' })).toBe(true)
    expect(isSnapshotChange({ groupId: 3 })).toBe(true)
    expect(isSnapshotChange({ pinned: false })).toBe(true)
  })

  it('turns a snapshot into a cleaned stored tab', () => {
    expect(closedTabFromSnapshot(snap({ title: ' T\u0000 ', pinned: true, tabGroup: { title: 'G', color: 'red' } }))).toEqual({
      url: 'https://example.com/a',
      title: 'T',
      pinned: true,
      tabGroup: { title: 'G', color: 'red' },
    })
    expect(closedTabFromSnapshot(snap({ url: 'chrome://newtab' }))).toBeNull()
  })
})

describe('skip rules', () => {
  it.each([
    [{ enabled: false, snapshot: snap(), quiet: false }, 'off'],
    [{ enabled: true, snapshot: undefined, quiet: false }, 'unknown-tab'],
    [{ enabled: true, snapshot: snap({ incognito: true }), quiet: false }, 'incognito'],
    [{ enabled: true, snapshot: snap({ url: 'about:blank' }), quiet: false }, 'not-recordable'],
    [{ enabled: true, snapshot: snap(), quiet: true }, 'quiet'],
    [{ enabled: true, snapshot: snap(), quiet: false }, null],
  ] as const)('%o -> %s', (input, expected) => {
    expect(skipReason(input)).toBe(expected)
  })

  it('quiet-close marks expire after 30 s', () => {
    expect(isQuietMarkFresh(NOW - 1000, NOW)).toBe(true)
    expect(isQuietMarkFresh(NOW - RECENTLY_CLOSED_QUIET_CLOSE_TTL_MS, NOW)).toBe(false)
    expect(isQuietMarkFresh('x', NOW)).toBe(false)
    expect(isQuietMarkFresh(NOW + 60_000, NOW)).toBe(false)
  })

  it('quiet keys are per tab and per window', () => {
    expect(quietCloseTabKey(4)).not.toBe(quietCloseWindowKey(4))
    expect(isQuietCloseKey(quietCloseTabKey(4))).toBe(true)
    expect(isQuietCloseKey('tmClosedTabSnapshots')).toBe(false)
  })
})

describe('buildEntry', () => {
  it('one tab -> a tab entry', () => {
    expect(buildEntry([snap()], NOW, 'e1')).toMatchObject({ id: 'e1', kind: 'tab', closedAt: NOW, tabs: [{ url: 'https://example.com/a' }] })
  })

  it('a window keeps its tabs in window order, left-out pages dropped', () => {
    const e = buildEntry(
      [snap({ url: 'https://b.test', index: 2 }), snap({ url: 'chrome://newtab', index: 0 }), snap({ url: 'https://a.test', index: 1 })],
      NOW,
      'w1'
    )
    expect(e?.kind).toBe('window')
    expect(e?.tabs.map((t) => t.url)).toEqual(['https://a.test', 'https://b.test'])
  })

  it('a window with one remaining tab is a tab entry; with none, nothing', () => {
    expect(buildEntry([snap(), snap({ url: 'about:blank', index: 1 })], NOW, 'x')?.kind).toBe('tab')
    expect(buildEntry([snap({ url: 'about:blank' })], NOW, 'x')).toBeNull()
  })
})

describe('planPrune', () => {
  const pro = RECENTLY_CLOSED_LIMITS.pro
  const free = RECENTLY_CLOSED_LIMITS.free

  it('drops an older tab entry with the same normalized URL (newest close wins)', () => {
    const old = tabEntry('old', 'https://Example.com/a', NOW - 1000)
    const other = tabEntry('other', 'https://example.com/b', NOW - 1000)
    const next = tabEntry('new', 'https://example.com/a', NOW)
    expect(planPrune([old, other], next, pro, NOW)).toEqual(['old'])
  })

  it('never dedupes window entries or cleared entries', () => {
    const win: RecentlyClosedEntry = { id: 'w', closedAt: NOW - 10, kind: 'window', tabs: [{ url: 'https://example.com/a', title: 'a' }, { url: 'https://x.test', title: 'x' }] }
    const cleared = tabEntry('c', 'https://example.com/a', NOW - 5, { clearedAt: NOW - 1 })
    expect(planPrune([win, cleared], tabEntry('n', 'https://example.com/a', NOW), pro, NOW)).toEqual([])
  })

  it('prunes by age for the plan', () => {
    const eightDays = tabEntry('8d', 'https://a.test', NOW - 8 * DAY)
    const sixDays = tabEntry('6d', 'https://b.test', NOW - 6 * DAY)
    expect(planPrune([eightDays, sixDays], null, free, NOW)).toEqual(['8d'])
    expect(planPrune([eightDays, sixDays], null, pro, NOW)).toEqual([])
  })

  it('prunes by count, oldest first, never the entry being added', () => {
    const existing = Array.from({ length: free.entries }, (_, i) => tabEntry(`e${i}`, `https://s${i}.test`, NOW - (i + 1) * 1000))
    const next = tabEntry('new', 'https://new.test', NOW)
    expect(planPrune(existing, next, free, NOW)).toEqual([`e${free.entries - 1}`])
    // a wrong clock: the new entry looks oldest but is still kept
    const skewed = tabEntry('skewed', 'https://skew.test', NOW - 365 * DAY + DAY)
    expect(planPrune(existing, skewed, { entries: free.entries, days: 400 }, NOW)).not.toContain('skewed')
  })

  it('an unknown plan uses the Pro limits', () => {
    expect(limitsForPlan('unknown')).toEqual(pro)
    expect(limitsForPlan('pro')).toEqual(pro)
    expect(limitsForPlan('free')).toEqual(free)
  })

  it('deletes cleared entries only once the undo window passed, and does not count them', () => {
    const fresh = tabEntry('fresh', 'https://a.test', NOW - 1000, { clearedAt: NOW - 1000 })
    const due = tabEntry('due', 'https://b.test', NOW - 1000, { clearedAt: NOW - RECENTLY_CLOSED_CLEAR_DELAY_MS })
    expect(planPrune([fresh, due], null, { entries: 0, days: 30 }, NOW)).toEqual(['due'])
    expect(nextClearedPurgeAt([fresh, due, tabEntry('x', 'https://c.test', NOW)])).toBe(NOW - RECENTLY_CLOSED_CLEAR_DELAY_MS + RECENTLY_CLOSED_CLEAR_DELAY_MS)
    expect(nextClearedPurgeAt([tabEntry('x', 'https://c.test', NOW)])).toBeNull()
  })
})

describe('parseRecentlyClosedEntry', () => {
  it('rejects malformed rows', () => {
    expect(parseRecentlyClosedEntry(null)).toBeNull()
    expect(parseRecentlyClosedEntry({ id: 'x', closedAt: 'now', kind: 'tab', tabs: [] })).toBeNull()
    expect(parseRecentlyClosedEntry({ id: 'x', closedAt: 1, kind: 'tab', tabs: [{ url: 'javascript:1' }] })).toBeNull()
  })

  it('cleans tabs and keeps the cleared mark', () => {
    const e = parseRecentlyClosedEntry({ id: 'x', closedAt: 1, kind: 'window', clearedAt: 5, tabs: [{ url: 'https://a.test', title: 'A\u202e', extra: 1 }, { url: 'about:blank' }, { url: 'https://b.test' }] })
    expect(e).toEqual({ id: 'x', closedAt: 1, kind: 'window', clearedAt: 5, tabs: [{ url: 'https://a.test', title: 'A' }, { url: 'https://b.test', title: 'https://b.test' }] })
  })

  it('a window row with one valid tab reads as a tab entry', () => {
    expect(parseRecentlyClosedEntry({ id: 'x', closedAt: 1, kind: 'window', tabs: [{ url: 'https://a.test' }] })?.kind).toBe('tab')
  })
})

describe('readRememberClosedTabs (settings validator)', () => {
  it('is on by default, including settings saved before it existed', () => {
    expect(readRememberClosedTabs(undefined)).toBe(true)
    expect(readRememberClosedTabs(null)).toBe(true)
    expect(readRememberClosedTabs({ theme: 'dark' })).toBe(true)
    expect(readRememberClosedTabs([])).toBe(true)
    expect(readRememberClosedTabs({ rememberClosedTabs: 'no' })).toBe(true)
  })

  it('only an explicit false is off', () => {
    expect(readRememberClosedTabs({ rememberClosedTabs: false })).toBe(false)
  })
})
