/**
 * dndMove.test.ts  — RED PHASE (TDD)
 *
 * Target module (does NOT exist yet — created by the DnD rework):
 *   packages/extension/src/lib/dndMove.ts
 *     export function canDrop(model: DndModel, active: DndRef, over: DndRef): boolean
 *     export function applyMove(
 *       model: DndModel,
 *       groupsState: GroupsState,
 *       active: DndRef,
 *       over: DndRef,
 *     ): { next: GroupsState; sideEffects: DndSideEffect[]; undoable: boolean }
 *
 * CONTRACT ASSUMPTIONS (coordinate with extension-dev):
 *   DndRef = {
 *     type: 'tab' | 'window' | 'group'
 *     id: string                 // a synthesized model id from buildDndModel
 *     groupId?: string           // parent group model id (for tab/window refs & sidebar group rows)
 *     windowId?: string          // parent window model id (for tab refs)
 *     index?: number             // target insertion index when dropping between siblings
 *     selectionIds?: string[]    // multi-select: all dragged model ids (same type), drag anchor === id
 *   }
 *   DndSideEffect (applyMove never calls chrome itself — it only DESCRIBES the effect):
 *     | { type: 'tabs.move';     tabId: number; windowId: number; index: number }
 *     | { type: 'windows.create'; url: string | string[] }
 *     | { type: 'tabs.create';   windowId: number; url: string; index?: number; active: false }
 *   `undoable` === false for every move that touches the permanent "Now Open" group
 *   (it re-syncs from the browser and must never enter the undo stack).
 *
 * All tests MUST fail now with "Cannot find module '@/lib/dndMove'" (or a missing export),
 * NOT a setup error. They go green once the rework lands.
 */
import { describe, it, expect } from 'vitest'
import { canDrop, applyMove, copyLiveWindow } from '@/lib/dndMove'
import { buildDndModel } from '@/hooks/useDndModel'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function tab(title: string, over: Partial<Tab> = {}): Tab {
  return { id: 0, title, url: `https://example.com/${title}`, ...over }
}
function liveTab(id: number, title: string): Tab {
  return { id, title, url: `https://live/${title}` }
}
function win(tabs: Tab[], over: Partial<ExtWindow> = {}): ExtWindow {
  return { id: 0, tabs, incognito: false, focused: false, ...over }
}
function liveWin(id: number, tabs: Tab[]): ExtWindow {
  return { id, tabs, incognito: false, focused: false }
}
function group(id: string, windows: ExtWindow[], over: Partial<Group> = {}): Group {
  return { id, name: id, color: 'rgba(0,0,0,1)', updatedAt: 0, windows, permanent: false, ...over }
}
function state(available: Group[]): GroupsState {
  return { active: { id: available[0].id, index: 0 }, available }
}

// A saved group with 2 windows: w0=[t1,t2,t3], w1=[t4]
function savedTwoWin(id = 'saved-a') {
  return group(id, [
    win([tab('t1'), tab('t2'), tab('t3')]),
    win([tab('t4')]),
  ])
}

/** Build model + convenience id lookups for a groupsState. */
function model(s: GroupsState) {
  const m = buildDndModel(s)
  const groupId = (renderIdx: number) => m.groupIds[renderIdx]
  const windowId = (gIdx: number, wIdx: number) => m.groups[m.groupIds[gIdx]].windowIds[wIdx]
  const tabId = (gIdx: number, wIdx: number, tIdx: number) =>
    m.windows[windowId(gIdx, wIdx)].tabIds[tIdx]
  const tabRef = (gIdx: number, wIdx: number, tIdx: number) => ({
    type: 'tab' as const,
    id: tabId(gIdx, wIdx, tIdx),
    windowId: windowId(gIdx, wIdx),
    groupId: groupId(gIdx),
  })
  const winRef = (gIdx: number, wIdx: number) => ({
    type: 'window' as const,
    id: windowId(gIdx, wIdx),
    groupId: groupId(gIdx),
  })
  const groupRef = (gIdx: number) => ({ type: 'group' as const, id: groupId(gIdx) })
  return { m, groupId, windowId, tabId, tabRef, winRef, groupRef }
}

// ─────────────────────────────────────────────────────────────────────────────
// canDrop
// ─────────────────────────────────────────────────────────────────────────────

describe('canDrop', () => {
  const baseState = state([
    group('now-open', [liveWin(100, [liveTab(1, 'l1'), liveTab(2, 'l2')])], { permanent: true }),
    savedTwoWin('saved-a'),
    group('saved-b', [win([tab('x1')])], { starred: true }),
  ])

  it('5. tab → tab in the SAME window is allowed', () => {
    const { tabRef } = model(baseState)
    const { m } = model(baseState)
    expect(canDrop(m, tabRef(1, 0, 0), tabRef(1, 0, 2))).toBe(true)
  })

  it('6. tab → tab in a DIFFERENT window of the same group is allowed', () => {
    const { m, tabRef } = model(baseState)
    expect(canDrop(m, tabRef(1, 0, 0), tabRef(1, 1, 0))).toBe(true)
  })

  it('7. tab → window body (drop onto a window) is allowed', () => {
    const { m, tabRef, winRef } = model(baseState)
    expect(canDrop(m, tabRef(1, 0, 0), winRef(1, 1))).toBe(true)
  })

  it('8. tab → group row in the sidebar (different group) is allowed (email-client append)', () => {
    const { m, tabRef, groupRef } = model(baseState)
    expect(canDrop(m, tabRef(1, 0, 0), groupRef(2))).toBe(true)
  })

  it('9. window → group row (different group) is allowed', () => {
    const { m, winRef, groupRef } = model(baseState)
    expect(canDrop(m, winRef(1, 0), groupRef(2))).toBe(true)
  })

  it('10. window → window within a group is allowed', () => {
    const { m, winRef } = model(baseState)
    expect(canDrop(m, winRef(1, 0), winRef(1, 1))).toBe(true)
  })

  it('11. reject a group dropped before/into index 0 (permanent group stays first)', () => {
    const { m, groupRef } = model(baseState)
    expect(canDrop(m, groupRef(2), { ...groupRef(0), index: 0 })).toBe(false)
  })

  it('12. reject the permanent group itself being dragged (not reorderable)', () => {
    const { m, groupRef } = model(baseState)
    expect(canDrop(m, groupRef(0), groupRef(2))).toBe(false)
  })

  it('13. reject a multi-selection containing BOTH a window and a tab (mixed types)', () => {
    const { m, tabRef, winRef, groupRef } = model(baseState)
    const mixed = {
      ...tabRef(1, 0, 0),
      selectionIds: [tabRef(1, 0, 0).id, winRef(1, 1).id],
    }
    expect(canDrop(m, mixed, groupRef(2))).toBe(false)
  })

  it('14. allow a multi-selection of all-tabs, and a multi-selection of all-windows', () => {
    const { m, tabRef, winRef, groupRef } = model(baseState)
    const allTabs = { ...tabRef(1, 0, 0), selectionIds: [tabRef(1, 0, 0).id, tabRef(1, 0, 1).id] }
    const allWins = { ...winRef(1, 0), selectionIds: [winRef(1, 0).id, winRef(1, 1).id] }
    expect(canDrop(m, allTabs, groupRef(2))).toBe(true)
    expect(canDrop(m, allWins, groupRef(2))).toBe(true)
  })

  it('15. tab/window dropped INTO the permanent "Now Open" group is allowed (realised as a chrome side-effect)', () => {
    // PRODUCT DECISION PENDING — if "disallow drops into Now Open" is chosen later,
    // these flip to `false` and the `.todo` variants below become the live spec.
    const { m, tabRef, winRef, groupRef } = model(baseState)
    expect(canDrop(m, tabRef(1, 0, 0), groupRef(0))).toBe(true)
    expect(canDrop(m, winRef(1, 0), groupRef(0))).toBe(true)
  })

  it.todo('15b. PRODUCT DECISION PENDING: tab dropped into Now Open is REJECTED')
  it.todo('15c. PRODUCT DECISION PENDING: window dropped into Now Open is REJECTED')

  it('resolves ref kind by model lookup when `type` is omitted from the ref (window + group)', () => {
    const { m, windowId, groupId } = model(baseState)
    // no `type` field — canDrop must infer it from the model maps
    const winOnly = { id: windowId(1, 0) } as unknown as Parameters<typeof canDrop>[1]
    const groupOnly = { id: groupId(2) } as unknown as Parameters<typeof canDrop>[2]
    expect(canDrop(m, winOnly, groupOnly)).toBe(true)
    // a bare id that matches nothing in the model → not droppable
    const ghost = { id: 'nope' } as unknown as Parameters<typeof canDrop>[1]
    expect(canDrop(m, ghost, groupOnly)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// applyMove — same-group
// ─────────────────────────────────────────────────────────────────────────────

describe('applyMove — same-group', () => {
  it('16. same-window tab reorder: tab moves to target index, siblings unchanged, other windows/groups untouched, no side-effects', () => {
    const s = state([
      group('now-open', [], { permanent: true }),
      savedTwoWin('saved-a'),
      group('saved-b', [win([tab('keep')])]),
    ])
    const { m, tabRef } = model(s)
    // move t1 (index 0) to index 2 within w0
    const res = applyMove(m, s, tabRef(1, 0, 0), { ...tabRef(1, 0, 2), index: 2 })

    const w0 = res.next.available[1].windows[0].tabs.map((t) => t.title)
    expect(w0).toEqual(['t2', 't3', 't1'])
    // other window of the same group untouched
    expect(res.next.available[1].windows[1].tabs.map((t) => t.title)).toEqual(['t4'])
    // other group untouched (deep equal incl. updatedAt)
    expect(res.next.available[2]).toEqual(s.available[2])
    expect(res.sideEffects).toEqual([])
  })

  it('17. cross-window tab move within a saved group: removed from source, inserted at target index, group updatedAt bumped + pendingSync, no side-effects', () => {
    const s = state([group('now-open', [], { permanent: true }), savedTwoWin('saved-a')])
    const before = s.available[1].updatedAt
    const { m, tabRef, winRef } = model(s)
    // drag t1 from w0 into w1 at index 0
    const res = applyMove(m, s, tabRef(1, 0, 0), { ...winRef(1, 1), index: 0 })

    expect(res.next.available[1].windows[0].tabs.map((t) => t.title)).toEqual(['t2', 't3'])
    expect(res.next.available[1].windows[1].tabs.map((t) => t.title)).toEqual(['t1', 't4'])
    expect(res.next.available[1].updatedAt).toBeGreaterThan(before)
    expect(res.next.available[1].pendingSync).toBe(true)
    expect(res.sideEffects).toEqual([])
    expect(res.undoable).toBe(true)
  })

  it('18. window reorder respects the starred zone: an unstarred window dragged into the starred zone is clamped to the zone boundary (sortWindowsByStarred invariant)', () => {
    const s = state([
      group('now-open', [], { permanent: true }),
      group('saved-a', [
        win([tab('s1')], { starred: true, name: 'starred-win' }),
        win([tab('u1')], { name: 'unstarred-a' }),
        win([tab('u2')], { name: 'unstarred-b' }),
      ]),
    ])
    const { m, winRef } = model(s)
    // drag unstarred-b (index 2) up to index 0 (into the starred zone)
    const res = applyMove(m, s, winRef(1, 2), { ...winRef(1, 0), index: 0 })

    const names = res.next.available[1].windows.map((w) => w.name)
    // starred window must still be first — the unstarred drop is clamped below it
    expect(names[0]).toBe('starred-win')
    expect(res.next.available[1].windows[0].starred).toBe(true)
    // and the moved window did not acquire starred
    const moved = res.next.available[1].windows.find((w) => w.name === 'unstarred-b')!
    expect(moved.starred).toBeFalsy()
  })

  it('19. group reorder in the sidebar: Now Open stays index 0, starred groups stay ahead of unstarred, a cross-zone drop clamps to the boundary', () => {
    const s = state([
      group('now-open', [], { permanent: true }),
      group('starred-g', [], { starred: true }),
      group('plain-a', []),
      group('plain-b', []),
    ])
    const { m, groupRef } = model(s)
    // drag plain-b (render idx 3) up toward idx 1 (into the starred zone)
    const res = applyMove(m, s, groupRef(3), { ...groupRef(1), index: 1 })

    expect(res.next.available[0].permanent).toBe(true)
    expect(res.next.available[0].id).toBe('now-open')
    const idsAfterNowOpen = res.next.available.slice(1).map((g) => g.id)
    // starred stays ahead of every unstarred group
    const firstUnstarred = res.next.available.findIndex((g, i) => i > 0 && !g.starred)
    const lastStarred = res.next.available.reduce((acc, g, i) => (g.starred ? i : acc), -1)
    expect(lastStarred).toBeLessThan(firstUnstarred)
    expect(idsAfterNowOpen).toContain('plain-b')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// applyMove — cross-group
// ─────────────────────────────────────────────────────────────────────────────

describe('applyMove — cross-group', () => {
  it('20. cross-group tab move onto a sidebar group row: a NEW window is created at the END of the target holding just the tab (existing windows untouched), removed from source, BOTH groups bumped + pendingSync, moved tab loses pinned', () => {
    const s = state([
      group('now-open', [], { permanent: true }),
      group('saved-a', [win([tab('a1'), tab('a2', { pinned: true })])]),
      group('saved-b', [win([tab('b1')]), win([tab('b2'), tab('b3')])]),
    ])
    const beforeA = s.available[1].updatedAt
    const beforeB = s.available[2].updatedAt
    const { m, tabRef, groupRef } = model(s)
    // drag a2 (pinned) from saved-a onto saved-b's row
    const res = applyMove(m, s, tabRef(1, 0, 1), groupRef(2))

    expect(res.next.available[1].windows[0].tabs.map((t) => t.title)).toEqual(['a1'])
    // a NEW last window in saved-b — NOT appended to saved-b's existing last window
    const target = res.next.available[2].windows
    expect(target.map((w) => w.tabs.map((t) => t.title))).toEqual([['b1'], ['b2', 'b3'], ['a2']])
    expect(target[2].focused).toBe(false)
    expect(res.undoable).toBe(true)
    expect(res.sideEffects).toEqual([])
    // pinned flag dropped on the moved copy
    expect(target[2].tabs[0].pinned).toBeFalsy()

    expect(res.next.available[1].updatedAt).toBeGreaterThan(beforeA)
    expect(res.next.available[2].updatedAt).toBeGreaterThan(beforeB)
    expect(res.next.available[1].pendingSync).toBe(true)
    expect(res.next.available[2].pendingSync).toBe(true)
  })

  it('21. cross-group window move onto a group row: window appended to target (run through sortWindowsByStarred), removed from source, both groups bumped', () => {
    const s = state([
      group('now-open', [], { permanent: true }),
      group('saved-a', [win([tab('a1')], { name: 'w-a', starred: true }), win([tab('a2')], { name: 'w-b' })]),
      group('saved-b', [win([tab('b1')], { name: 'w-c', starred: true })]),
    ])
    const { m, winRef, groupRef } = model(s)
    // drag the UNSTARRED w-b from saved-a onto saved-b's row
    const res = applyMove(m, s, winRef(1, 1), groupRef(2))

    expect(res.next.available[1].windows.map((w) => w.name)).toEqual(['w-a'])
    const targetNames = res.next.available[2].windows.map((w) => w.name)
    // sortWindowsByStarred: the target's starred window stays first, the moved unstarred one after
    expect(targetNames[0]).toBe('w-c')
    expect(targetNames).toContain('w-b')
    expect(res.next.available[1].pendingSync).toBe(true)
    expect(res.next.available[2].pendingSync).toBe(true)
  })

  it('22. cross-group tab move where the target group has ZERO windows: a new window is created in the target to hold the moved tab', () => {
    const s = state([
      group('now-open', [], { permanent: true }),
      group('saved-a', [win([tab('a1'), tab('a2')])]),
      group('saved-b', []), // no windows
    ])
    const { m, tabRef, groupRef } = model(s)
    const res = applyMove(m, s, tabRef(1, 0, 0), groupRef(2))

    expect(res.next.available[2].windows).toHaveLength(1)
    expect(res.next.available[2].windows[0].tabs.map((t) => t.title)).toEqual(['a1'])
    expect(res.next.available[1].windows[0].tabs.map((t) => t.title)).toEqual(['a2'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// applyMove — Now Open delegation (chrome side-effects, never mutate available[0], never undo)
// ─────────────────────────────────────────────────────────────────────────────

describe('applyMove — Now Open delegation', () => {
  it('23. dragging a live tab OUT of Now Open into a saved group MOVES it: saved group gets a detached copy, available[0] not mutated, a tabs.remove closes the real tab, not undoable', () => {
    const s = state([
      group('now-open', [liveWin(500, [liveTab(9, 'live-9'), liveTab(10, 'live-10')])], { permanent: true }),
      group('saved-a', [win([tab('a1')])]),
    ])
    const { m, tabRef, groupRef } = model(s)
    const res = applyMove(m, s, tabRef(0, 0, 0), groupRef(1))

    // saved group received a DETACHED copy of the dragged tab, in a NEW last window
    // (group-row drop rule); its existing window is untouched
    expect(res.next.available[1].windows.map((w) => w.tabs.map((t) => t.title))).toEqual([['a1'], ['live-9']])
    const copy = res.next.available[1].windows[1].tabs.find((t) => t.title === 'live-9')
    expect(copy).toBeDefined()
    expect(copy!.id).toBe(0)
    expect(copy!.savedAt).toEqual(expect.any(Number))
    // Now Open group in `next` is NOT directly mutated (it re-syncs from the browser)
    expect(res.next.available[0]).toEqual(s.available[0])
    // MOVE semantics: the real tab is closed. `runSideEffects` defers an ACTIVE tab to
    // popup teardown so the popup's anchor tab can't dismiss it mid-drop (spec C7).
    expect(res.sideEffects).toEqual([{ type: 'tabs.remove', tabIds: [9] }])
    // Undo can't faithfully reopen a closed tab, so the move stays out of the stack.
    expect(res.undoable).toBe(false)
  })

  it('24. reordering a tab WITHIN Now Open: emits a chrome.tabs.move side-effect with the right windowId + index, no direct mutation of available[0]', () => {
    const s = state([
      group('now-open', [liveWin(700, [liveTab(21, 'n1'), liveTab(22, 'n2'), liveTab(23, 'n3')])], { permanent: true }),
    ])
    const { m, tabRef } = model(s)
    // move n1 (index 0) to index 2 within the same live window
    const res = applyMove(m, s, tabRef(0, 0, 0), { ...tabRef(0, 0, 2), index: 2 })

    expect(res.next.available[0]).toEqual(s.available[0])
    expect(res.sideEffects).toContainEqual({ type: 'tabs.move', tabId: 21, windowId: 700, index: 2 })
    expect(res.undoable).toBe(false)
  })

  it('25. dragging a SAVED tab INTO Now Open: emits a windows.create / tabs.create side-effect (real tab opens); source saved group loses the tab + is bumped', () => {
    const s = state([
      group('now-open', [liveWin(800, [liveTab(31, 'n1')])], { permanent: true }),
      group('saved-a', [win([tab('keep'), tab('go', { url: 'https://go.example' })])]),
    ])
    const beforeA = s.available[1].updatedAt
    const { m, tabRef, groupRef } = model(s)
    const res = applyMove(m, s, tabRef(1, 0, 1), groupRef(0))

    expect(res.next.available[1].windows[0].tabs.map((t) => t.title)).toEqual(['keep'])
    expect(res.next.available[1].updatedAt).toBeGreaterThan(beforeA)
    expect(res.next.available[1].pendingSync).toBe(true)
    // onto the Now Open ROW → a NEW real window (not a tab in an existing live window),
    // never focused (a focused new window dismisses the toolbar popup)
    expect(res.sideEffects).toEqual([{ type: 'windows.create', url: 'https://go.example', focused: false }])
    expect(res.undoable).toBe(false)
  })

  it('25b. dragging a SAVED whole window INTO Now Open: one windows.create side-effect, source group loses the window + is bumped, not undoable', () => {
    const s = state([
      group('now-open', [liveWin(810, [liveTab(1, 'n1')])], { permanent: true }),
      group('saved-a', [
        win([tab('k1')], { name: 'keep' }),
        win([tab('g1', { url: 'https://go1.example' }), tab('g2', { url: 'https://go2.example' })], { name: 'go' })
      ])
    ])
    const beforeA = s.available[1].updatedAt
    const { m, winRef, groupRef } = model(s)
    const res = applyMove(m, s, winRef(1, 1), groupRef(0))

    expect(res.next.available[1].windows.map((w) => w.name)).toEqual(['keep'])
    expect(res.next.available[1].updatedAt).toBeGreaterThan(beforeA)
    expect(res.next.available[1].pendingSync).toBe(true)
    const creates = res.sideEffects.filter((e) => e.type === 'windows.create')
    expect(creates).toHaveLength(1)
    expect((creates[0] as { url: string[] }).url).toEqual(['https://go1.example', 'https://go2.example'])
    expect(res.undoable).toBe(false)
  })

  it('26. no applyMove that touches Now Open is undoable (source OR target)', () => {
    const s = state([
      group('now-open', [liveWin(900, [liveTab(41, 'n1'), liveTab(42, 'n2')])], { permanent: true }),
      group('saved-a', [win([tab('a1')])]),
    ])
    const { m, tabRef, groupRef, winRef } = model(s)
    const outOfNowOpen = applyMove(m, s, tabRef(0, 0, 0), groupRef(1))
    const intoNowOpen = applyMove(m, s, tabRef(1, 0, 0), groupRef(0))
    const withinNowOpen = applyMove(m, s, tabRef(0, 0, 0), { ...tabRef(0, 0, 1), index: 1 })
    expect(outOfNowOpen.undoable).toBe(false)
    expect(intoNowOpen.undoable).toBe(false)
    expect(withinNowOpen.undoable).toBe(false)
    // sanity: a purely-saved move IS undoable
    const savedOnly = applyMove(m, s, winRef(1, 0), groupRef(1))
    expect(savedOnly.undoable).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Dragging OUT of Now Open is a MOVE (user request, 2026-09-17): the destination
// gets a detached copy AND the real tab is closed.
//
// The hazard this replaced a copy with is spec C7: closing the ACTIVE tab of the
// window the toolbar popup is anchored to makes Chrome dismiss the popup instantly,
// which used to kill the commit mid-flight. `applyMove` stays pure and just names the
// ids; `runSideEffects` closes only NON-active tabs itself and defers every active one
// to the background worker, which closes it when the popup goes away (see
// `dndNowOpenMoveOut.test.ts`). The guard that survives here: a `tabs.remove` may only
// ever appear for a Now Open → saved drop, and may only ever name REAL (non-zero) ids.
// ─────────────────────────────────────────────────────────────────────────────

describe('applyMove — a drag out of Now Open closes exactly the real tabs it moved', () => {
  function liveState() {
    return state([
      group(
        'now-open',
        [liveWin(500, [liveTab(9, 'live-9'), liveTab(10, 'live-10')]), liveWin(600, [liveTab(11, 'live-11')])],
        { permanent: true },
      ),
      group('saved-a', [win([tab('a1'), tab('a2')]), win([tab('a3')])]),
      group('saved-b', []),
    ])
  }

  function destGroupIndex(m: ReturnType<typeof buildDndModel>, ref: { type: string; id: string; groupIndex?: number }) {
    if (ref.type === 'tab') return m.tabs[ref.id].groupIndex
    if (ref.type === 'window') return m.windows[ref.id].groupIndex
    if (ref.type === 'group') return m.groups[ref.id].index
    return ref.groupIndex ?? -1
  }

  it('exhaustive sweep: a tabs.remove is emitted ONLY for a Now Open → saved drop, and always names real (non-zero) live tab ids', () => {
    const s = liveState()
    const m = buildDndModel(s)
    const actives = [
      ...Object.keys(m.tabs).map((id) => ({ type: 'tab' as const, id })),
      ...Object.keys(m.windows).map((id) => ({ type: 'window' as const, id })),
      ...Object.keys(m.groups).map((id) => ({ type: 'group' as const, id })),
    ]
    const overs = [
      ...actives,
      ...m.groupIds.map((gid, gi) => ({ type: 'new-window' as const, id: `${gid}::new-window`, groupIndex: gi })),
    ]

    let outOfNowOpenCommits = 0
    for (const a of actives) {
      for (const o of overs) {
        const res = applyMove(m, s, a, o)
        const removals = res.sideEffects.filter((e) => e.type === 'tabs.remove')

        const srcGi = a.type === 'group' ? -1 : destGroupIndex(m, a)
        const dstGi = destGroupIndex(m, o)
        if (srcGi === 0 && dstGi > 0 && res.next !== s) {
          outOfNowOpenCommits++
          // The move closes the real tab(s) — and only ever REAL ids: a saved tab is
          // `id: 0`, and passing 0 to chrome.tabs.remove would be a bug.
          expect(removals).toHaveLength(1)
          const ids = (removals[0] as { tabIds: number[] }).tabIds
          expect(ids.length).toBeGreaterThan(0)
          expect(ids.every((id) => Number.isInteger(id) && id > 0)).toBe(true)
          expect(res.undoable).toBe(false)
          // Now Open is never mutated by an out-drag — it re-syncs from the browser.
          expect(res.next.available[0]).toEqual(s.available[0])
        } else {
          // Every other drag is non-destructive.
          expect(removals).toEqual([])
        }
      }
    }
    // sanity: the sweep really exercised the out-of-Now-Open path (tabs + windows × saved targets)
    expect(outOfNowOpenCommits).toBeGreaterThan(10)
  })

  it('single live TAB onto a saved tab / window / group row / new-window zone → detached copy lands and the real tab is closed', () => {
    const s = liveState()
    const { m, tabRef, winRef, groupRef, groupId } = model(s)
    const targets = [
      { ...tabRef(1, 0, 1), index: 1 },
      winRef(1, 1),
      groupRef(1),
      groupRef(2), // zero-window target → synthesised window
      { type: 'new-window' as const, id: `${groupId(1)}::new-window`, groupIndex: 1 },
    ]
    for (const o of targets) {
      const res = applyMove(m, s, tabRef(0, 0, 0), o)
      const destGi = o.type === 'group' && o.id === groupId(2) ? 2 : 1
      const titles = res.next.available[destGi].windows.flatMap((w) => w.tabs.map((t) => t.title))
      expect(titles).toContain('live-9')
      expect(res.sideEffects).toEqual([{ type: 'tabs.remove', tabIds: [9] }])
      expect(res.next.available[0]).toEqual(s.available[0])
    }
  })

  it('live WINDOW onto a saved group → detached window copy lands and EVERY tab of the real window is closed (the window goes with its last tab)', () => {
    const s = liveState()
    const { m, winRef, groupRef } = model(s)
    const res = applyMove(m, s, winRef(0, 0), groupRef(1))
    expect(res.next.available[1].windows).toHaveLength(3)
    const copy = res.next.available[1].windows.find((w) => w.tabs.some((t) => t.title === 'live-9'))!
    expect(copy.id).toBe(0)
    expect(copy.tabs.map((t) => t.title)).toEqual(['live-9', 'live-10'])
    expect(copy.tabs.every((t) => t.id === 0)).toBe(true)
    expect(res.sideEffects).toEqual([{ type: 'tabs.remove', tabIds: [9, 10] }])
    expect(res.undoable).toBe(false)
  })

  it('multi-TAB and multi-WINDOW selections out of Now Open close every live member exactly once', () => {
    const s = liveState()
    const { m, tabRef, winRef, groupRef, tabId, windowId } = model(s)

    const multiTab = applyMove(
      m,
      s,
      { ...tabRef(0, 0, 0), selectionIds: [tabId(0, 0, 0), tabId(0, 0, 1)] },
      groupRef(1),
    )
    expect(multiTab.sideEffects).toEqual([{ type: 'tabs.remove', tabIds: [9, 10] }])
    expect(multiTab.undoable).toBe(false)

    const multiWin = applyMove(
      m,
      s,
      { ...winRef(0, 0), selectionIds: [windowId(0, 0), windowId(0, 1)] },
      groupRef(1),
    )
    // both live windows → all three of their real tabs
    expect(multiWin.sideEffects).toEqual([{ type: 'tabs.remove', tabIds: [9, 10, 11] }])
    expect(multiWin.undoable).toBe(false)
  })

  it('the non-destructive Now Open side effects still fire: tabs.move (within), tabs.create / windows.create (into)', () => {
    const s = liveState()
    const { m, tabRef, winRef, groupRef } = model(s)
    expect(applyMove(m, s, tabRef(0, 0, 0), { ...tabRef(0, 0, 1), index: 1 }).sideEffects).toEqual([
      { type: 'tabs.move', tabId: 9, windowId: 500, index: 1 },
    ])
    expect(applyMove(m, s, tabRef(1, 0, 0), tabRef(0, 0, 0)).sideEffects.map((e) => e.type)).toEqual(['tabs.create'])
    expect(applyMove(m, s, winRef(1, 0), groupRef(0)).sideEffects.map((e) => e.type)).toEqual(['windows.create'])
  })

  describe('Now Open tab(s) → Now Open\'s OWN new-window zone (real detach, not a stored move)', () => {
    const nowOpenNewWindow = (gi: number) => ({
      type: 'new-window' as const,
      id: 'now-open::new-window',
      groupId: 'now-open',
      groupIndex: gi,
    })

    it('single live tab (not the only tab in its window) → tabs.detachToNewWindow with that one real id; stored state untouched', () => {
      const s = liveState()
      const { m, tabRef } = model(s)
      const res = applyMove(m, s, tabRef(0, 0, 0), nowOpenNewWindow(0))
      expect(res.sideEffects).toEqual([{ type: 'tabs.detachToNewWindow', tabIds: [9] }])
      expect(res.undoable).toBe(false)
      expect(res.next).toBe(s) // no stored-state mutation at all — a pure chrome side effect
    })

    it('the ONLY tab of its window dropped on the zone is a no-op — no side effect, no stored change', () => {
      const s = liveState()
      const { m, tabRef } = model(s)
      // window 600 (index 1 of now-open) holds a single live tab (11)
      const res = applyMove(m, s, tabRef(0, 1, 0), nowOpenNewWindow(0))
      expect(res.sideEffects).toEqual([])
      expect(res.next).toBe(s)
    })

    it('multi-select of live Now Open tabs preserves ORIGINAL order in tabIds, not click/selection order', () => {
      const s = liveState()
      const { m, tabRef, tabId } = model(s)
      // select tab 10 first, then tab 9 (reverse of source order) — output must still be [9, 10]
      const sel = [tabId(0, 0, 1), tabId(0, 0, 0)]
      const active = { ...tabRef(0, 0, 1), selectionIds: sel }
      const res = applyMove(m, s, active, nowOpenNewWindow(0))
      expect(res.sideEffects).toEqual([{ type: 'tabs.detachToNewWindow', tabIds: [9, 10] }])
      expect(res.undoable).toBe(false)
      expect(res.next).toBe(s)
    })

    it('a selection mixing a live Now Open tab with a saved-group tab is refused (no single well-defined real action)', () => {
      const s = liveState()
      const { m, tabRef, tabId } = model(s)
      const sel = [tabId(0, 0, 0), tabId(1, 0, 0)]
      const active = { ...tabRef(0, 0, 0), selectionIds: sel }
      const res = applyMove(m, s, active, nowOpenNewWindow(0))
      expect(res.sideEffects).toEqual([])
      expect(res.next).toBe(s)
    })

    it('a saved tab dropped on Now Open\'s new-window zone still opens ONE new real (unfocused) window — unchanged existing semantics', () => {
      const s = liveState()
      const { m, tabRef } = model(s)
      const res = applyMove(m, s, tabRef(1, 0, 0), nowOpenNewWindow(0))
      expect(res.sideEffects).toEqual([
        { type: 'windows.create', url: 'https://example.com/a1', focused: false },
      ])
      expect(res.undoable).toBe(false)
    })

    it('multiple saved tabs dropped on Now Open\'s new-window zone open ONE new window with every url', () => {
      const s = liveState()
      const { m, tabRef, tabId } = model(s)
      const sel = [tabId(1, 0, 0), tabId(1, 0, 1)]
      const active = { ...tabRef(1, 0, 0), selectionIds: sel }
      const res = applyMove(m, s, active, nowOpenNewWindow(0))
      expect(res.sideEffects).toEqual([
        { type: 'windows.create', url: ['https://example.com/a1', 'https://example.com/a2'], focused: false },
      ])
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// applyMove — multi-item
// ─────────────────────────────────────────────────────────────────────────────

describe('applyMove — multi-item', () => {
  it('27. multi-select of 3 tabs from one window dropped into another: all 3 spliced from source, inserted CONTIGUOUSLY at the target index, original relative order preserved', () => {
    const s = state([
      group('now-open', [], { permanent: true }),
      group('saved-a', [
        win([tab('t1'), tab('t2'), tab('t3'), tab('t4')]),
        win([tab('x1'), tab('x2')]),
      ]),
    ])
    const { m, tabRef, winRef } = model(s)
    // select t1,t2,t4 (non-contiguous in source), anchor t1, drop into w1 at index 1
    const sel = [tabRef(1, 0, 0).id, tabRef(1, 0, 1).id, tabRef(1, 0, 3).id]
    const active = { ...tabRef(1, 0, 0), selectionIds: sel }
    const res = applyMove(m, s, active, { ...winRef(1, 1), index: 1 })

    expect(res.next.available[1].windows[0].tabs.map((t) => t.title)).toEqual(['t3'])
    // inserted as one contiguous run at index 1, source order (t1,t2,t4) preserved
    expect(res.next.available[1].windows[1].tabs.map((t) => t.title)).toEqual(['x1', 't1', 't2', 't4', 'x2'])
  })

  it('28. multi-select same-list move: all selected removed first, then re-inserted as an ordered run at the destination — no index drift / off-by-one', () => {
    const s = state([
      group('now-open', [], { permanent: true }),
      group('saved-a', [win([tab('a'), tab('b'), tab('c'), tab('d'), tab('e')])]),
    ])
    const { m, tabRef } = model(s)
    // select a,b (indices 0,1); drop before d (target index 3 in ORIGINAL list)
    const sel = [tabRef(1, 0, 0).id, tabRef(1, 0, 1).id]
    const active = { ...tabRef(1, 0, 0), selectionIds: sel }
    const res = applyMove(m, s, active, { ...tabRef(1, 0, 3), index: 3 })

    // remove a,b → [c,d,e]; re-insert [a,b] before d → [c,a,b,d,e]
    expect(res.next.available[1].windows[0].tabs.map((t) => t.title)).toEqual(['c', 'a', 'b', 'd', 'e'])
  })

  it('29. a multi-item move is ONE undoable operation for the whole batch (not N)', () => {
    const s = state([
      group('now-open', [], { permanent: true }),
      group('saved-a', [win([tab('t1'), tab('t2'), tab('t3')]), win([tab('x1')])]),
    ])
    const { m, tabRef, winRef } = model(s)
    const sel = [tabRef(1, 0, 0).id, tabRef(1, 0, 1).id, tabRef(1, 0, 2).id]
    const res = applyMove(m, s, { ...tabRef(1, 0, 0), selectionIds: sel }, { ...winRef(1, 1), index: 0 })
    // a single result / single next-state == a single snapshot's worth of change
    expect(res.undoable).toBe(true)
    expect(Array.isArray(res.next.available)).toBe(true)
    expect(res).not.toHaveProperty('undoSnapshots') // no per-item fan-out
  })

  it('30. applyMove with a mixed-type selection is a no-op or throws (defence in depth behind canDrop)', () => {
    const s = state([
      group('now-open', [], { permanent: true }),
      group('saved-a', [win([tab('t1')]), win([tab('t2')])]),
      group('saved-b', [win([tab('b1')])]),
    ])
    const { m, tabRef, winRef, groupRef } = model(s)
    const mixed = { ...tabRef(1, 0, 0), selectionIds: [tabRef(1, 0, 0).id, winRef(1, 1).id] }

    let threw = false
    let res: ReturnType<typeof applyMove> | undefined
    try {
      res = applyMove(m, s, mixed, groupRef(2))
    } catch {
      threw = true
    }
    expect(threw || JSON.stringify(res!.next) === JSON.stringify(s)).toBe(true)
  })

  // ── "new window" drop zone (item 3) ────────────────────────────────────────
  describe('tab → new-window zone', () => {
    const s = state([
      group('now-open', [], { permanent: true }),
      savedTwoWin('saved-a'), // w0=[t1,t2,t3], w1=[t4]
    ])
    const nwRef = (gIdx: number) => ({
      type: 'new-window' as const,
      id: `${'saved-a'}::new-window`,
      groupId: 'saved-a',
      groupIndex: gIdx,
    })

    it('canDrop: a tab may drop on a new-window zone', () => {
      const { m, tabRef } = model(s)
      expect(canDrop(m, tabRef(1, 0, 0), nwRef(1))).toBe(true)
    })

    it('canDrop: a window may NOT drop on a new-window zone', () => {
      const { m, winRef } = model(s)
      expect(canDrop(m, winRef(1, 0), nwRef(1))).toBe(false)
    })

    it('applyMove: creates a fresh LAST window in the group holding just that tab; source loses it; undoable', () => {
      const { m, tabRef } = model(s)
      const { next, sideEffects, undoable } = applyMove(m, s, tabRef(1, 0, 0), nwRef(1))
      const g = next.available[1]
      expect(g.windows).toHaveLength(3) // was 2
      expect(g.windows[2].tabs.map((t) => t.title)).toEqual(['t1'])
      expect(g.windows[0].tabs.map((t) => t.title)).toEqual(['t2', 't3'])
      expect(g.windows[0].tabs.find((t) => t.title === 't1')).toBeUndefined()
      expect(sideEffects).toEqual([])
      expect(undoable).toBe(true)
      expect(next.available[1].updatedAt).toBeGreaterThan(0)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Group-row drop = a NEW window (user rule: "dropping into the group itself, just
// adds it in a new window within that group. Same logic with windows.")
// ─────────────────────────────────────────────────────────────────────────────

const titles = (g: Group) => g.windows.map((w) => w.tabs.map((t) => t.title))
const NOW_OPEN_EMPTY = () => group('now-open', [], { permanent: true })

describe('applyMove — a sidebar GROUP ROW drop adds a NEW window (tabs + windows)', () => {
  it('a tab dropped on its OWN group row moves into a new window at the end of that group; undoable, no side effects', () => {
    const s = state([NOW_OPEN_EMPTY(), savedTwoWin('saved-a')]) // w0=[t1,t2,t3], w1=[t4]
    const { m, tabRef, groupRef } = model(s)
    const res = applyMove(m, s, tabRef(1, 0, 1), groupRef(1))
    expect(titles(res.next.available[1])).toEqual([['t1', 't3'], ['t4'], ['t2']])
    expect(res.undoable).toBe(true)
    expect(res.sideEffects).toEqual([])
  })

  it('a tab dropped on a tab / a window INSIDE another group still inserts positionally (no new window)', () => {
    const s = state([NOW_OPEN_EMPTY(), savedTwoWin('saved-a'), group('saved-b', [win([tab('b1'), tab('b2')])])])
    const { m, tabRef, winRef } = model(s)
    expect(titles(applyMove(m, s, tabRef(1, 0, 0), { ...tabRef(2, 0, 1), index: 1 }).next.available[2])).toEqual([
      ['b1', 't1', 'b2'],
    ])
    expect(titles(applyMove(m, s, tabRef(1, 0, 0), winRef(2, 0)).next.available[2])).toEqual([['b1', 'b2', 't1']])
  })

  it('a window dropped on its OWN group row moves to the end of that group (starred-first still applied)', () => {
    const s = state([
      NOW_OPEN_EMPTY(),
      group('saved-a', [
        win([tab('s')], { name: 'star', starred: true }),
        win([tab('a')], { name: 'a' }),
        win([tab('b')], { name: 'b' }),
      ]),
    ])
    const { m, winRef, groupRef } = model(s)
    const res = applyMove(m, s, winRef(1, 1), groupRef(1))
    expect(res.next.available[1].windows.map((w) => w.name)).toEqual(['star', 'b', 'a'])
    expect(res.undoable).toBe(true)
  })

  function twoSavedGroups() {
    return state([
      NOW_OPEN_EMPTY(),
      group('saved-a', [win([tab('a1')], { name: 'wa' }), win([tab('a2')], { name: 'wb' })]),
      group('saved-b', [win([tab('b1')], { name: 'wc' }), win([tab('b2')], { name: 'wd' })]),
    ])
  }

  it('a window dropped on ANOTHER group row becomes that group\'s new LAST window and leaves its source; ONE undoable move', () => {
    const s = twoSavedGroups()
    const { m, winRef, groupRef } = model(s)
    const res = applyMove(m, s, winRef(1, 0), groupRef(2))
    expect(res.next.available[1].windows.map((w) => w.name)).toEqual(['wb'])
    expect(res.next.available[2].windows.map((w) => w.name)).toEqual(['wc', 'wd', 'wa'])
    expect(res.sideEffects).toEqual([])
    expect(res.undoable).toBe(true)
  })

  it('a window dropped on a window in ANOTHER group\'s list (after spring-open) inserts BEFORE that window — where the gap is drawn', () => {
    const s = twoSavedGroups()
    const { m, winRef } = model(s)
    const res = applyMove(m, s, winRef(1, 0), { ...winRef(2, 1), index: 1 })
    expect(res.next.available[2].windows.map((w) => w.name)).toEqual(['wc', 'wa', 'wd'])
    expect(res.next.available[1].windows.map((w) => w.name)).toEqual(['wb'])
  })
})

/**
 * User rule (2026-09-18): an emptied window is KEPT. It renders as an empty window card,
 * still counts in the badges, and is still a drop target — removing a window is always an
 * explicit action, never a side effect of dragging its last tab away. This reverses the
 * earlier "prune emptied windows in the same commit" behaviour and lines DnD up with
 * `useGroups`, which now also keeps them.
 */
describe('applyMove — a move that EMPTIES its saved source window LEAVES that window in place', () => {
  it('cross-group tab → group row: the emptied source window STAYS, as an empty window', () => {
    const s = state([NOW_OPEN_EMPTY(), savedTwoWin('saved-a'), group('saved-b', [win([tab('b1')])])])
    const { m, tabRef, groupRef } = model(s)
    const res = applyMove(m, s, tabRef(1, 1, 0), groupRef(2)) // t4 is w1's only tab
    expect(titles(res.next.available[1])).toEqual([['t1', 't2', 't3'], []])
    expect(titles(res.next.available[2])).toEqual([['b1'], ['t4']])
    expect(res.undoable).toBe(true)
  })

  it('a tab can be dropped straight BACK into the window a move emptied', () => {
    const s = state([NOW_OPEN_EMPTY(), group('saved-a', [win([tab('t1')]), win([])]), group('saved-b', [win([tab('b1')])])])
    const { m, tabRef, winRef } = model(s)
    expect(canDrop(m, tabRef(2, 0, 0), winRef(1, 1))).toBe(true)
    const res = applyMove(m, s, tabRef(2, 0, 0), winRef(1, 1))
    expect(titles(res.next.available[1])).toEqual([['t1'], ['b1']])
  })

  it("a group's ONLY window dragged to another group leaves the source with zero windows (and is undoable)", () => {
    // The move was never blocked by `canDrop` — the UI just hid the grip when a group had
    // one window. Now that the grip always renders, the engine has to behave sanely: the
    // source group is emptied, NOT deleted, and stays a legal drop target.
    const s = state([NOW_OPEN_EMPTY(), group('saved-a', [win([tab('solo1'), tab('solo2')])]), group('saved-b', [win([tab('b1')])])])
    const { m, winRef, groupRef } = model(s)
    const res = applyMove(m, s, winRef(1, 0), groupRef(2))
    expect(titles(res.next.available[1])).toEqual([])
    expect(titles(res.next.available[2])).toEqual([['b1'], ['solo1', 'solo2']])
    expect(res.next.available[1]).toBeDefined() // never auto-deleted
    expect(res.undoable).toBe(true)
    expect(res.sideEffects).toEqual([])
  })

  it('a group left with ZERO windows is still a valid target: a tab dropped on its row makes a new window', () => {
    const s = state([NOW_OPEN_EMPTY(), group('saved-a', []), group('saved-b', [win([tab('b1')])])])
    const { m, tabRef, groupRef } = model(s)
    expect(canDrop(m, tabRef(2, 0, 0), groupRef(1))).toBe(true)
    const res = applyMove(m, s, tabRef(2, 0, 0), groupRef(1))
    expect(titles(res.next.available[1])).toEqual([['b1']])
    // …and group b keeps its now-empty window rather than dropping to zero windows.
    expect(titles(res.next.available[2])).toEqual([[]])
  })

  it('cross-group tab onto a tab: a source group whose only window emptied keeps that empty window', () => {
    const s = state([NOW_OPEN_EMPTY(), group('saved-a', [win([tab('solo')])]), group('saved-b', [win([tab('b1')])])])
    const { m, tabRef } = model(s)
    const res = applyMove(m, s, tabRef(1, 0, 0), { ...tabRef(2, 0, 0), index: 0 })
    expect(titles(res.next.available[1])).toEqual([[]])
    expect(titles(res.next.available[2])).toEqual([['solo', 'b1']])
  })

  it('same-group cross-window move keeps the emptied source window (the destination still gets the tab at its index)', () => {
    const s = state([NOW_OPEN_EMPTY(), group('saved-a', [win([tab('x')]), win([tab('y1'), tab('y2')])])])
    const { m, tabRef, winRef } = model(s)
    const res = applyMove(m, s, tabRef(1, 0, 0), { ...winRef(1, 1), index: 1 })
    expect(titles(res.next.available[1])).toEqual([[], ['y1', 'x', 'y2']])
  })

  it('a same-group group-row drop of a window\'s only tab: the tab lands in a new last window and the emptied one stays', () => {
    const s = state([NOW_OPEN_EMPTY(), savedTwoWin('saved-a')])
    const { m, tabRef, groupRef } = model(s)
    const res = applyMove(m, s, tabRef(1, 1, 0), groupRef(1)) // t4 alone in w1 → own row
    expect(titles(res.next.available[1])).toEqual([['t1', 't2', 't3'], [], ['t4']])
  })

  it('saved tab → a live Now Open tab: the emptied saved source window stays; tabs.create opens it in the BACKGROUND', () => {
    const s = state([
      group('now-open', [liveWin(800, [liveTab(1, 'n1')])], { permanent: true }),
      group('saved-a', [win([tab('k')]), win([tab('go', { url: 'https://go.example' })])]),
    ])
    const { m, tabRef } = model(s)
    const res = applyMove(m, s, tabRef(1, 1, 0), tabRef(0, 0, 0))
    expect(titles(res.next.available[1])).toEqual([['k'], []])
    // `active: false` — activating a tab in the popup's anchor window dismisses the popup (phase-1 open risk)
    expect(res.sideEffects).toEqual([{ type: 'tabs.create', windowId: 800, url: 'https://go.example', index: 0, active: false }])
    expect(res.next.available[0]).toEqual(s.available[0])
  })
})

describe('applyMove — the Now Open ROW as a drop target', () => {
  function withLive() {
    return state([
      group('now-open', [liveWin(500, [liveTab(9, 'live-9')]), liveWin(600, [liveTab(11, 'live-11')])], { permanent: true }),
      group('saved-a', [win([tab('a1', { url: 'https://a1.example' }), tab('a2', { url: 'https://a2.example' })])]),
    ])
  }

  it('a saved TAB on the Now Open row opens ONE new unfocused real window — even though live windows exist — and no tabs.create', () => {
    const s = withLive()
    const { m, tabRef, groupRef } = model(s)
    const res = applyMove(m, s, tabRef(1, 0, 0), groupRef(0))
    expect(res.sideEffects).toEqual([{ type: 'windows.create', url: 'https://a1.example', focused: false }])
    expect(titles(res.next.available[1])).toEqual([['a2']])
    expect(res.next.available[0]).toEqual(s.available[0])
    expect(res.undoable).toBe(false)
  })

  it('a saved WINDOW on the Now Open row opens one unfocused real window with all its urls; the source loses it', () => {
    const s = withLive()
    const { m, winRef, groupRef } = model(s)
    const res = applyMove(m, s, winRef(1, 0), groupRef(0))
    expect(res.sideEffects).toEqual([
      { type: 'windows.create', url: ['https://a1.example', 'https://a2.example'], focused: false },
    ])
    expect(res.next.available[1].windows).toEqual([])
    expect(res.undoable).toBe(false)
  })

  it('a LIVE Now Open tab or window dropped on the Now Open row is not a target (canDrop false; applyMove is a no-op)', () => {
    const s = withLive()
    const { m, tabRef, winRef, groupRef } = model(s)
    expect(canDrop(m, tabRef(0, 0, 0), groupRef(0))).toBe(false)
    expect(canDrop(m, winRef(0, 1), groupRef(0))).toBe(false)
    for (const a of [tabRef(0, 0, 0), winRef(0, 1)]) {
      const res = applyMove(m, s, a, groupRef(0))
      expect(res.next).toBe(s)
      expect(res.sideEffects).toEqual([])
    }
    // a SAVED item on the Now Open row stays a valid target
    expect(canDrop(m, tabRef(1, 0, 0), groupRef(0))).toBe(true)
  })

  it('sweep: EVERY windows.create any single-item or multi-select drag can emit is focused:false', () => {
    const s = withLive()
    const m = buildDndModel(s)
    const actives = [
      ...Object.keys(m.tabs).map((id) => ({ type: 'tab' as const, id })),
      ...Object.keys(m.windows).map((id) => ({ type: 'window' as const, id })),
      { type: 'window' as const, id: Object.keys(m.windows).find((id) => m.windows[id].groupIndex === 1)!, selectionIds: Object.keys(m.windows).filter((id) => m.windows[id].groupIndex === 1) },
    ]
    const overs = [...Object.keys(m.tabs).map((id) => ({ type: 'tab' as const, id })), ...Object.keys(m.windows).map((id) => ({ type: 'window' as const, id })), ...m.groupIds.map((id) => ({ type: 'group' as const, id }))]
    let creates = 0
    for (const a of actives) {
      for (const o of overs) {
        for (const fx of applyMove(m, s, a, o).sideEffects) {
          if (fx.type !== 'windows.create') continue
          creates++
          expect(fx.focused).toBe(false)
        }
      }
    }
    expect(creates).toBeGreaterThan(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// copyLiveWindow — the detached saved copy of a live Now Open window
// ─────────────────────────────────────────────────────────────────────────────

describe('copyLiveWindow', () => {
  const live = (): ExtWindow => ({
    id: 77,
    focused: true,
    starred: true,
    incognito: true,
    name: 'Research',
    note: 'keep',
    tabs: [
      { id: 101, title: 'A', url: 'https://a.com', pinned: true, favIconUrl: 'https://a.com/f.ico' },
      { id: 102, title: 'B', url: 'https://b.com' },
    ],
  })

  it('detaches the window: id 0, unfocused, unstarred; keeps name, note and incognito', () => {
    const copy = copyLiveWindow(live())
    expect(copy).toMatchObject({ id: 0, focused: false, starred: false, incognito: true, name: 'Research', note: 'keep' })
  })

  it('detaches every tab: id 0, a fresh savedAt, no pinned flag; url/title/favicon kept in order', () => {
    const before = Date.now()
    const copy = copyLiveWindow(live())
    expect(copy.tabs.map((t) => [t.title, t.url])).toEqual([['A', 'https://a.com'], ['B', 'https://b.com']])
    expect(copy.tabs[0].favIconUrl).toBe('https://a.com/f.ico')
    for (const t of copy.tabs) {
      expect(t.id).toBe(0)
      expect(t.savedAt).toBeGreaterThanOrEqual(before)
      expect('pinned' in t).toBe(false)
    }
  })

  it('does not mutate or alias the live window', () => {
    const w = live()
    const snapshot = structuredClone(w)
    const copy = copyLiveWindow(w)
    expect(w).toEqual(snapshot)
    expect(copy).not.toBe(w)
    expect(copy.tabs).not.toBe(w.tabs)
    expect(copy.tabs[0]).not.toBe(w.tabs[0])
  })

  it('defaults a missing incognito flag to false and handles a window with no tabs', () => {
    const w = { id: 5, tabs: [], focused: true } as unknown as ExtWindow
    expect(copyLiveWindow(w)).toMatchObject({ id: 0, incognito: false, focused: false, tabs: [] })
  })
})
