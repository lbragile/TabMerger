import { describe, it, expect, beforeEach, vi } from 'vitest'

const m = vi.hoisted(() => ({ state: { current: null as unknown as { active: { id: string; index: number }; available: Array<Record<string, unknown>> } }, writes: 0 }))
vi.mock('@/lib/localDb', () => ({
  // Same contract as the real one: null from the updater means "no write"
  updateGroupsState: vi.fn(async (fn: (s: typeof m.state.current) => typeof m.state.current | null) => {
    const next = fn(m.state.current)
    if (next) {
      m.state.current = next
      m.writes++
    }
    return m.state.current
  }),
}))

import {
  buildTourDemoGroups,
  ensureTourDemoGroups,
  isTourDemoEntry,
  removeTourDemoGroups,
  resetTourDemoGroups,
  withTourDemoGroups,
  withoutTourDemo,
} from '@/lib/tourDemo'

const real = (id: string) => ({ id, name: id, color: 'c', updatedAt: 0, windows: [] })
const now = { ...real('now'), permanent: true }

beforeEach(() => {
  m.writes = 0
  m.state.current = { active: { id: 'now', index: 0 }, available: [now, real('a')] }
})

describe('tourDemo pure helpers', () => {
  it('builds two flagged, unsynced groups with the shared timestamp', () => {
    const groups = buildTourDemoGroups(5)
    expect(groups.map((g) => g.id)).toEqual(['tour-demo-1', 'tour-demo-2'])
    expect(groups.every((g) => g.tourDemo && g.pendingSync === false && g.updatedAt === 5)).toBe(true)
  })

  it('isTourDemoEntry: flag or fixed id, never permanent', () => {
    expect(isTourDemoEntry({ id: 'x', tourDemo: true })).toBe(true)
    expect(isTourDemoEntry({ id: 'tour-demo-2' })).toBe(true)
    expect(isTourDemoEntry({ id: 'x' })).toBe(false)
    expect(isTourDemoEntry({ id: 'tour-demo-1', permanent: true })).toBe(false)
  })

  it('withTourDemoGroups appends after real groups, or returns null when complete', () => {
    const s = { active: { id: 'now', index: 0 }, available: [now as never, real('a') as never] }
    const out = withTourDemoGroups(s, 1)!
    expect(out.available.map((g) => g.id)).toEqual(['now', 'a', 'tour-demo-1', 'tour-demo-2'])
    expect(withTourDemoGroups(out)).toBeNull()
  })

  it('withoutTourDemo returns null with none, keeps an active real group, falls back to the first otherwise', () => {
    const plain = { active: { id: 'a', index: 1 }, available: [now as never, real('a') as never] }
    expect(withoutTourDemo(plain)).toBeNull()
    const withDemo = withTourDemoGroups(plain)!
    expect(withoutTourDemo(withDemo)!.active).toEqual({ id: 'a', index: 1 })
    expect(withoutTourDemo({ ...withDemo, active: { id: 'tour-demo-1', index: 2 } })!.active).toEqual({ id: 'now', index: 0 })
    expect(withoutTourDemo({ active: { id: 'tour-demo-1', index: 0 }, available: [buildTourDemoGroups()[0]] })!.active).toEqual({ id: '', index: 0 })
  })
})

describe('tourDemo writes through the groups write queue', () => {
  it('ensure writes once, then reports unchanged', async () => {
    expect((await ensureTourDemoGroups()).changed).toBe(true)
    expect((await ensureTourDemoGroups()).changed).toBe(false)
    expect(m.writes).toBe(1)
  })

  it('reset always replaces the practice data', async () => {
    await ensureTourDemoGroups()
    const { changed, state } = await resetTourDemoGroups()
    expect(changed).toBe(true)
    expect(state.available.filter((g) => g.tourDemo)).toHaveLength(2)
    expect(m.writes).toBe(2)
  })

  it('remove clears practice data and is a no-op when there is none', async () => {
    expect((await removeTourDemoGroups()).changed).toBe(false)
    await ensureTourDemoGroups()
    const { changed, state } = await removeTourDemoGroups()
    expect(changed).toBe(true)
    expect(state.available.map((g) => g.id)).toEqual(['now', 'a'])
  })
})
