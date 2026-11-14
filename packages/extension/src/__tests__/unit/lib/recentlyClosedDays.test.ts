import { afterEach, describe, expect, it } from 'vitest'
import { colorForDay } from '@tabmerger/shared'
import { dayLabel, formatClosedTime, groupEntriesByDay, localDayBounds, localDayKey } from '@/lib/recentlyClosedDays'
import type { RecentlyClosedEntry } from '@/lib/recentlyClosed'

const at = (y: number, m: number, d: number, h = 12, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s).getTime()

const tab = (id: string, closedAt: number, over: Partial<RecentlyClosedEntry> = {}): RecentlyClosedEntry => ({
  id,
  closedAt,
  kind: 'tab',
  tabs: [{ url: `https://${id}.test`, title: id }],
  ...over,
})
const win = (id: string, closedAt: number, n: number): RecentlyClosedEntry => ({
  id,
  closedAt,
  kind: 'window',
  tabs: Array.from({ length: n }, (_, i) => ({ url: `https://${id}${i}.test`, title: `${id}${i}` })),
})

describe('groupEntriesByDay', () => {
  const now = at(2026, 11, 13, 15)

  it('groups by local day, newest day first, entries newest first, with counts', () => {
    const days = groupEntriesByDay(
      [tab('a', at(2026, 11, 13, 9)), win('w', at(2026, 11, 13, 14), 3), tab('b', at(2026, 11, 12, 22)), tab('c', at(2026, 11, 10, 8))],
      now,
      'en-US'
    )
    expect(days.map((d) => d.key)).toEqual(['2026-11-13', '2026-11-12', '2026-11-10'])
    expect(days.map((d) => d.kind)).toEqual(['today', 'yesterday', 'date'])
    expect(days[0].label).toBe('Today')
    expect(days[1].label).toBe('Yesterday')
    expect(days[2].label).toBe('Tue, Nov 10')
    expect(days[0].entries.map((e) => e.id)).toEqual(['w', 'a'])
    expect(days[0]).toMatchObject({ tabCount: 1, windowCount: 1, allTabCount: 4 })
    // each day has its fixed colour, consecutive days differ
    expect(days[0].color).toBe(colorForDay('2026-11-13'))
    expect(days[0].color).not.toBe(days[1].color)
  })

  it('splits at local midnight: 23:59:59 stays on its day', () => {
    const days = groupEntriesByDay([tab('late', at(2026, 11, 12, 23, 59, 59)), tab('early', at(2026, 11, 13, 0, 0, 0))], now, 'en-US')
    expect(days.map((d) => [d.key, d.entries[0].id])).toEqual([
      ['2026-11-13', 'early'],
      ['2026-11-12', 'late'],
    ])
  })

  it('leaves out cleared entries and drops empty days', () => {
    const days = groupEntriesByDay([tab('gone', at(2026, 11, 11), { clearedAt: now }), tab('kept', at(2026, 11, 13))], now, 'en-US')
    expect(days.map((d) => d.key)).toEqual(['2026-11-13'])
  })

  it('adds the year for another year', () => {
    expect(dayLabel(at(2025, 12, 30), now, 'en-US').label).toBe('Tue, Dec 30, 2025')
  })

  it('labels in an RTL locale', () => {
    const { label } = dayLabel(at(2026, 11, 10), now, 'he')
    expect(label).toMatch(/נוב/)
  })

  it('falls back to the default locale for an invalid tag', () => {
    expect(() => dayLabel(at(2026, 11, 10), now, 'not a locale!!')).not.toThrow()
    expect(() => formatClosedTime(now, 'not a locale!!')).not.toThrow()
  })
})

describe('local day bounds', () => {
  const originalTz = process.env.TZ
  afterEach(() => {
    process.env.TZ = originalTz
  })

  it('a day spans local midnight to local midnight', () => {
    const { start, end } = localDayBounds(at(2026, 11, 13, 15))
    expect(start).toBe(at(2026, 11, 13, 0))
    expect(end).toBe(at(2026, 11, 14, 0))
    expect(localDayKey(start)).toBe('2026-11-13')
    expect(localDayKey(end - 1)).toBe('2026-11-13')
  })

  it('a DST change day is not 24 hours, and still one day', () => {
    // whatever the test machine's zone: the bounds come from the calendar date, so the key of the
    // last millisecond is the same day and the next start is the next day
    const sample = at(2026, 3, 29, 12) // the EU spring-forward Sunday
    const { start, end } = localDayBounds(sample)
    expect(localDayKey(start)).toBe('2026-03-29')
    expect(localDayKey(end)).toBe('2026-03-30')
    expect(localDayKey(end - 1)).toBe('2026-03-29')
  })
})

describe('formatClosedTime', () => {
  it('uses the locale clock', () => {
    const t = at(2026, 11, 13, 14, 58)
    expect(formatClosedTime(t, 'en-GB')).toBe('14:58')
    expect(formatClosedTime(t, 'en-US')).toMatch(/2:58\sPM/)
  })
})
