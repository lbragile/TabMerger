import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getRecentlyClosedEntries, putRecentlyClosedEntries } from '@/lib/recentlyClosedDb'
import { entriesShownForPlan, localDayKey, type RecentlyClosedEntry } from '@/lib/recentlyClosed'
import { setSetting } from '@/lib/localDb'
import { AUTO_SAVE_TIER_SEEN_KEY, LAST_USER_ID_KEY } from '@/lib/syncSettingKeys'
import { clearDb } from './dbTestUtils'

// Real IndexedDB: the popup's catch-up prune (trimRecentlyClosedIfFree, run by
// useTrimRecentlyClosedForPlan once the popup shows Free). A list kept under the Pro limits is
// trimmed to exactly what the Free list shows, but only when Free is confirmed.

const h = vi.hoisted(() => ({ session: null as { user: { id: string } } | null, tier: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: h.session } }) } } }))
vi.mock('@/lib/entitlementTier', () => ({ fetchTier: h.tier }))

import { trimRecentlyClosedIfFree } from '@/lib/recentlyClosedPlan'

const NOW = new Date(2026, 10, 17, 12, 0, 0).getTime()
const at = (back: number, hour = 12) => new Date(2026, 10, 17 - back, hour, 0, 0).getTime()
const entry = (id: string, closedAt: number): RecentlyClosedEntry => ({ id, closedAt, kind: 'tab', tabs: [{ url: `https://${id}.example/`, title: id }] })

// what a Pro-limits recording left: no close today, yesterday twice, then 2 and 6 days ago
const STORED = [entry('y1', at(1, 9)), entry('y2', at(1, 18)), entry('d2', at(2)), entry('d6', at(6))]
const ids = async () => (await getRecentlyClosedEntries()).map((e) => e.id).sort()

beforeEach(async () => {
  await clearDb()
  h.session = null
  h.tier.mockReset()
  await putRecentlyClosedEntries(STORED)
})

describe('popup catch-up prune on real IndexedDB', () => {
  it('signed out on a store no account owns: storage ends up as exactly the Free list shown', async () => {
    const shownBefore = entriesShownForPlan(await getRecentlyClosedEntries(), 'free').map((e) => e.id).sort()
    expect(shownBefore).toEqual(['d2', 'y1', 'y2'])
    await expect(trimRecentlyClosedIfFree(NOW)).resolves.toBe(1)
    expect(await ids()).toEqual(shownBefore)
    expect(new Set((await getRecentlyClosedEntries()).map((e) => localDayKey(e.closedAt))).size).toBe(2)
    // a second run has nothing left to do
    await expect(trimRecentlyClosedIfFree(NOW)).resolves.toBe(0)
  })

  it('signed in: a remembered "pro" is re-checked; the server says Free, so it trims and remembers', async () => {
    h.session = { user: { id: 'u1' } }
    await setSetting(LAST_USER_ID_KEY, 'u1')
    await setSetting(AUTO_SAVE_TIER_SEEN_KEY, { tier: 'pro', at: NOW - 1000 })
    h.tier.mockResolvedValue('free')
    await expect(trimRecentlyClosedIfFree(NOW)).resolves.toBe(1)
    expect(await ids()).toEqual(['d2', 'y1', 'y2'])
  })

  it('the check fails (unknown) or the plan is paid: nothing is deleted', async () => {
    h.session = { user: { id: 'u1' } }
    await setSetting(LAST_USER_ID_KEY, 'u1')
    h.tier.mockResolvedValue(null)
    await expect(trimRecentlyClosedIfFree(NOW)).resolves.toBe(0)
    h.tier.mockResolvedValue('pro')
    await expect(trimRecentlyClosedIfFree(NOW)).resolves.toBe(0)
    expect(await ids()).toEqual(['d2', 'd6', 'y1', 'y2'])
  })

  it('signed out on a store an account owns, with no usable answer: unknown, nothing deleted', async () => {
    await setSetting(LAST_USER_ID_KEY, 'u1')
    await expect(trimRecentlyClosedIfFree(NOW)).resolves.toBe(0)
    expect(await ids()).toEqual(['d2', 'd6', 'y1', 'y2'])
    expect(h.tier).not.toHaveBeenCalled()
  })
})
