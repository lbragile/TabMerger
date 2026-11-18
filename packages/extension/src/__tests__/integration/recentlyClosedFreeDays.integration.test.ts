import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { RECENTLY_CLOSED_LIMITS } from '@tabmerger/shared'
import { addRecentlyClosedEntry, getRecentlyClosedEntries, pruneRecentlyClosed } from '@/lib/recentlyClosedDb'
import { limitsForPlan, localDayKey, type RecentlyClosedEntry } from '@/lib/recentlyClosed'
import { clearDb } from './dbTestUtils'

// Real IndexedDB: Free keeps the newest RECENTLY_CLOSED_LIMITS.free.recentDays LOCAL days that have
// closes (a rolling window of day rows, not calendar days), on the same day boundaries as the day
// rows (`localDayKey`), DST days included. Pro keeps calendar days. Unknown plans keep Pro's.

const ORIGINAL_TZ = process.env.TZ
beforeAll(() => {
  // a zone with DST: 2026-11-01 is a 25-hour day in New York
  process.env.TZ = 'America/New_York'
})
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ
})

beforeEach(async () => {
  await clearDb()
})

let n = 0
const entry = (closedAt: number, url = `https://site${++n}.example/`): RecentlyClosedEntry => ({
  id: `e${n}-${closedAt}`,
  closedAt,
  kind: 'tab',
  tabs: [{ url, title: url }],
})
const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).getTime()
const keys = async () => [...new Set((await getRecentlyClosedEntries()).map((e) => localDayKey(e.closedAt)))].sort()

describe('Free: the newest local days with closes, rolling', () => {
  const free = limitsForPlan('free')

  it('uses the shared limits: 2 rolling days, the storage cap equal to Pro\'s', () => {
    expect(free).toEqual(RECENTLY_CLOSED_LIMITS.free)
    expect(free.recentDays).toBe(2)
    expect(free.entries).toBe(RECENTLY_CLOSED_LIMITS.pro.entries)
  })

  it('non-consecutive days: a close on a newer day rolls the oldest day out, whatever the gap', async () => {
    const now = local(2026, 11, 20, 12)
    await addRecentlyClosedEntry(entry(local(2026, 10, 1, 9)), free, now)
    await addRecentlyClosedEntry(entry(local(2026, 10, 15, 9)), free, now)
    // two days, three weeks apart: both kept (no calendar age on Free)
    expect(await keys()).toEqual(['2026-10-01', '2026-10-15'])
    await addRecentlyClosedEntry(entry(local(2026, 11, 20, 9)), free, now)
    expect(await keys()).toEqual(['2026-10-15', '2026-11-20'])
    // another close on a kept day drops nothing
    await addRecentlyClosedEntry(entry(local(2026, 11, 20, 10)), free, now)
    expect((await getRecentlyClosedEntries()).length).toBe(3)
  })

  it('DST: the 25-hour day is one day, and the window counts local days', async () => {
    // the zone really has the DST change (the test is about it)
    expect(local(2026, 11, 2, 0) - local(2026, 11, 1, 0)).toBe(25 * 60 * 60 * 1000)
    const now = local(2026, 11, 2, 12)
    await addRecentlyClosedEntry(entry(local(2026, 10, 31, 23, 30)), free, now)
    await addRecentlyClosedEntry(entry(local(2026, 11, 1, 0, 30)), free, now)
    // 23:30 on the DST day is still that day (25 hours after its midnight)
    await addRecentlyClosedEntry(entry(local(2026, 11, 1, 23, 30)), free, now)
    expect(await keys()).toEqual(['2026-10-31', '2026-11-01'])
    await addRecentlyClosedEntry(entry(local(2026, 11, 2, 0, 10)), free, now)
    expect(await keys()).toEqual(['2026-11-01', '2026-11-02'])
    expect((await getRecentlyClosedEntries()).length).toBe(3)
  })

  it('a sweep for a plan found to be Free trims a Pro-sized list to the 2 newest days', async () => {
    const now = local(2026, 11, 20, 12)
    const pro = limitsForPlan('pro')
    for (const day of [3, 8, 12, 19, 20]) await addRecentlyClosedEntry(entry(local(2026, 11, day, 9)), pro, now)
    expect((await keys()).length).toBe(5)
    const { deleted } = await pruneRecentlyClosed(free, now)
    expect(deleted).toBe(3)
    expect(await keys()).toEqual(['2026-11-19', '2026-11-20'])
  })

  it('Pro and an unknown plan keep calendar days instead (30 days back from now)', async () => {
    expect(limitsForPlan('unknown')).toEqual(limitsForPlan('pro'))
    const now = local(2026, 11, 20, 12)
    const pro = limitsForPlan('pro')
    await addRecentlyClosedEntry(entry(local(2026, 10, 1, 9)), pro, now)
    await addRecentlyClosedEntry(entry(local(2026, 11, 1, 9)), pro, now)
    await addRecentlyClosedEntry(entry(local(2026, 11, 19, 9)), pro, now)
    await addRecentlyClosedEntry(entry(local(2026, 11, 20, 9)), pro, now)
    expect(await keys()).toEqual(['2026-11-01', '2026-11-19', '2026-11-20'])
  })
})
