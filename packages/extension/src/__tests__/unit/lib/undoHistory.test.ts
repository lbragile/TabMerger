import { describe, it, expect } from 'vitest'
import { savedDataChanged } from '@/lib/undoHistory'
import type { Group, GroupsState } from '@/lib/types'

const group = (id: string, over: Partial<Group> = {}): Group => ({
  id,
  name: id,
  color: 'rgba(0,0,0,1)',
  updatedAt: 1,
  windows: [{ id: 0, incognito: false, focused: false, tabs: [{ id: 0, title: id, url: `https://example.com/${id}` }] }],
  ...over
})
const state = (available: Group[]): GroupsState => ({ active: { id: available[0]?.id ?? '', index: 0 }, available })
const nowOpen = (over: Partial<Group> = {}) => group('now', { permanent: true, ...over })

describe('savedDataChanged — the one rule for "this write is an undo step"', () => {
  it('the same object is no change', () => {
    const s = state([nowOpen(), group('a')])
    expect(savedDataChanged(s, s)).toBe(false)
  })

  it('a new state with identical saved groups (references kept) is no change', () => {
    const s = state([nowOpen(), group('a')])
    expect(savedDataChanged(s, { ...s, available: [...s.available] })).toBe(false)
  })

  it('a content change in a saved group is a change', () => {
    const s = state([nowOpen(), group('a')])
    const next = state([s.available[0], { ...s.available[1], name: 'renamed' }])
    expect(savedDataChanged(s, next)).toBe(true)
  })

  it('a group added, removed or reordered is a change', () => {
    const s = state([nowOpen(), group('a'), group('b')])
    expect(savedDataChanged(s, state([...s.available, group('c')]))).toBe(true)
    expect(savedDataChanged(s, state(s.available.slice(0, 2)))).toBe(true)
    expect(savedDataChanged(s, state([s.available[0], s.available[2], s.available[1]]))).toBe(true)
  })

  it('a Now Open-only change is no change (Now Open is never restored from history)', () => {
    const s = state([nowOpen(), group('a')])
    const next = state([nowOpen({ windows: [] }), s.available[1]])
    expect(savedDataChanged(s, next)).toBe(false)
  })

  it('sync bookkeeping and the derived info line alone are no change', () => {
    const s = state([nowOpen(), group('a')])
    const restamped = { ...s.available[1], updatedAt: 99, pendingSync: true, positionDirty: true, remoteUpdatedAt: '2026-10-15', info: '1 tab' }
    expect(savedDataChanged(s, state([s.available[0], restamped]))).toBe(false)
  })

  it('tolerates a state with no available list', () => {
    const broken = { active: { id: '', index: 0 } } as unknown as GroupsState
    expect(savedDataChanged(broken, state([nowOpen()]))).toBe(false)
    expect(savedDataChanged(broken, state([nowOpen(), group('a')]))).toBe(true)
  })
})
