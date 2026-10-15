import { describe, it, expect, beforeEach } from 'vitest'
import { TOUR_DEMO_GROUP_IDS } from '@tabmerger/shared'
import {
  TOUR_DEMO_FIRST_WINDOW_NAME,
  TOUR_DEMO_MAIN_ID,
  TOUR_DEMO_TARGET_ID,
  buildTourDemoGroups,
  ensureTourDemoGroups,
  isTourDemoEntry,
  removeTourDemoGroups,
  resetTourDemoGroups,
  withTourDemoGroups,
  withoutTourDemo,
} from '@/lib/tourDemo'
import { getGroupsState, saveGroupsState } from '@/lib/localDb'
import { createGroup, createNowOpenGroup } from '@/lib/utils'
import { isHiddenFromSearch, setTourSearchShowsDemo } from '@/lib/tourSandbox'
import type { Group } from '@/lib/types'
import { clearDb } from './dbTestUtils'

// Real IndexedDB round trips for the guided tour's practice groups.

const real = (id: string, extra: Partial<Group> = {}): Group => ({ ...createGroup(id, `Real ${id}`), updatedAt: 1000, pendingSync: false, ...extra })

async function seed(groups: Group[], activeIndex = 0) {
  const now = createNowOpenGroup()
  const available = [now, ...groups]
  await saveGroupsState({ active: { id: available[activeIndex].id, index: activeIndex }, available })
}

beforeEach(async () => {
  await clearDb()
  setTourSearchShowsDemo(false)
})

describe('buildTourDemoGroups', () => {
  it('makes the two fixed-id practice groups, flagged and not pending sync', () => {
    const [main, target] = buildTourDemoGroups(123)
    expect([main.id, target.id]).toEqual(['tour-demo-1', 'tour-demo-2'])
    expect([main.id, target.id]).toEqual([...TOUR_DEMO_GROUP_IDS])
    for (const g of [main, target]) {
      expect(g.tourDemo).toBe(true)
      expect(g.pendingSync).toBe(false)
      expect(g.permanent).toBe(false)
      expect(g.updatedAt).toBe(123)
      expect(g.info).toBeTruthy()
    }
    expect(main.windows[0].name).toBe(TOUR_DEMO_FIRST_WINDOW_NAME)
    // a repeated address in ONE window, for the Deduplicate step
    const urls = main.windows[1].tabs.map((t) => t.url)
    expect(new Set(urls).size).toBeLessThan(urls.length)
    expect(main.windows.flatMap((w) => w.tabs).every((t) => t.id === 0)).toBe(true)
  })

  it('defaults the timestamp to now', () => {
    const before = Date.now()
    expect(buildTourDemoGroups()[0].updatedAt).toBeGreaterThanOrEqual(before)
  })
})

describe('isTourDemoEntry', () => {
  it('is true by flag or by a fixed id, never for the permanent group', () => {
    expect(isTourDemoEntry({ id: 'x', tourDemo: true })).toBe(true)
    expect(isTourDemoEntry({ id: TOUR_DEMO_MAIN_ID })).toBe(true)
    expect(isTourDemoEntry({ id: TOUR_DEMO_TARGET_ID })).toBe(true)
    expect(isTourDemoEntry({ id: 'x' })).toBe(false)
    expect(isTourDemoEntry({ id: TOUR_DEMO_MAIN_ID, tourDemo: true, permanent: true })).toBe(false)
  })
})

describe('withTourDemoGroups / withoutTourDemo (pure)', () => {
  it('returns null when both groups are already there, and replaces a half-made set as a whole', () => {
    const [main, target] = buildTourDemoGroups()
    const full = { active: { id: 'n', index: 0 }, available: [main, target] }
    expect(withTourDemoGroups(full)).toBeNull()
    const half = withTourDemoGroups({ ...full, available: [{ ...main, name: 'damaged' }] })!
    expect(half.available.map((g) => g.id)).toEqual(['tour-demo-1', 'tour-demo-2'])
    expect(half.available[0].name).not.toBe('damaged')
  })

  it('withoutTourDemo returns null when there is none', () => {
    expect(withoutTourDemo({ active: { id: 'a', index: 0 }, available: [real('a')] })).toBeNull()
  })

  it('withoutTourDemo keeps active when it survives, with its new index', () => {
    const [main] = buildTourDemoGroups()
    const out = withoutTourDemo({ active: { id: 'b', index: 3 }, available: [main, real('a'), real('b')] })!
    expect(out.active).toEqual({ id: 'b', index: 1 })
  })

  it('withoutTourDemo moves active to the first remaining group when it pointed at practice data', () => {
    const [main] = buildTourDemoGroups()
    const out = withoutTourDemo({ active: { id: main.id, index: 2 }, available: [real('a'), main] })!
    expect(out.active).toEqual({ id: 'a', index: 0 })
    const empty = withoutTourDemo({ active: { id: main.id, index: 0 }, available: [main] })!
    expect(empty.active).toEqual({ id: '', index: 0 })
  })
})

describe('ensureTourDemoGroups', () => {
  it('appends both practice groups after the real groups, leaving real ones in place', async () => {
    await seed([real('a'), real('b', { starred: true })])
    const { changed, state } = await ensureTourDemoGroups()
    expect(changed).toBe(true)
    expect(state.available.map((g) => g.id)).toEqual([expect.any(String), 'a', 'b', 'tour-demo-1', 'tour-demo-2'])
    const stored = await getGroupsState()
    expect(stored.available.map((g) => g.id)).toEqual(state.available.map((g) => g.id))
    const demos = stored.available.filter((g) => g.tourDemo)
    expect(demos).toHaveLength(2)
    expect(demos.every((g) => g.pendingSync === false)).toBe(true)
    expect(stored.available[0].permanent).toBe(true)
  })

  it('is idempotent: a second call writes nothing and does not duplicate', async () => {
    await seed([real('a')])
    await ensureTourDemoGroups()
    const first = await getGroupsState()
    const again = await ensureTourDemoGroups()
    expect(again.changed).toBe(false)
    const second = await getGroupsState()
    expect(second.available).toEqual(first.available)
    expect(second.available.filter((g) => g.tourDemo)).toHaveLength(2)
  })

  it('works on a list with only Now Open', async () => {
    await seed([])
    const { state } = await ensureTourDemoGroups()
    expect(state.available).toHaveLength(3)
  })
})

describe('resetTourDemoGroups', () => {
  it('replaces used-up practice data with a fresh set and keeps real groups', async () => {
    await seed([real('a')])
    await ensureTourDemoGroups()
    // use the sample tabs up
    const used = await getGroupsState()
    await saveGroupsState({ ...used, available: used.available.map((g) => (g.id === TOUR_DEMO_MAIN_ID ? { ...g, windows: [] } : g)) })
    const { changed, state } = await resetTourDemoGroups()
    expect(changed).toBe(true)
    expect(state.available.map((g) => g.id)).toEqual([expect.any(String), 'a', 'tour-demo-1', 'tour-demo-2'])
    expect(state.available.find((g) => g.id === TOUR_DEMO_MAIN_ID)!.windows).toHaveLength(2)
    expect((await getGroupsState()).available.find((g) => g.id === 'a')).toBeTruthy()
  })

  it('creates the set when there was none', async () => {
    await seed([])
    const { state } = await resetTourDemoGroups()
    expect(state.available.filter((g) => g.tourDemo)).toHaveLength(2)
  })
})

describe('removeTourDemoGroups', () => {
  it('removes only practice groups; a real group with the user\'s own data is untouched', async () => {
    const mine = real('mine', {
      name: 'My research',
      note: 'private note',
      starred: true,
      windows: [{ id: 0, name: 'Work', tabs: [{ id: 0, title: 'Docs', url: 'https://example.com/docs', savedAt: 5 }], incognito: false, focused: false }],
    })
    await seed([mine])
    await ensureTourDemoGroups()
    const before = (await getGroupsState()).available.find((g) => g.id === 'mine')
    const { changed, state } = await removeTourDemoGroups()
    expect(changed).toBe(true)
    expect(state.available.map((g) => g.id)).toEqual([expect.any(String), 'mine'])
    const stored = await getGroupsState()
    expect(stored.available.find((g) => g.id === 'mine')).toEqual(before)
    expect(before).toMatchObject({ name: 'My research', note: 'private note', starred: true, windows: mine.windows })
    expect(stored.available.some((g) => g.tourDemo)).toBe(false)
  })

  it('is safe with nothing to remove: no change', async () => {
    await seed([real('a')])
    const before = await getGroupsState()
    const { changed } = await removeTourDemoGroups()
    expect(changed).toBe(false)
    expect((await getGroupsState()).available).toEqual(before.available)
  })

  it('moves the active group to Now Open when it was a practice group', async () => {
    await seed([real('a')])
    await ensureTourDemoGroups()
    const s = await getGroupsState()
    const idx = s.available.findIndex((g) => g.id === TOUR_DEMO_MAIN_ID)
    await saveGroupsState({ ...s, active: { id: TOUR_DEMO_MAIN_ID, index: idx } })
    const { state } = await removeTourDemoGroups()
    expect(state.active.id).toBe(state.available[0].id)
    expect(state.active.index).toBe(0)
  })

  it('also removes a practice group recognised only by its fixed id', async () => {
    await seed([real('a'), real(TOUR_DEMO_MAIN_ID, { tourDemo: undefined })])
    const { changed, state } = await removeTourDemoGroups()
    expect(changed).toBe(true)
    expect(state.available.map((g) => g.id)).not.toContain(TOUR_DEMO_MAIN_ID)
  })
})

describe('search visibility of the stored practice groups', () => {
  it('is hidden from search except while a tour search step is up', async () => {
    await seed([real('a')])
    await ensureTourDemoGroups()
    const { available } = await getGroupsState()
    const demo = available.find((g) => g.id === TOUR_DEMO_MAIN_ID)!
    const mine = available.find((g) => g.id === 'a')!
    expect(isHiddenFromSearch(demo)).toBe(true)
    expect(isHiddenFromSearch(mine)).toBe(false)
    setTourSearchShowsDemo(true)
    expect(isHiddenFromSearch(demo)).toBe(false)
  })
})
