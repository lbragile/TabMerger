import { describe, it, expect } from 'vitest'
import { alignToBase } from '@/lib/groupsAlign'
import type { Group, GroupsState } from '@/lib/types'

const g = (id: string): Group => ({ id, name: id, color: '#fff', updatedAt: 1, windows: [], permanent: false, starred: false })
const state = (...ids: string[]): GroupsState => ({ active: { id: ids[0], index: 0 }, available: ids.map(g) })

describe('alignToBase', () => {
  it('returns the fresh state untouched when there is no base or the order already matches', () => {
    const fresh = state('now', 'a', 'b')
    expect(alignToBase(undefined, fresh)).toBe(fresh)
    expect(alignToBase(state('now', 'a', 'b'), fresh)).toBe(fresh)
  })

  it('re-addresses the fresh groups to the base order so a base index still means the same group', () => {
    const out = alignToBase(state('now', 'a', 'b', 'c'), state('now', 'c', 'a', 'b'))!
    expect(out.available.map((x) => x.id)).toEqual(['now', 'a', 'b', 'c'])
  })

  it('appends groups that appeared after the base, keeping fresh content', () => {
    const fresh = state('now', 'a', 'new')
    fresh.available[1] = { ...fresh.available[1], name: 'fresh content' }
    const out = alignToBase(state('now', 'a'), fresh)!
    expect(out.available.map((x) => x.id)).toEqual(['now', 'a', 'new'])
    expect(out.available[1].name).toBe('fresh content')
  })

  it('returns null when a group the user was looking at is gone', () => {
    expect(alignToBase(state('now', 'a', 'b'), state('now', 'b'))).toBeNull()
  })
})

import { restoreFreshOrder, markAborted, wasAborted } from '@/lib/groupsAlign'

describe('restoreFreshOrder', () => {
  const ids = (s: GroupsState) => s.available.map((x) => x.id)

  it('keeps the fresh order when the mutation did not reorder (updates by id)', () => {
    const fresh = state('now', 'c', 'a', 'b')
    const aligned = alignToBase(state('now', 'a', 'b', 'c'), fresh)!
    const result = { ...aligned, available: aligned.available.map((x) => (x.id === 'a' ? { ...x, name: 'A2' } : x)) }
    const out = restoreFreshOrder(fresh, aligned, result)
    expect(ids(out)).toEqual(['now', 'c', 'a', 'b'])
    expect(out.available.find((x) => x.id === 'a')?.name).toBe('A2')
  })

  it('drops removed groups and slots a new group after its predecessor', () => {
    const fresh = state('now', 'c', 'a', 'b')
    const aligned = alignToBase(state('now', 'a', 'b', 'c'), fresh)!
    const result = { ...aligned, available: [aligned.available[0], aligned.available[1], g('dup'), aligned.available[3]] } // b removed, dup after a
    expect(ids(restoreFreshOrder(fresh, aligned, result))).toEqual(['now', 'c', 'a', 'dup'])
  })

  it('uses the result order when the mutation itself reordered', () => {
    const fresh = state('now', 'c', 'a', 'b')
    const aligned = alignToBase(state('now', 'a', 'b', 'c'), fresh)!
    const result = { ...aligned, available: [aligned.available[0], aligned.available[2], aligned.available[1], aligned.available[3]] }
    expect(ids(restoreFreshOrder(fresh, aligned, result))).toEqual(ids(result))
  })

  it('markAborted flags a state object', () => {
    const s = state('now')
    expect(wasAborted(s)).toBe(false)
    markAborted(s)
    expect(wasAborted(s)).toBe(true)
  })
})
