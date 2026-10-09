/**
 * dndMoveGroupsMulti.test.ts — the two NEW move shapes in `@/lib/dndMove`:
 *
 *   2a — `moveGroupsMulti`: a multi-GROUP sidebar selection re-enters as ONE contiguous
 *        block at the gap, in the original relative order, never at index 0 / above
 *        "Now Open", as ONE undoable op.
 *
 *   2b — `moveToNewGroup`: the sidebar "drop here for a new group" zone. A tab lands in a
 *        new group holding one window; a window lands as the new group's window; a whole
 *        multi-selection lands in ONE new group; a Now Open source is COPIED (detached,
 *        `id: 0`, not undoable) and never closed.
 */
import { describe, it, expect } from 'vitest'
import { applyMove, canDrop, NEW_GROUP_ID } from '@/lib/dndMove'
import { buildDndModel } from '@/hooks/useDndModel'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

const tab = (t: string): Tab => ({ id: 0, title: t, url: `https://e.x/${t}` })
const liveTab = (id: number, t: string): Tab => ({ id, title: t, url: `https://live/${t}` })
const win = (tabs: Tab[], over: Partial<ExtWindow> = {}): ExtWindow => ({ id: 0, tabs, incognito: false, focused: false, ...over })
const group = (id: string, windows: ExtWindow[], over: Partial<Group> = {}): Group => ({
  id,
  name: id,
  color: 'rgba(0,0,0,1)',
  updatedAt: 0,
  windows,
  permanent: false,
  ...over
})

/** now(permanent, 1 live window) · a · b · c · d */
function seed(): GroupsState {
  return {
    active: { id: 'now', index: 0 },
    available: [
      group('now', [{ id: 700, tabs: [liveTab(11, 'live')], incognito: false, focused: false }], { permanent: true }),
      group('a', [win([tab('a1')])]),
      group('b', [win([tab('b1')])]),
      group('c', [win([tab('c1')])]),
      group('d', [win([tab('d1')])])
    ]
  }
}

const ids = (s: GroupsState) => s.available.map((g) => g.id)
const gref = (id: string, index: number) => ({ type: 'group' as const, id, index })

describe('moveGroupsMulti — multi-group sidebar reorder', () => {
  it('moves a NON-contiguous selection as one contiguous block in original order', () => {
    const s = seed()
    const m = buildDndModel(s)
    const res = applyMove(m, s, { ...gref('a', 1), selectionIds: ['a', 'c'] }, gref('d', 4))
    // a + c leave; the block re-enters where d sat (after the 2 non-moved groups now/b).
    expect(ids(res.next)).toEqual(['now', 'b', 'a', 'c', 'd'])
    expect(res.undoable).toBe(true)
    expect(res.sideEffects).toEqual([])
    // The drag ANCHOR stays active.
    expect(res.next.active.id).toBe('a')
    expect(res.next.active.index).toBe(2)
  })

  it('keeps the selection order taken from the SIDEBAR, not the order the ids arrive in', () => {
    const s = seed()
    const m = buildDndModel(s)
    const res = applyMove(m, s, { ...gref('c', 3), selectionIds: ['c', 'a'] }, gref('d', 4))
    expect(ids(res.next)).toEqual(['now', 'b', 'a', 'c', 'd'])
    expect(res.next.active.id).toBe('c')
  })

  it('NEVER lands above "Now Open": a drop on index 1 clamps the block to index 1', () => {
    const s = seed()
    const m = buildDndModel(s)
    const res = applyMove(m, s, { ...gref('c', 3), selectionIds: ['c', 'd'] }, gref('a', 1))
    expect(ids(res.next)).toEqual(['now', 'c', 'd', 'a', 'b'])
    expect(res.next.available[0].permanent).toBe(true)
  })

  it('refuses a block that contains the permanent group, and a drop on index 0', () => {
    const s = seed()
    const m = buildDndModel(s)
    expect(canDrop(m, { ...gref('a', 1), selectionIds: ['a', 'now'] }, gref('d', 4))).toBe(false)
    expect(canDrop(m, { ...gref('a', 1), selectionIds: ['a', 'c'] }, gref('now', 0))).toBe(false)
    // …and a selected group is never its own target.
    expect(canDrop(m, { ...gref('a', 1), selectionIds: ['a', 'c'] }, gref('c', 3))).toBe(false)
  })

  it('normalises the OTHER groups starred-first and then drops the block into its own zone', () => {
    const s = seed()
    s.available[3].starred = true // c is starred
    const m = buildDndModel(s)
    const res = applyMove(m, s, { ...gref('a', 1), selectionIds: ['a', 'b'] }, gref('d', 4))
    // c (starred) is lifted to the top of the saved zone as part of normalising the groups
    // the block is landing AMONG — never by re-sorting the list after the block went in,
    // which is what used to slide the block off the gap (spec §6.1).
    expect(ids(res.next)).toEqual(['now', 'c', 'a', 'b', 'd'])
  })

  it('refuses a block that spans the starred boundary rather than splitting it in two', () => {
    const s = seed()
    s.available[1].starred = true // a is starred, b/c/d are not
    const m = buildDndModel(s)
    const active = { ...gref('a', 1), selectionIds: ['a', 'b'] }
    expect(canDrop(m, active, gref('d', 4))).toBe(false)
    expect(applyMove(m, s, active, gref('d', 4)).next).toBe(s)
  })

  it('bumps every moved group so the move actually syncs', () => {
    const s = seed()
    const m = buildDndModel(s)
    const res = applyMove(m, s, { ...gref('a', 1), selectionIds: ['a', 'c'] }, gref('d', 4))
    for (const id of ['a', 'c']) {
      const g = res.next.available.find((x) => x.id === id)!
      expect(g.pendingSync).toBe(true)
      expect(g.updatedAt).toBeGreaterThan(0)
    }
    // Untouched groups keep their identity (no spurious sync churn). A merely shifted group
    // is flagged `positionDirty` by the groups write itself, never here.
    expect(res.next.available.find((x) => x.id === 'b')).toBe(s.available[2])
  })

  it('is a NOOP when a selected group no longer resolves (fail safe, never a partial reorder)', () => {
    const s = seed()
    const m = buildDndModel(s)
    const res = applyMove(m, s, { ...gref('a', 1), selectionIds: ['a', 'ghost'] }, gref('d', 4))
    // `dndRebase` is what drops deliberately-deleted members; an id that still can't be
    // resolved HERE means the drag and the cache disagree, so nothing commits.
    expect(res.next).toBe(s)
    expect(res.undoable).toBe(false)
  })
})

describe('moveToNewGroup — the sidebar "new group" drop zone', () => {
  const zone = { type: 'new-group' as const, id: NEW_GROUP_ID }

  it('accepts tab and window drags, and refuses group drags', () => {
    const s = seed()
    const m = buildDndModel(s)
    const tabId = m.groups.a.windowIds[0] && m.windows[m.groups.a.windowIds[0]].tabIds[0]
    expect(canDrop(m, { type: 'tab', id: tabId }, zone)).toBe(true)
    expect(canDrop(m, { type: 'window', id: m.groups.a.windowIds[0] }, zone)).toBe(true)
    expect(canDrop(m, gref('a', 1), zone)).toBe(false)
  })

  it('a TAB creates a new group holding ONE window with that tab; the emptied source window stays', () => {
    const s = seed()
    const m = buildDndModel(s)
    const tabId = m.windows[m.groups.a.windowIds[0]].tabIds[0]
    const res = applyMove(m, s, { type: 'tab', id: tabId }, zone)
    expect(res.next.available).toHaveLength(6)
    const fresh = res.next.available[5]
    expect(fresh.windows.map((w) => w.tabs.map((t) => t.title))).toEqual([['a1']])
    expect(fresh.permanent).toBe(false)
    // The emptied source window is KEPT (user rule, 2026-09-18).
    expect(res.next.available[1].windows.map((w) => w.tabs)).toEqual([[]])
    expect(res.undoable).toBe(true)
    // The new group is made active so the drop is visible.
    expect(res.next.active).toEqual({ id: fresh.id, index: 5 })
    expect(res.landed).toEqual({ type: 'tab', positions: [{ groupIndex: 5, windowIndex: 0, tabIndex: 0 }] })
  })

  it('a WINDOW becomes the new group\'s window', () => {
    const s = seed()
    const m = buildDndModel(s)
    const res = applyMove(m, s, { type: 'window', id: m.groups.b.windowIds[0] }, zone)
    const fresh = res.next.available[5]
    expect(fresh.windows.map((w) => w.tabs.map((t) => t.title))).toEqual([['b1']])
    expect(res.next.available[2].windows).toEqual([])
    expect(res.undoable).toBe(true)
  })

  it('a multi-tab selection spanning groups lands in ONE new group, as one window, in order', () => {
    const s = seed()
    const m = buildDndModel(s)
    const t = (gid: string) => m.windows[m.groups[gid].windowIds[0]].tabIds[0]
    const res = applyMove(m, s, { type: 'tab', id: t('a'), selectionIds: [t('a'), t('c')] }, zone)
    expect(res.next.available).toHaveLength(6)
    expect(res.next.available[5].windows.map((w) => w.tabs.map((x) => x.title))).toEqual([['a1', 'c1']])
    // The emptied source window is KEPT (user rule, 2026-09-18).
    expect(res.next.available[1].windows.map((w) => w.tabs)).toEqual([[]])
    expect(res.next.available[3].windows.map((w) => w.tabs)).toEqual([[]])
  })

  it('a multi-window selection lands in ONE new group, keeping both windows', () => {
    const s = seed()
    const m = buildDndModel(s)
    const w = (gid: string) => m.groups[gid].windowIds[0]
    const res = applyMove(m, s, { type: 'window', id: w('a'), selectionIds: [w('a'), w('b')] }, zone)
    expect(res.next.available[5].windows.map((x) => x.tabs.map((t) => t.title))).toEqual([['a1'], ['b1']])
  })

  it('a NOW OPEN tab is MOVED into the new group — detached (id 0), the real tab closed, not undoable', () => {
    const s = seed()
    const m = buildDndModel(s)
    const liveId = m.windows[m.groups.now.windowIds[0]].tabIds[0]
    const res = applyMove(m, s, { type: 'tab', id: liveId }, zone)
    const fresh = res.next.available[5]
    expect(fresh.windows[0].tabs).toHaveLength(1)
    expect(fresh.windows[0].tabs[0].id).toBe(0)
    expect(fresh.windows[0].tabs[0].savedAt).toBeGreaterThan(0)
    // Now Open in the MODEL is untouched (it re-syncs from the browser); the real tab is
    // closed through a `tabs.remove`, deferred by the executor only if it is the active
    // tab of the popup's own window (spec C7).
    expect(res.next.available[0].windows[0].tabs.map((t) => t.id)).toEqual([11])
    expect(res.sideEffects).toEqual([{ type: 'tabs.remove', tabIds: [11] }])
    expect(res.undoable).toBe(false)
  })

  it('never strands an empty group when the underlying move is a no-op', () => {
    const s = seed()
    const m = buildDndModel(s)
    // A model id that resolves to nothing → the inner move NOOPs.
    const res = applyMove(m, s, { type: 'tab', id: 'a::w0::t99' }, zone)
    expect(res.next).toBe(s)
    expect(res.next.available).toHaveLength(5)
  })
})
