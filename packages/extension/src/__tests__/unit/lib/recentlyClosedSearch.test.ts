import { describe, expect, it } from 'vitest'
import { CLOSED_RESULTS_UNDER_SAVED, closedWhenLabel, searchRecentlyClosed } from '@/lib/recentlyClosedSearch'
import type { RecentlyClosedEntry } from '@/lib/recentlyClosed'
import { parseSearchQuery } from '@/lib/utils'

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime()

const tab = (id: string, closedAt: number, title: string, url = `https://${id}.test/page`, over: Partial<RecentlyClosedEntry> = {}): RecentlyClosedEntry => ({
  id,
  closedAt,
  kind: 'tab',
  tabs: [{ url, title }],
  ...over,
})
const win = (id: string, closedAt: number, tabs: Array<{ title: string; url: string }>): RecentlyClosedEntry => ({ id, closedAt, kind: 'window', tabs })

const ids = (q: string, entries: RecentlyClosedEntry[], limit = CLOSED_RESULTS_UNDER_SAVED) =>
  searchRecentlyClosed(entries, parseSearchQuery(q), limit).map((r) => r.entry.id)

describe('searchRecentlyClosed', () => {
  const now = at(2026, 11, 13, 15)

  it('ranks best match first (exact, prefix, word start, anywhere), newest first within a rank', () => {
    const entries = [
      tab('anywhere', now - 1, 'Unstripey'),
      tab('word', now - 2, 'Pay with Stripe now'),
      tab('prefix-new', now - 3, 'Stripe dashboard'),
      tab('prefix-old', now - 4, 'Stripe docs'),
      tab('exact', now - 5, 'stripe'),
    ]
    expect(ids('stripe', entries, 12)).toEqual(['exact', 'prefix-new', 'prefix-old', 'word', 'anywhere'])
  })

  it('cuts to the limit (3 under the saved results)', () => {
    const entries = Array.from({ length: 6 }, (_, i) => tab(`t${i}`, now - i, `Docs ${i}`))
    expect(ids('docs', entries)).toEqual(['t0', 't1', 't2'])
    expect(CLOSED_RESULTS_UNDER_SAVED).toBe(3)
  })

  it('matches the address too', () => {
    expect(ids('example.org', [tab('a', now, 'Home', 'https://example.org/x'), tab('b', now, 'Other')])).toEqual(['a'])
  })

  it('matches contiguously only (never letters picked out one by one)', () => {
    expect(ids('sre', [tab('a', now, 'Stripe')])).toEqual([])
  })

  it('a window entry is one result: its best matching tab, flagged as from a window', () => {
    const w = win('w', now, [
      { title: 'Mail', url: 'https://mail.test' },
      { title: 'Pay with stripe', url: 'https://pay.test' },
      { title: 'Stripe', url: 'https://stripe.test' },
    ])
    const [r, ...rest] = searchRecentlyClosed([w], parseSearchQuery('stripe'), 3)
    expect(rest).toEqual([])
    expect(r).toMatchObject({ tabIndex: 2, fromWindow: true, tab: { title: 'Stripe' } })
  })

  it('a group: or window: filter scopes to saved data: nothing closed under the saved results', () => {
    const entries = [tab('a', now, 'Docs')]
    expect(ids('group:Work docs', entries)).toEqual([])
    expect(ids('window:Main docs', entries)).toEqual([])
  })

  it('needs words or a tag under the saved results', () => {
    expect(searchRecentlyClosed([tab('a', now, 'Docs')], parseSearchQuery(''), 3)).toEqual([])
  })

  it('tag: matches the browser tab group the tab was in', () => {
    const grouped = tab('g', now, 'Board', undefined, { tabs: [{ url: 'https://b.test', title: 'Board', tabGroup: { title: 'Work', color: 'blue' } }] })
    expect(ids('tag:work', [grouped, tab('n', now, 'Board')])).toEqual(['g'])
    expect(ids('board tag:home', [grouped])).toEqual([])
  })

  describe('closed:', () => {
    it('alone lists every entry, newest first, window entries as whole windows', () => {
      const w = win('w', now - 1, [{ title: 'A', url: 'https://a.test' }, { title: 'B', url: 'https://b.test' }])
      const results = searchRecentlyClosed([tab('old', now - 5, 'Old'), w, tab('new', now, 'New')], parseSearchQuery('closed:'), 12)
      expect(results.map((r) => r.entry.id)).toEqual(['new', 'w', 'old'])
      expect(results[1]).toMatchObject({ tabIndex: undefined, fromWindow: true })
      expect(results[0]).toMatchObject({ tabIndex: 0, fromWindow: false })
    })

    it('ignores group: and window:, and still applies the words', () => {
      expect(ids('group:Work closed: docs', [tab('a', now, 'Docs'), tab('b', now, 'Mail')], 12)).toEqual(['a'])
      expect(ids('window:Main closed:', [tab('a', now, 'Docs')], 12)).toEqual(['a'])
    })

    it('leaves out cleared and empty entries', () => {
      expect(ids('closed:', [tab('a', now, 'Docs', undefined, { clearedAt: now }), { id: 'e', closedAt: now, kind: 'window', tabs: [] }], 12)).toEqual([])
    })
  })
})

describe('closedWhenLabel', () => {
  const now = at(2026, 11, 13, 15)

  it('today and yesterday with the clock time', () => {
    expect(closedWhenLabel(at(2026, 11, 13, 10, 11), now, 'en-GB')).toBe('closed today 10:11')
    expect(closedWhenLabel(at(2026, 11, 12, 18, 2), now, 'en-GB')).toBe('closed yesterday 18:02')
  })

  it('an older day by its label', () => {
    expect(closedWhenLabel(at(2026, 11, 9, 8), now, 'en-US')).toBe('closed Mon, Nov 9')
  })

  it('defaults to the current time and locale', () => {
    expect(closedWhenLabel(Date.now())).toMatch(/^closed today /)
  })
})
