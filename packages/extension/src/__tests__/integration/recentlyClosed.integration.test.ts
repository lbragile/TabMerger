import { beforeEach, describe, expect, it } from 'vitest'
import { RECENTLY_CLOSED_CLEAR_DELAY_MS, RECENTLY_CLOSED_LIMITS } from '@tabmerger/shared'
import { clearAllLocalData, getDb, getGroupsState, setSetting, updateGroupsState } from '@/lib/localDb'
import {
  addRecentlyClosedEntry,
  deleteRecentlyClosedEntries,
  getRecentlyClosedEntries,
  migrateRememberClosedTabs,
  markRecentlyClosedCleared,
  pruneRecentlyClosed,
  purgeClearedRecentlyClosed,
  putRecentlyClosedEntries,
  unmarkRecentlyClosedCleared,
} from '@/lib/recentlyClosedDb'
import type { RecentlyClosedEntry } from '@/lib/recentlyClosed'
import { APP_SETTINGS_KEY } from '@/lib/syncSettingKeys'
import { createGroup } from '@/lib/utils'
import { clearDb } from './dbTestUtils'

// Real IndexedDB (fake-indexeddb): the recently-closed store's one-transaction writes.

const DAY = 86_400_000
const NOW = Date.UTC(2030, 10, 5, 12)
const pro = RECENTLY_CLOSED_LIMITS.pro
const free = RECENTLY_CLOSED_LIMITS.free
const tab = (id: string, url: string, closedAt: number): RecentlyClosedEntry => ({ id, closedAt, kind: 'tab', tabs: [{ url, title: url }] })
const ids = async (includeCleared = false) => (await getRecentlyClosedEntries({ includeCleared })).map((e) => e.id)

beforeEach(async () => {
  await clearDb()
})

describe('recording (add + dedupe + prune in one transaction)', () => {
  it('adds, drops the older entry of the same URL, and prunes by age for the plan', async () => {
    await addRecentlyClosedEntry(tab('old-a', 'https://a.test/', NOW - 2 * DAY), pro, NOW)
    await addRecentlyClosedEntry(tab('ancient', 'https://b.test/', NOW - 8 * DAY), pro, NOW)
    await addRecentlyClosedEntry(tab('new-a', 'https://A.test/', NOW), free, NOW)
    expect(await ids()).toEqual(['new-a'])
  })

  it('keeps only the newest entries over the count limit', async () => {
    for (let i = 0; i < 5; i++) await addRecentlyClosedEntry(tab(`e${i}`, `https://s${i}.test`, NOW - (10 - i) * 1000), { entries: 3, days: 30 }, NOW)
    expect(await ids()).toEqual(['e4', 'e3', 'e2'])
  })

  it('writes nothing while the setting is off (checked inside the write)', async () => {
    // the switch lives in the store's meta row (the old appSettings value is migrated at worker start)
    await setSetting(APP_SETTINGS_KEY, { rememberClosedTabs: false })
    await migrateRememberClosedTabs()
    expect(await addRecentlyClosedEntry(tab('x', 'https://x.test', NOW), pro, NOW)).toBe(false)
    expect(await ids(true)).toEqual([])
  })

  it('a recording at the same moment as a popup group write loses neither', async () => {
    await getGroupsState()
    const added = createGroup(undefined, 'Saved')
    await Promise.all([
      addRecentlyClosedEntry(tab('rc', 'https://rc.test', NOW), pro, NOW),
      updateGroupsState((s) => ({ ...s, available: [...s.available, added] })),
      addRecentlyClosedEntry(tab('rc2', 'https://rc2.test', NOW + 1), pro, NOW + 1),
    ])
    expect((await getGroupsState()).available.map((g) => g.id)).toContain(added.id)
    expect(await ids()).toEqual(['rc2', 'rc'])
  })
})

describe('clear marks, undo and the delayed delete', () => {
  it('marks hide entries at once; undo brings them back', async () => {
    await addRecentlyClosedEntry(tab('a', 'https://a.test', NOW - 2), pro, NOW)
    await addRecentlyClosedEntry(tab('b', 'https://b.test', NOW - 1), pro, NOW)
    const marked = await markRecentlyClosedCleared('all', NOW)
    expect([...marked].sort()).toEqual(['a', 'b'])
    expect(await ids()).toEqual([])
    expect(await ids(true)).toEqual(['b', 'a'])
    expect(await unmarkRecentlyClosedCleared(marked)).toBe(2)
    expect(await ids()).toEqual(['b', 'a'])
  })

  it('the delayed delete removes only entries cleared longer than the undo window ago', async () => {
    await addRecentlyClosedEntry(tab('a', 'https://a.test', NOW - 2), pro, NOW)
    await addRecentlyClosedEntry(tab('b', 'https://b.test', NOW - 1), pro, NOW)
    await markRecentlyClosedCleared(['a'], NOW)
    expect(await purgeClearedRecentlyClosed(NOW + 1000)).toEqual({ deleted: 0, nextPurgeAt: NOW + RECENTLY_CLOSED_CLEAR_DELAY_MS })
    expect(await purgeClearedRecentlyClosed(NOW + RECENTLY_CLOSED_CLEAR_DELAY_MS)).toEqual({ deleted: 1, nextPurgeAt: null })
    expect(await ids(true)).toEqual(['b'])
    // undo after the delete has nothing left to bring back
    expect(await unmarkRecentlyClosedCleared(['a'])).toBe(0)
  })

  it('a worker start sweep prunes for the plan (Pro to Free trims) and drops corrupt rows', async () => {
    await addRecentlyClosedEntry(tab('recent', 'https://r.test', NOW - DAY), pro, NOW)
    await addRecentlyClosedEntry(tab('twenty-days', 'https://t.test', NOW - 20 * DAY), pro, NOW)
    await (await getDb()).put('recentlyClosed', { id: 'corrupt', closedAt: 'x' } as unknown as RecentlyClosedEntry)
    expect((await pruneRecentlyClosed(free, NOW)).deleted).toBe(2)
    expect(await ids(true)).toEqual(['recent'])
  })

  it('reopen deletes; undo of a reopen puts the entry back without a mark', async () => {
    const entry = tab('a', 'https://a.test', NOW)
    await addRecentlyClosedEntry(entry, pro, NOW)
    await deleteRecentlyClosedEntries(['a'])
    expect(await ids(true)).toEqual([])
    await putRecentlyClosedEntries([{ ...entry, clearedAt: NOW }])
    expect(await ids()).toEqual(['a'])
  })

  it('"Clear all data" wipes the list too', async () => {
    await addRecentlyClosedEntry(tab('a', 'https://a.test', NOW), pro, NOW)
    await clearAllLocalData()
    expect(await ids(true)).toEqual([])
  })
})
