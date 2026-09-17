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
    expect(selectionRange(state, { type: 'group', id: 'group-1' }, { type: 'group', id: 'group-2' })).toEqual([])
    expect(selectionRange(state, { type: 'tab', id: 'garbage' }, T(1, 0, 0))).toEqual([])
  })
})
