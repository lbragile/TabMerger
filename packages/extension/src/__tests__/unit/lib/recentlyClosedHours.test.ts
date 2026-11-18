import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  AXIS_HOURS,
  BAR_MAX_REM,
  BAR_MIN_REM,
  HOURS_IN_DAY,
  barHeightRem,
  busiestHours,
  closedHour,
  countByHour,
  hourAxisLabel,
  hourLabel,
  runsByHour,
} from '@/lib/recentlyClosedHours'
import { groupEntriesByDay } from '@/lib/recentlyClosedDays'
import type { RecentlyClosedEntry } from '@/lib/recentlyClosed'

const at = (h: number, min = 0, s = 0) => new Date(2030, 0, 3, h, min, s).getTime()
const tab = (id: string, closedAt: number): RecentlyClosedEntry => ({ id, closedAt, kind: 'tab', tabs: [{ url: `https://${id}.test`, title: id }] })
const win = (id: string, closedAt: number, n: number): RecentlyClosedEntry => ({
  id,
  closedAt,
  kind: 'window',
  tabs: Array.from({ length: n }, (_, i) => ({ url: `https://${id}${i}.test`, title: `${id}${i}` })),
})

describe('countByHour / closedHour', () => {
  it('counts entries per local clock hour, 24 slots, hour boundaries exact', () => {
    const counts = countByHour([tab('a', at(0, 0, 0)), tab('b', at(0, 59, 59)), tab('c', at(1)), tab('d', at(23, 59, 59)), tab('e', at(16, 5)), tab('f', at(16, 42))])
    expect(counts).toHaveLength(HOURS_IN_DAY)
    expect(counts[0]).toBe(2)
    expect(counts[1]).toBe(1)
    expect(counts[16]).toBe(2)
    expect(counts[23]).toBe(1)
    expect(counts.reduce((n, c) => n + c, 0)).toBe(6)
    expect(closedHour(at(23, 59, 59))).toBe(23)
  })

  it('a window counts once, in the hour it was closed, however many tabs it had', () => {
    const counts = countByHour([win('w', at(9, 30), 12), tab('t', at(9, 31))])
    expect(counts[9]).toBe(2)
  })

  it('an empty day has every hour at zero and no busiest hour', () => {
    expect(countByHour([]).every((n) => n === 0)).toBe(true)
    expect(busiestHours(countByHour([]))).toEqual([])
  })
})

describe('busiestHours', () => {
  const counts = (pairs: [number, number][]) => {
    const c = new Array(HOURS_IN_DAY).fill(0)
    for (const [h, n] of pairs) c[h] = n
    return c
  }

  it('one busiest hour', () => {
    expect(busiestHours(counts([[9, 1], [16, 3], [11, 2]]))).toEqual([16])
  })

  it('ties: every hour with the top count, earliest first', () => {
    expect(busiestHours(counts([[16, 3], [11, 3], [9, 1]]))).toEqual([11, 16])
    expect(busiestHours(counts([[2, 1], [5, 1], [20, 1]]))).toEqual([2, 5, 20])
  })
})

describe('runsByHour', () => {
  it('cuts a newest-first list into same-hour runs, keeping the order', () => {
    const entries = [tab('a', at(16, 42)), tab('b', at(16, 5)), tab('c', at(14, 51)), tab('d', at(11, 30)), tab('e', at(11, 1))]
    const runs = runsByHour(entries)
    expect(runs.map((r) => [r.hour, r.entries.map((e) => e.id)])).toEqual([
      [16, ['a', 'b']],
      [14, ['c']],
      [11, ['d', 'e']],
    ])
  })

  it('no entries, no runs', () => {
    expect(runsByHour([])).toEqual([])
  })
})

describe('a DST day (America/New_York)', () => {
  const originalTz = process.env.TZ
  beforeAll(() => {
    process.env.TZ = 'America/New_York'
  })
  afterAll(() => {
    process.env.TZ = originalTz
  })

  it('fall back: both passes through 01:xx count in hour 1, one run, one day', () => {
    // 2030-11-03: 02:00 EDT goes back to 01:00 EST, so 01:30 happens twice
    const firstPass = Date.UTC(2030, 10, 3, 5, 30) // 01:30 EDT
    const secondPass = Date.UTC(2030, 10, 3, 6, 30) // 01:30 EST
    expect(secondPass - firstPass).toBe(60 * 60 * 1000)
    expect(closedHour(firstPass)).toBe(1)
    expect(closedHour(secondPass)).toBe(1)
    const late = Date.UTC(2030, 10, 4, 4, 30) // 23:30 EST, same local day
    const entries = [tab('late', late), tab('second', secondPass), tab('first', firstPass)]
    const [day] = groupEntriesByDay(entries, late, 'en-US')
    // a real 25-hour day (the zone change worked on this machine)
    expect(day.end - day.start).toBe(25 * 60 * 60 * 1000)
    const counts = countByHour(day.entries)
    expect(counts[1]).toBe(2)
    expect(counts[23]).toBe(1)
    expect(runsByHour(day.entries).map((r) => r.hour)).toEqual([23, 1])
  })

  it('spring forward: there is no 02:xx, the clock hours around it count as usual', () => {
    const before = Date.UTC(2030, 2, 10, 6, 59) // 01:59 EST
    const after = Date.UTC(2030, 2, 10, 7, 0) // 03:00 EDT
    expect(closedHour(before)).toBe(1)
    expect(closedHour(after)).toBe(3)
    const counts = countByHour([tab('a', after), tab('b', before)])
    expect(counts[2]).toBe(0)
    // labels come from a plain date, so even the skipped hour has one
    expect(hourLabel(2, 'en-GB')).toMatch(/^0?2:00$/)
  })
})

describe('labels and bar heights', () => {
  it('hour labels use the locale clock, like the row times', () => {
    expect(hourLabel(16, 'en-GB')).toBe('16:00')
    expect(hourLabel(16, 'en-US')).toMatch(/^4:00\sPM$/)
    expect(hourAxisLabel(16, 'en-GB')).toBe('16')
    expect(hourAxisLabel(16, 'en-US')).toMatch(/^4\sPM$/)
    expect(() => hourLabel(3, 'not a locale!!')).not.toThrow()
    expect(() => hourAxisLabel(3, 'not a locale!!')).not.toThrow()
    expect(AXIS_HOURS).toEqual([0, 6, 12, 18, 23])
  })

  it('the busiest hour is the tallest bar; any count keeps a visible minimum; none is zero', () => {
    expect(barHeightRem(5, 5)).toBe(BAR_MAX_REM)
    expect(barHeightRem(1, 100)).toBe(BAR_MIN_REM)
    expect(barHeightRem(2, 4)).toBeCloseTo(BAR_MAX_REM / 2, 3)
    expect(barHeightRem(0, 4)).toBe(0)
    expect(barHeightRem(3, 0)).toBe(0)
  })
})
