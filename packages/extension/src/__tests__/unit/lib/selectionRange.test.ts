/**
 * selectionRange.test.ts — Shift+click range for the popup selection (legacy positional
 * ids). A TAB range may span windows of the same group (visual order), never groups.
 */
import { describe, it, expect } from 'vitest'
import { selectionRange } from '@/lib/selectionRange'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

const tab = (t: string): Tab => ({ id: 0, title: t, url: `https://e.x/${t}` })
const win = (tabs: Tab[]): ExtWindow => ({ id: 0, tabs, incognito: false, focused: false })
const group = (id: string, windows: ExtWindow[]): Group => ({ id, name: id, color: 'rgba(0,0,0,1)', updatedAt: 0, windows })

const state: GroupsState = {
  active: { id: 'now', index: 0 },
  available: [
    group('now', [win([tab('l1')])]),
    group('work', [win([tab('a1'), tab('a2'), tab('a3')]), win([tab('b1'), tab('b2')]), win([tab('c1')])])
  ]
}
const T = (gi: number, wi: number, ti: number) => ({ type: 'tab' as const, id: `tab-${gi}-${wi}-${ti}` })
const W = (gi: number, wi: number) => ({ type: 'window' as const, id: `window-${gi}-${wi}` })

describe('selectionRange', () => {
  it('tabs in one window, anchor → target inclusive', () => {
    expect(selectionRange(state, T(1, 0, 0), T(1, 0, 2))).toEqual([T(1, 0, 0), T(1, 0, 1), T(1, 0, 2)])
  })

  it('works backwards (target above the anchor) and returns visual order', () => {
    expect(selectionRange(state, T(1, 0, 2), T(1, 0, 1))).toEqual([T(1, 0, 1), T(1, 0, 2)])
  })

  it('a TAB range spans windows of the same group in visual order', () => {
    expect(selectionRange(state, T(1, 0, 2), T(1, 2, 0))).toEqual([T(1, 0, 2), T(1, 1, 0), T(1, 1, 1), T(1, 2, 0)])
  })

  it('window ranges', () => {
    expect(selectionRange(state, W(1, 2), W(1, 0))).toEqual([W(1, 0), W(1, 1), W(1, 2)])
  })

  it('no usable anchor → [] (none, other type, other group, stale anchor, missing group, groups)', () => {
    expect(selectionRange(state, null, T(1, 0, 0))).toEqual([])
    expect(selectionRange(state, W(1, 0), T(1, 0, 0))).toEqual([])
    expect(selectionRange(state, T(0, 0, 0), T(1, 0, 0))).toEqual([])
    expect(selectionRange(state, T(1, 5, 0), T(1, 0, 0))).toEqual([])
    expect(selectionRange(state, T(7, 0, 0), T(7, 0, 1))).toEqual([])
    expect(selectionRange(undefined, T(1, 0, 0), T(1, 0, 1))).toEqual([])
    expect(selectionRange(state, { type: 'tab', id: 'garbage' }, T(1, 0, 0))).toEqual([])
  })
})

/**
 * 2a — sidebar GROUP ranges. Groups run down `state.available`, not the windows panel,
 * and the permanent "Now Open" row can never be part of a selection (nothing you can do
 * to a selection is legal for it).
 */
describe('selectionRange — groups', () => {
  const G = (gi: number) => ({ type: 'group' as const, id: `group-${gi}` })
  const sidebar: GroupsState = {
    active: { id: 'now', index: 0 },
    available: [
      { ...group('now', []), permanent: true },
      group('a', []),
      group('b', []),
      { ...group('arch', []), archived: true },
      group('c', [])
    ]
  }

  it('selects an inclusive run down the sidebar', () => {
    expect(selectionRange(sidebar, G(1), G(2))).toEqual([G(1), G(2)])
  })

  it('works backwards and returns sidebar order', () => {
    expect(selectionRange(sidebar, G(4), G(1))).toEqual([G(1), G(2), G(4)])
  })

  it('never includes "Now Open", even when it is between the two ends', () => {
    // Now Open isn't in the ordered list at all, so it can be neither end nor a member.
    expect(selectionRange(sidebar, G(0), G(2))).toEqual([])
    expect(selectionRange(sidebar, G(2), G(0))).toEqual([])
    expect(selectionRange(sidebar, G(1), G(4)).some((s) => s.id === 'group-0')).toBe(false)
  })

  it('skips archived groups (they are not in the sortable list)', () => {
    expect(selectionRange(sidebar, G(2), G(4))).toEqual([G(2), G(4)])
    expect(selectionRange(sidebar, G(3), G(4))).toEqual([])
  })

  it('needs a same-type anchor and a real state', () => {
    expect(selectionRange(sidebar, null, G(1))).toEqual([])
    expect(selectionRange(sidebar, W(1, 0), G(1))).toEqual([])
    expect(selectionRange(undefined, G(1), G(2))).toEqual([])
    expect(selectionRange(sidebar, G(9), G(1))).toEqual([])
  })
})
