import { describe, expect, it } from 'vitest'
import { RECENTLY_CLOSED_LIMITS } from '@tabmerger/shared'
import { entriesShownForPlan, limitsForPlan, localDayKey, newestDayKeys, planPrune, type RecentlyClosedEntry } from '@/lib/recentlyClosed'

// What the popup lists for a plan (entriesShownForPlan) and the Free prune share one day rule
// (newestDayKeys), so a Free list never shows a day the next prune deletes.

const NOW = new Date(2026, 10, 17, 12, 0, 0).getTime()
const at = (back: number, hour = 12) => new Date(2026, 10, 17 - back, hour, 0, 0).getTime()
const entry = (id: string, closedAt: number, clearedAt?: number): RecentlyClosedEntry => ({
  id,
  closedAt,
  kind: 'tab',
  tabs: [{ url: `https://${id}.example/`, title: id }],
  ...(clearedAt !== undefined ? { clearedAt } : {}),
})

describe('newestDayKeys', () => {
  it('the newest N local days that have entries, not consecutive calendar days', () => {
    const keys = newestDayKeys([entry('a', at(2)), entry('b', at(5)), entry('c', at(5, 20)), entry('d', at(9))], 2)
    expect([...keys]).toEqual([localDayKey(at(2)), localDayKey(at(5))])
  })

  it('cleared entries do not make a day count; at least one day is kept', () => {
    expect([...newestDayKeys([entry('a', at(1), NOW), entry('b', at(3))], 1)]).toEqual([localDayKey(at(3))])
    expect(newestDayKeys([entry('a', at(1)), entry('b', at(3))], 0).size).toBe(1)
    expect(newestDayKeys([], 2).size).toBe(0)
  })
})

describe('entriesShownForPlan', () => {
  const stored = [entry('y1', at(1, 9)), entry('y2', at(1, 18)), entry('d2', at(2)), entry('d5', at(5))]

  it('Free: only the newest recentDays (2) days with closes', () => {
    expect(RECENTLY_CLOSED_LIMITS.free.recentDays).toBe(2)
    expect(entriesShownForPlan(stored, 'free').map((e) => e.id)).toEqual(['y1', 'y2', 'd2'])
  })

  it('Pro and unknown (loading) list everything stored', () => {
    expect(entriesShownForPlan(stored, 'pro').map((e) => e.id)).toEqual(['y1', 'y2', 'd2', 'd5'])
    expect(entriesShownForPlan(stored, 'unknown').map((e) => e.id)).toEqual(['y1', 'y2', 'd2', 'd5'])
  })

  it('cleared entries are never listed and their day does not count toward Free', () => {
    const withCleared = [entry('y1', at(1), NOW - 1000), ...stored.slice(2), entry('d8', at(8))]
    expect(entriesShownForPlan(withCleared, 'free').map((e) => e.id)).toEqual(['d2', 'd5'])
    expect(entriesShownForPlan(withCleared, 'pro').map((e) => e.id)).toEqual(['d2', 'd5', 'd8'])
  })

  it('an empty list stays empty', () => {
    expect(entriesShownForPlan([], 'free')).toEqual([])
  })

  it('Free shows exactly what the Free prune keeps', () => {
    const many = [entry('t', at(0)), entry('y', at(1)), entry('d3', at(3)), entry('d4', at(4)), entry('cl', at(0, 8), NOW - 1000)]
    const dropped = new Set(planPrune(many, null, limitsForPlan('free'), NOW))
    const kept = many.filter((e) => !dropped.has(e.id) && e.clearedAt === undefined).map((e) => e.id)
    expect(entriesShownForPlan(many, 'free').map((e) => e.id)).toEqual(kept)
  })
})
