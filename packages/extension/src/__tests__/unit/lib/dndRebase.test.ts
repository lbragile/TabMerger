/**
 * dndRebase.test.ts — pure re-resolution of a drag's positional ids (taken from the
 * drag-start snapshot) in the CURRENT groups state. See `@/lib/dndRebase`.
 */
import { describe, it, expect } from 'vitest'
import { rebaseMove } from '@/lib/dndRebase'
import { buildDndModel } from '@/hooks/useDndModel'
import { applyMove, type DndRef } from '@/lib/dndMove'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

const tab = (title: string, over: Partial<Tab> = {}): Tab => ({ id: 0, title, url: `https://example.com/${title}`, ...over })
const win = (tabs: Tab[], over: Partial<ExtWindow> = {}): ExtWindow => ({ id: 0, tabs, incognito: false, focused: false, ...over })
const group = (id: string, windows: ExtWindow[], over: Partial<Group> = {}): Group => ({
  id,
  name: id,
  color: 'rgba(0,0,0,1)',
  updatedAt: 1,
  windows,
  ...over
})
const state = (available: Group[]): GroupsState => ({ active: { id: available[0].id, index: 0 }, available })

function run(snap: GroupsState, cur: GroupsState, active: DndRef, over: DndRef) {
  return rebaseMove(snap, buildDndModel(snap), cur, buildDndModel(cur), active, over)
}

describe('rebaseMove', () => {
  it('same state object → refs returned untouched', () => {
    const s = state([group('g', [win([tab('a')])])])
    const a: DndRef = { type: 'tab', id: 'g::w0::t0' }
    const o: DndRef = { type: 'group', id: 'g', index: 0 }
    expect(run(s, s, a, o)).toEqual({ active: a, over: o, removed: 0 })
  })

  it('an unchanged group object maps positionally; a group ref gets its CURRENT index', () => {
    const g = group('g', [win([tab('a'), tab('b')])])
    const h = group('h', [win([tab('x')])])
    const snap = state([group('now', [], { permanent: true }), g, h])
    const cur = state([group('now', [], { permanent: true }), group('new', []), g, h])
    const res = run(snap, cur, { type: 'tab', id: 'g::w0::t1' }, { type: 'group', id: 'h', index: 2 })
    expect(res!.active.id).toBe('g::w0::t1')
    expect(res!.over).toMatchObject({ id: 'h', index: 3 })
  })

  it('WINDOW refs: found by their tab URLs at a new position; a vanished window → null', () => {
    const snap = state([group('g', [win([tab('a')]), win([tab('b'), tab('c')])])])
    const moved = state([group('g', [win([tab('z')]), win([tab('a')]), win([tab('b'), tab('c')])], { updatedAt: 9 })])
    expect(run(snap, moved, { type: 'window', id: 'g::w1' }, { type: 'window', id: 'g::w0' })).toMatchObject({
      active: { id: 'g::w2' },
      over: { id: 'g::w1', index: undefined }
    })
    const gone = state([group('g', [win([tab('a')]), win([tab('b')])], { updatedAt: 9 })])
    expect(run(snap, gone, { type: 'window', id: 'g::w1' }, { type: 'window', id: 'g::w0' })).toBeNull()
  })

  it('LIVE Now Open items match by real browser id even when their URL/position changed', () => {
    const snap = state([group('now', [win([tab('x', { id: 5 }), tab('y', { id: 6 })], { id: 70 })], { permanent: true }), group('g', [])])
    const cur = state([
      group('now', [win([tab('y', { id: 6 })], { id: 70 }), win([tab('x-redirected', { id: 5 })], { id: 71 })], { permanent: true }),
      group('g', [])
    ])
    const res = run(snap, cur, { type: 'tab', id: 'now::w0::t0' }, { type: 'group', id: 'g' })
    expect(res!.active.id).toBe('now::w1::t0')
    const w = run(snap, cur, { type: 'window', id: 'now::w0' }, { type: 'group', id: 'g' })
    expect(w!.active.id).toBe('now::w0')
  })

  it('duplicate-URL selected tabs map to DISTINCT current tabs; a DELETED one is dropped and counted', () => {
    const snap = state([group('g', [win([tab('m'), tab('d'), tab('d'), tab('e')])]), group('h', [])])
    const cur = state([group('g', [win([tab('m'), tab('d'), tab('d')])], { updatedAt: 9 }), group('h', [])])
    const res = run(
      snap,
      cur,
      { type: 'tab', id: 'g::w0::t1', selectionIds: ['g::w0::t1', 'g::w0::t2', 'g::w0::t3'] },
      { type: 'group', id: 'h' }
    )
    expect(res!.active.id).toBe('g::w0::t1')
    // e vanished and nothing new appeared that could be its edited form → the two distinct d's move
    expect(res!.active.selectionIds).toEqual(['g::w0::t1', 'g::w0::t2'])
    expect(res!.removed).toBe(1)
  })

  describe('#17 a selection member that vanished: deleted (drop it) vs possibly EDITED (cancel)', () => {
    const snap = state([group('g', [win([tab('a'), tab('b'), tab('c')])]), group('h', [])])
    const drag = (cur: GroupsState) =>
      run(snap, cur, { type: 'tab', id: 'g::w0::t0', selectionIds: ['g::w0::t0', 'g::w0::t1', 'g::w0::t2'] }, { type: 'group', id: 'h' })

    it('deleted elsewhere (nothing new in its group) → excluded, the rest still move, removed = 1', () => {
      const res = drag(state([group('g', [win([tab('a'), tab('c')])], { updatedAt: 9 }), group('h', [])]))
      expect(res!.active.selectionIds).toEqual(['g::w0::t0', 'g::w0::t1'])
      expect(res!.removed).toBe(1)
    })

    it('renamed elsewhere (a customTitle appeared) → it may be the same tab → the whole drop cancels', () => {
      expect(drag(state([group('g', [win([tab('a'), tab('b', { customTitle: 'Mine' }), tab('c')])], { updatedAt: 9 }), group('h', [])]))).toBeNull()
    })

    it('a selected WINDOW that gained a tab elsewhere → cancel; a selected window deleted → excluded', () => {
      const wsnap = state([group('g', [win([tab('a')]), win([tab('b')]), win([tab('c')])]), group('h', [])])
      const wdrag = (cur: GroupsState) =>
        run(wsnap, cur, { type: 'window', id: 'g::w0', selectionIds: ['g::w0', 'g::w1', 'g::w2'] }, { type: 'group', id: 'h' })
      expect(wdrag(state([group('g', [win([tab('a')]), win([tab('b'), tab('x')]), win([tab('c')])], { updatedAt: 9 }), group('h', [])]))).toBeNull()
      const res = wdrag(state([group('g', [win([tab('a')]), win([tab('c')])], { updatedAt: 9 }), group('h', [])]))
      expect(res!.active.selectionIds).toEqual(['g::w0', 'g::w1'])
      expect(res!.removed).toBe(1)
    })

    it("a member whose whole group was deleted counts as deleted", () => {
      const two = state([group('g', [win([tab('a')])]), group('k', [win([tab('b')])]), group('h', [])])
      const cur = state([group('g', [win([tab('a')])]), group('h', [])])
      const res = run(two, cur, { type: 'tab', id: 'g::w0::t0', selectionIds: ['g::w0::t0', 'k::w0::t0'] }, { type: 'group', id: 'h' })
      expect(res!.active.selectionIds).toBeUndefined()
      expect(res!.removed).toBe(1)
    })
  })

  describe('#15 a PERMUTATION of look-alike items mid-drag (rank alone would silently pick the wrong one)', () => {
    it('two same-URL windows "Research"/"Backup" swapped (e.g. a star toggle re-sort) → the NAMED window still moves', () => {
      const snap = state([group('g', [win([tab('a')], { name: 'Research' }), win([tab('a')], { name: 'Backup' })]), group('h', [])])
      const cur = state([group('g', [win([tab('a')], { name: 'Backup' }), win([tab('a')], { name: 'Research' })], { updatedAt: 9 }), group('h', [])])
      expect(run(snap, cur, { type: 'window', id: 'g::w0' }, { type: 'group', id: 'h' })!.active.id).toBe('g::w1')
    })

    it('two IDENTICAL windows reordered relative to the rest of the group → clean cancel', () => {
      const snap = state([group('g', [win([tab('a')]), win([tab('x')]), win([tab('a')])]), group('h', [])])
      const cur = state([group('g', [win([tab('x')]), win([tab('a')]), win([tab('a')])], { updatedAt: 9 }), group('h', [])])
      expect(run(snap, cur, { type: 'window', id: 'g::w0' }, { type: 'group', id: 'h' })).toBeNull()
      expect(run(snap, cur, { type: 'window', id: 'g::w2' }, { type: 'group', id: 'h' })).toBeNull()
    })

    it('same-identity TABS reordered (same savedAt batch) → clean cancel, as the drag item AND as the target', () => {
      const snap = state([group('g', [win([tab('d', { savedAt: 5 }), tab('x', { savedAt: 5 }), tab('d', { savedAt: 5 })])]), group('h', [win([tab('y')])])])
      const cur = state([group('g', [win([tab('x', { savedAt: 5 }), tab('d', { savedAt: 5 }), tab('d', { savedAt: 5 })])], { updatedAt: 9 }), group('h', [win([tab('y')])])])
      expect(run(snap, cur, { type: 'tab', id: 'g::w0::t0' }, { type: 'group', id: 'h' })).toBeNull()
      expect(run(snap, cur, { type: 'tab', id: 'h::w0::t0' }, { type: 'tab', id: 'g::w0::t0' })).toBeNull()
    })

    it('a look-alike tab that moved to ANOTHER window (window swap) → clean cancel', () => {
      const snap = state([group('g', [win([tab('d')], { name: 'A' }), win([tab('d')], { name: 'B' })]), group('h', [])])
      const cur = state([group('g', [win([tab('d')], { name: 'B' }), win([tab('d')], { name: 'A' })], { updatedAt: 9 }), group('h', [])])
      expect(run(snap, cur, { type: 'tab', id: 'g::w0::t0' }, { type: 'group', id: 'h' })).toBeNull()
    })

    it('an UNRELATED change elsewhere in the group (edit + reorder of other items) → the duplicate still commits', () => {
      const snap = state([group('g', [win([tab('d'), tab('x'), tab('d')]), win([tab('p'), tab('q')])]), group('h', [])])
      const cur = state([
        group('g', [win([tab('d'), tab('x'), tab('d')]), win([tab('q', { note: 'edited' }), tab('p'), tab('new')])], { updatedAt: 9 }),
        group('h', [])
      ])
      expect(run(snap, cur, { type: 'tab', id: 'g::w0::t2' }, { type: 'group', id: 'h' })!.active.id).toBe('g::w0::t2')
    })

    it('a unique identity never needs context: an insert right next to it still commits', () => {
      const snap = state([group('g', [win([tab('a'), tab('b')])]), group('h', [])])
      const cur = state([group('g', [win([tab('a'), tab('new'), tab('b')])], { updatedAt: 9 }), group('h', [])])
      expect(run(snap, cur, { type: 'tab', id: 'g::w0::t1' }, { type: 'group', id: 'h' })!.active.id).toBe('g::w0::t2')
    })
  })

  it('a selection reduced to ONE surviving item becomes a single-item ref', () => {
    const snap = state([group('g', [win([tab('a'), tab('b')])]), group('h', [])])
    const cur = state([group('g', [win([tab('a')])], { updatedAt: 9 }), group('h', [])])
    const res = run(snap, cur, { type: 'tab', id: 'g::w0::t0', selectionIds: ['g::w0::t0', 'g::w0::t1'] }, { type: 'group', id: 'h' })
    expect(res!.active.selectionIds).toBeUndefined()
  })

  it('the new-window zone resolves to its group\'s CURRENT index; a deleted group → null', () => {
    const g = group('g', [win([tab('a'), tab('b')])])
    const snap = state([group('now', [], { permanent: true }), g])
    const cur = state([group('now', [], { permanent: true }), group('x', []), g])
    const over: DndRef = { type: 'new-window', id: 'g::new-window', groupId: 'g', groupIndex: 1 }
    expect(run(snap, cur, { type: 'tab', id: 'g::w0::t0' }, over)!.over).toMatchObject({ groupIndex: 2 })
    const deleted = state([group('now', [], { permanent: true }), group('x', [win([tab('a')])])])
    expect(run(snap, deleted, { type: 'tab', id: 'x::w0::t0' }, over)).toBeNull()
  })

  describe('duplicate identities under a SHIFT (occurrence rank, not nearest position)', () => {
    it('same window: [d(A), x, d(B)] + an insert at the top → dragging B still moves B, not A', () => {
      const snap = state([group('g', [win([tab('d'), tab('x'), tab('d')])]), group('h', [])])
      const cur = state([group('g', [win([tab('n'), tab('d'), tab('x'), tab('d')])], { updatedAt: 9 }), group('h', [])])
      const res = run(snap, cur, { type: 'tab', id: 'g::w0::t2' }, { type: 'group', id: 'h' })
      expect(res!.active.id).toBe('g::w0::t3')
    })

    it('across windows: a window prepended mid-drag does NOT take the duplicate out of the wrong window (and never prunes it)', () => {
      // snapshot: w0 = [d] (its only tab), w1 = [x, d]; the user drags w1's d onto group h
      const snap = state([group('g', [win([tab('d')]), win([tab('x'), tab('d')])]), group('h', [])])
      const cur = state([
        group('g', [win([tab('n')]), win([tab('d')]), win([tab('x'), tab('d')])], { updatedAt: 9 }),
        group('h', [])
      ])
      const snapModel = buildDndModel(snap)
      const curModel = buildDndModel(cur)
      const res = rebaseMove(snap, snapModel, cur, curModel, { type: 'tab', id: 'g::w1::t1' }, { type: 'group', id: 'h' })
      expect(res!.active.id).toBe('g::w2::t1')

      const { next } = applyMove(curModel, cur, res!.active, res!.over)
      const titles = (id: string) => next.available.find((gr) => gr.id === id)!.windows.map((w) => w.tabs.map((t) => t.title))
      // the lone-d window (now w1) keeps its tab and still exists
      expect(titles('g')).toEqual([['n'], ['d'], ['x']])
      expect(titles('h')).toEqual([['d']])
    })

    it('identity includes savedAt/customTitle: two same-URL tabs that swapped places map to the right one', () => {
      const snap = state([group('g', [win([tab('d', { savedAt: 1 }), tab('d', { savedAt: 2 })])]), group('h', [])])
      const cur = state([
        group('g', [win([tab('n'), tab('d', { savedAt: 2 }), tab('d', { savedAt: 1 })])], { updatedAt: 9 }),
        group('h', [])
      ])
      expect(run(snap, cur, { type: 'tab', id: 'g::w0::t1' }, { type: 'group', id: 'h' })!.active.id).toBe('g::w0::t1')
      const renamed = state([group('g', [win([tab('d', { customTitle: 'Mine' }), tab('d')])], { updatedAt: 9 }), group('h', [])])
      const snap2 = state([group('g', [win([tab('d'), tab('d', { customTitle: 'Mine' })])]), group('h', [])])
      expect(run(snap2, renamed, { type: 'tab', id: 'g::w0::t1' }, { type: 'group', id: 'h' })!.active.id).toBe('g::w0::t0')
    })

    it('saved WINDOWS with the same URL list are matched by rank too', () => {
      const snap = state([group('g', [win([tab('a')]), win([tab('b')]), win([tab('a')])]), group('h', [])])
      const cur = state([group('g', [win([tab('z')]), win([tab('a')]), win([tab('b')]), win([tab('a')])], { updatedAt: 9 }), group('h', [])])
      expect(run(snap, cur, { type: 'window', id: 'g::w2' }, { type: 'group', id: 'h' })!.active.id).toBe('g::w3')
    })

    it('the COUNT of the dragged identity changed → which one survived is unknowable → clean cancel (null)', () => {
      const snap = state([group('g', [win([tab('d'), tab('x'), tab('d')])]), group('h', [])])
      const fewer = state([group('g', [win([tab('d'), tab('x')])], { updatedAt: 9 }), group('h', [])])
      const more = state([group('g', [win([tab('d'), tab('x'), tab('d'), tab('d')])], { updatedAt: 9 }), group('h', [])])
      expect(run(snap, fewer, { type: 'tab', id: 'g::w0::t2' }, { type: 'group', id: 'h' })).toBeNull()
      expect(run(snap, more, { type: 'tab', id: 'g::w0::t2' }, { type: 'group', id: 'h' })).toBeNull()
      // the TARGET's count changed → cancel too
      expect(run(snap, fewer, { type: 'tab', id: 'g::w0::t1' }, { type: 'tab', id: 'g::w0::t2' })).toBeNull()
    })

    it('a SELECTION member whose identity count changed (but not to zero) cancels the drop instead of guessing', () => {
      const snap = state([group('g', [win([tab('a'), tab('d'), tab('d')])]), group('h', [])])
      const cur = state([group('g', [win([tab('a'), tab('d')])], { updatedAt: 9 }), group('h', [])])
      const res = run(
        snap,
        cur,
        { type: 'tab', id: 'g::w0::t0', selectionIds: ['g::w0::t0', 'g::w0::t1', 'g::w0::t2'] },
        { type: 'group', id: 'h' }
      )
      expect(res).toBeNull()
    })

    it('ONE claim set for active + target: [d,d,d], drag t0 onto t2, insert at top → target is t3 (not the dragged t1)', () => {
      const snap = state([group('g', [win([tab('d'), tab('d'), tab('d')])])])
      const cur = state([group('g', [win([tab('n'), tab('d'), tab('d'), tab('d')])], { updatedAt: 9 })])
      const res = run(snap, cur, { type: 'tab', id: 'g::w0::t0' }, { type: 'tab', id: 'g::w0::t2' })
      expect(res!.active.id).toBe('g::w0::t1')
      expect(res!.over.id).toBe('g::w0::t3')
    })
  })

  it('ids unknown to the snapshot, a tab whose group was deleted, or a missing target tab → null', () => {
    const snap = state([group('g', [win([tab('a')])]), group('h', [win([tab('b')])])])
    const cur = state([group('h', [win([tab('b')])], { updatedAt: 9 })])
    expect(run(snap, cur, { type: 'tab', id: 'nope' }, { type: 'group', id: 'h' })).toBeNull()
    expect(run(snap, cur, { type: 'tab', id: 'g::w0::t0' }, { type: 'group', id: 'h' })).toBeNull()
    const cur2 = state([group('g', [win([tab('a')])]), group('h', [win([tab('c')])], { updatedAt: 9 })])
    expect(run(snap, cur2, { type: 'tab', id: 'g::w0::t0' }, { type: 'tab', id: 'h::w0::t0' })).toBeNull()
  })
})

/**
 * Third-audit LOW item (2026-09-16): a tab's REMINDER is part of its rebase identity.
 *
 * Two saved tabs with the same URL/title but different reminders used to share one
 * identity, so a mid-drag shift could resolve the drag onto the wrong one. The remaining
 * unshared fields (`favIconUrl`, `chromeGroup`) are cosmetic, so a wrong pick there can no
 * longer move or delete the wrong tab's user-visible content.
 */
describe('tab identity includes the reminder', () => {
  it('tells two otherwise-identical tabs apart, so a shift resolves the right one', () => {
    const early = tab('dup', { reminder: { fireAt: 1000 } })
    const late = tab('dup', { reminder: { fireAt: 2000 } })
    const snap = state([group('g', [win([early, late])])])
    // A tab is inserted above them mid-drag: positions shift by one.
    const cur = state([group('g', [win([tab('new'), early, late])], { updatedAt: 9 })])
    // The SECOND duplicate (t1 → t2) must still be the one with fireAt 2000.
    const res = run(snap, cur, { type: 'tab', id: 'g::w0::t1' }, { type: 'group', id: 'g' })
    expect(res!.active.id).toBe('g::w0::t2')
  })

  it('treats a reminder change as an EDIT, not the same tab', () => {
    const snap = state([group('g', [win([tab('x', { reminder: { fireAt: 1000 } })])]), group('h', [win([tab('y')])])])
    const cur = state([
      group('g', [win([tab('x', { reminder: { fireAt: 5555 } })])], { updatedAt: 9 }),
      group('h', [win([tab('y')])])
    ])
    // The snapshot tab no longer exists under that identity → the drop cancels.
    expect(run(snap, cur, { type: 'tab', id: 'g::w0::t0' }, { type: 'group', id: 'h' })).toBeNull()
  })

  it('a tab with no reminder is unaffected (identity stays stable across an untouched group)', () => {
    const snap = state([group('g', [win([tab('a'), tab('b')])]), group('h', [win([tab('z')])])])
    const cur = state([group('g', [win([tab('a'), tab('b')])], { updatedAt: 9 }), group('h', [win([tab('z')])])])
    const res = run(snap, cur, { type: 'tab', id: 'g::w0::t1' }, { type: 'group', id: 'h' })
    expect(res!.active.id).toBe('g::w0::t1')
  })
})

/**
 * 2b — the sidebar "new group" sentinel names no existing group, so it survives ANY
 * mid-drag change to the cache and never needs re-resolving.
 */
describe('the "new group" drop target', () => {
  it('rebases onto any current state without a model lookup', () => {
    const snap = state([group('g', [win([tab('a')])])])
    const cur = state([group('g', [win([tab('a')])], { updatedAt: 9 }), group('added', [win([tab('n')])])])
    const res = run(snap, cur, { type: 'tab', id: 'g::w0::t0' }, { type: 'new-group', id: '::new-group' })
    expect(res!.over).toEqual({ type: 'new-group', id: '::new-group', index: undefined, groupIndex: undefined })
    expect(res!.active.id).toBe('g::w0::t0')
  })
})
