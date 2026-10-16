import { describe, it, expect } from 'vitest'
import { savedDataChanged, savedDataFingerprint } from '@/lib/savedData'
import type { Group, GroupsState } from '@/lib/types'

/**
 * Cost of deciding, on every groups write, what the broadcast tells other contexts. The Now Open
 * mirror writes on every tab event in every open TabMerger page, so this runs on the hottest
 * write path, inside the write lock.
 *  - before: `savedDataFingerprint(stored)` on every write (a serialisation of every saved group);
 *  - now: `savedDataChanged(fresh read, fn's result)`, which skips the untouched groups by reference.
 */
function bigStore(groups = 200, tabsPerGroup = 50): GroupsState {
  const tab = (g: number, t: number) => ({ id: 0, title: `Tab ${g}.${t} with a realistic title`, url: `https://example.com/${g}/${t}?q=${'x'.repeat(40)}`, savedAt: 1 })
  const group = (g: number): Group => ({
    id: `g${g}`,
    name: `Group ${g}`,
    color: 'rgba(0,0,0,1)',
    updatedAt: 1,
    windows: [{ id: 0, incognito: false, focused: false, tabs: Array.from({ length: tabsPerGroup }, (_, t) => tab(g, t)) }]
  })
  const nowOpen: Group = { id: 'now', name: 'Now Open', color: 'rgba(0,0,0,1)', updatedAt: 1, permanent: true, windows: [] }
  return { active: { id: 'now', index: 0 }, available: [nowOpen, ...Array.from({ length: groups }, (_, g) => group(g))] }
}

/** Median of `runs` timings of `fn`, in ms. */
function median(fn: () => unknown, runs = 15): number {
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    fn()
    times.push(performance.now() - t0)
  }
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)]
}

describe('broadcast cost on a Now Open-only write (200 groups x 50 tabs)', () => {
  it('the reference check is far cheaper than fingerprinting every write', () => {
    const current = bigStore()
    // what the Now Open mirror returns: a new Now Open, every saved group the same object
    const next: GroupsState = { ...current, available: [{ ...current.available[0], windows: [{ id: 1, incognito: false, focused: false, tabs: [] }] }, ...current.available.slice(1)] }
    expect(savedDataChanged(current, next)).toBe(false)

    const before = median(() => savedDataFingerprint(next))
    const after = median(() => savedDataChanged(current, next))
    console.info(`[bench] fingerprint per write: ${before.toFixed(3)} ms; savedUnchanged check: ${after.toFixed(3)} ms`)
    expect(after * 10).toBeLessThan(before)
  })

  it('a write that changed one saved group compares only that group by content', () => {
    const current = bigStore()
    const next: GroupsState = { ...current, available: current.available.map((g, i) => (i === 5 ? { ...g, name: 'renamed' } : g)) }
    expect(savedDataChanged(current, next)).toBe(true)
    const t = median(() => savedDataChanged(current, next))
    console.info(`[bench] one saved group changed: ${t.toFixed(3)} ms`)
  })
})
