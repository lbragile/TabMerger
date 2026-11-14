import { beforeEach, describe, expect, it } from 'vitest'
import { RECENTLY_CLOSED_LIMITS, RECENTLY_CLOSED_META_ID } from '@tabmerger/shared'
import { clearAllLocalData, getDb, getGroupsState, setSetting, updateGroupsState } from '@/lib/localDb'
import {
  addRecentlyClosedEntry,
  getRecentlyClosedEntries,
  getRememberClosedTabs,
  markRecentlyClosedCleared,
  migrateRememberClosedTabs,
  pruneRecentlyClosed,
  setRememberClosedTabs,
  unmarkRecentlyClosedCleared,
} from '@/lib/recentlyClosedDb'
import type { RecentlyClosedEntry } from '@/lib/recentlyClosed'
import { APP_SETTINGS_KEY } from '@/lib/syncSettingKeys'
import { createGroup } from '@/lib/utils'
import { clearDb } from './dbTestUtils'

// Real IndexedDB (fake-indexeddb): the store's meta row (the switch and the last full clear).

const NOW = Date.UTC(2030, 10, 5, 12)
const pro = RECENTLY_CLOSED_LIMITS.pro
const tab = (id: string, closedAt: number): RecentlyClosedEntry => ({ id, closedAt, kind: 'tab', tabs: [{ url: `https://${id}.test/`, title: id }] })
const ids = async () => (await getRecentlyClosedEntries({ includeCleared: true })).map((e) => e.id)
const meta = async () => (await getDb()).get('recentlyClosed', RECENTLY_CLOSED_META_ID)

beforeEach(async () => {
  await clearDb()
})

describe('the "Remember closed tabs" switch in the meta row', () => {
  it('is on by default and set in this store only', async () => {
    expect(await getRememberClosedTabs()).toBe(true)
    await setRememberClosedTabs(false)
    expect(await getRememberClosedTabs()).toBe(false)
    expect(await addRecentlyClosedEntry(tab('a', NOW), pro, NOW)).toBe(false)
    await setRememberClosedTabs(true)
    expect(await addRecentlyClosedEntry(tab('a', NOW), pro, NOW)).toBe(true)
  })

  it('is copied ONCE from the old appSettings value, then appSettings is ignored', async () => {
    await setSetting(APP_SETTINGS_KEY, { theme: 'dark', rememberClosedTabs: false })
    expect(await migrateRememberClosedTabs()).toBe(false)
    expect(await meta()).toEqual({ id: RECENTLY_CLOSED_META_ID, remember: false })
    // a later settings save carrying an old value does not change it
    await setSetting(APP_SETTINGS_KEY, { theme: 'dark', rememberClosedTabs: true })
    expect(await getRememberClosedTabs()).toBe(false)
  })

  it('the first read migrates when nothing was migrated yet', async () => {
    await setSetting(APP_SETTINGS_KEY, { rememberClosedTabs: false })
    expect(await getRememberClosedTabs()).toBe(false)
    expect((await meta())?.remember).toBe(false)
  })

  it('a recording at the same moment as a group write: neither is lost (one store each)', async () => {
    await getGroupsState()
    const added = createGroup(undefined, 'Saved')
    await Promise.all([
      addRecentlyClosedEntry(tab('rc', NOW), pro, NOW),
      updateGroupsState((s) => ({ ...s, available: [...s.available, added] })),
      setSetting(APP_SETTINGS_KEY, { theme: 'light' }),
    ])
    expect((await getGroupsState()).available.map((g) => g.id)).toContain(added.id)
    expect(await ids()).toEqual(['rc'])
  })

  it('the meta row is never pruned as a corrupt row, nor counted as an entry', async () => {
    await setRememberClosedTabs(true)
    await addRecentlyClosedEntry(tab('a', NOW), pro, NOW)
    expect((await pruneRecentlyClosed({ entries: 0, days: 30 }, NOW)).deleted).toBe(1)
    expect(await meta()).toEqual({ id: RECENTLY_CLOSED_META_ID, remember: true })
    expect(await markRecentlyClosedCleared('all', NOW)).toEqual([])
    expect(await unmarkRecentlyClosedCleared([RECENTLY_CLOSED_META_ID])).toBe(0)
  })
})

describe('closes still queued from before a full clear', () => {
  it('Clear list records the clear: an older close arriving later is dropped, a newer one kept', async () => {
    await addRecentlyClosedEntry(tab('before', NOW - 5000), pro, NOW)
    expect(await markRecentlyClosedCleared('all', NOW)).toEqual(['before'])
    // a window closed 1 s before the clear, flushed only now
    expect(await addRecentlyClosedEntry(tab('queued', NOW - 1000), pro, NOW + 1000)).toBe(false)
    expect(await addRecentlyClosedEntry(tab('after', NOW + 500), pro, NOW + 1000)).toBe(true)
    expect(await ids()).toEqual(['after', 'before'])
  })

  it('removing a few entries does not record a full clear', async () => {
    await addRecentlyClosedEntry(tab('a', NOW - 5000), pro, NOW)
    await markRecentlyClosedCleared(['a'], NOW)
    expect(await addRecentlyClosedEntry(tab('queued', NOW - 1000), pro, NOW)).toBe(true)
  })

  it('turning it off marks everything and switches it off in ONE write', async () => {
    await addRecentlyClosedEntry(tab('a', NOW - 5000), pro, NOW)
    expect(await markRecentlyClosedCleared('all', NOW, { turnOff: true })).toEqual(['a'])
    expect(await meta()).toEqual({ id: RECENTLY_CLOSED_META_ID, remember: false, clearedBefore: NOW })
  })

  it('"Clear all data" wipes the list and records the clear (the switch back to its default)', async () => {
    await setRememberClosedTabs(false)
    await addRecentlyClosedEntry(tab('a', NOW - 5000), pro, NOW)
    const before = Date.now()
    await clearAllLocalData()
    const row = (await meta()) as { remember?: boolean; clearedBefore?: number }
    expect(row.remember).toBeUndefined()
    expect(row.clearedBefore).toBeGreaterThanOrEqual(before)
    expect(await ids()).toEqual([])
    // a close from before the wipe that was still queued does not start the list again
    expect(await addRecentlyClosedEntry(tab('queued', before - 1000), pro, Date.now())).toBe(false)
  })
})
