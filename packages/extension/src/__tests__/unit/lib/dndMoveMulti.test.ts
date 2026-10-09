/**
 * dndMoveMulti.test.ts — RED PHASE (TDD)
 *
 * Covers the NOT-yet-implemented slices of the pure move engine (`@/lib/dndMove`):
 *
 *   Item 8 — `moveWindowsMulti`: a contiguous multi-window selection dropped onto
 *            another group must move the WHOLE run, re-applying the starred-first
 *            invariant, as ONE undoable op. `applyMove` currently ignores
 *            `selectionIds` for window drags entirely, so only the anchor moves.
 *
 *   Item 9 — Now Open (permanent, index 0) window invariants: a LIVE window dragged
 *            OUT of Now Open into a saved group must actually land in the target
 *            (and stay `undoable:false`, as a COPY that emits NO side effect — the
 *            real window stays open so the toolbar popup isn't dismissed). `moveWindow` bailed
 *            with a NOOP the moment `srcGi === permIndex`, so nothing moves today.
 *
 * The module already exists — every failure here is an ASSERTION about missing
 * behaviour, not a missing import.
 */
import { describe, it, expect } from 'vitest'
import { applyMove } from '@/lib/dndMove'
import { buildDndModel } from '@/hooks/useDndModel'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

// ─── fixtures ────────────────────────────────────────────────────────────────

function tab(title: string): Tab {
  return { id: 0, title, url: `https://example.com/${title}` }
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

function refs(s: GroupsState) {
  const m = buildDndModel(s)
  const gid = (i: number) => m.groupIds[i]
  const wid = (gi: number, wi: number) => m.groups[gid(gi)].windowIds[wi]
  const tid = (gi: number, wi: number, ti: number) => m.windows[wid(gi, wi)].tabIds[ti]
  return {
    m,
    gid,
    wid,
    tid,
    winRef: (gi: number, wi: number) => ({ type: 'window' as const, id: wid(gi, wi), groupId: gid(gi) }),
    tabRef: (gi: number, wi: number, ti: number) => ({
      type: 'tab' as const,
      id: tid(gi, wi, ti),
      windowId: wid(gi, wi),
      groupId: gid(gi)
    }),
    groupRef: (gi: number) => ({ type: 'group' as const, id: gid(gi) })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Item 8 — moveWindowsMulti
// ─────────────────────────────────────────────────────────────────────────────

describe('applyMove — multi-WINDOW move (item 8: moveWindowsMulti)', () => {
  function twoGroupsThreeWindows() {
    return state([
      group('now-open', [], { permanent: true }),
      group('saved-a', [
        win([tab('a1')], { name: 'wa', starred: true }),
        win([tab('b1')], { name: 'wb' }),
        win([tab('c1')], { name: 'wc' })
      ]),
      group('saved-b', [win([tab('d1')], { name: 'wd', starred: true })])
    ])
  }

  it('moves a contiguous 2-window selection onto another group as ONE run, source loses both', () => {
    const s = twoGroupsThreeWindows()
    const { m, winRef, groupRef, wid } = refs(s)
    const sel = [wid(1, 1), wid(1, 2)] // wb, wc
    const active = { ...winRef(1, 1), selectionIds: sel }

    const res = applyMove(m, s, active, groupRef(2))

    // both dragged windows left the source
    expect(res.next.available[1].windows.map((w) => w.name)).toEqual(['wa'])
    // both dragged windows landed in the target, contiguous, original order kept
    const targetNames = res.next.available[2].windows.map((w) => w.name)
    expect(targetNames).toContain('wb')
    expect(targetNames).toContain('wc')
    expect(targetNames.indexOf('wc')).toBe(targetNames.indexOf('wb') + 1)
  })

  it('re-applies the starred-first invariant in the target after a multi-window drop', () => {
    const s = twoGroupsThreeWindows()
    const { m, winRef, groupRef, wid } = refs(s)
    const active = { ...winRef(1, 1), selectionIds: [wid(1, 1), wid(1, 2)] }

    const res = applyMove(m, s, active, groupRef(2))

    const targetNames = res.next.available[2].windows.map((w) => w.name)
    // target's own starred window stays first, the moved unstarred run follows
    expect(targetNames[0]).toBe('wd')
    expect(targetNames).toEqual(['wd', 'wb', 'wc'])
  })

  it('is exactly ONE undoable operation that moves the WHOLE batch', () => {
    const s = twoGroupsThreeWindows()
    const { m, winRef, groupRef, wid } = refs(s)
    const active = { ...winRef(1, 1), selectionIds: [wid(1, 1), wid(1, 2)] }

    const res = applyMove(m, s, active, groupRef(2))

    expect(res.undoable).toBe(true)
    expect(res).not.toHaveProperty('undoSnapshots')
    // both dragged windows actually landed (wd + wb + wc) — not just the anchor
    expect(res.next.available[2].windows).toHaveLength(3)
  })

  it('a multi-window drop INTO Now Open opens a real window per selected window (undoable:false)', () => {
    const s = twoGroupsThreeWindows()
    const { m, winRef, groupRef, wid } = refs(s)
    const active = { ...winRef(1, 1), selectionIds: [wid(1, 1), wid(1, 2)] }

    const res = applyMove(m, s, active, groupRef(0))

    expect(res.undoable).toBe(false)
    const creates = res.sideEffects.filter((e) => e.type === 'windows.create')
    expect(creates).toHaveLength(2)
    // every new real window is unfocused — a focused one dismisses the toolbar popup
    expect(creates.every((e) => (e as { focused?: boolean }).focused === false)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Item 8 — moveTabsMulti cross-GROUP via a sidebar group row (tighten coverage)
// ─────────────────────────────────────────────────────────────────────────────

describe('applyMove — multi-TAB move onto a sidebar group row (item 8: cross-group)', () => {
  it('puts the whole ordered run into ONE NEW window at the END of the target group (existing windows untouched)', () => {
    const s = state([
      group('now-open', [], { permanent: true }),
      group('saved-a', [win([tab('t1'), tab('t2'), tab('t3'), tab('t4')])]),
      group('saved-b', [win([tab('x1')]), win([tab('y1'), tab('y2')])])
    ])
    const { m, tabRef, groupRef, tid } = refs(s)
    // pick t1 + t3 (non-contiguous), anchor t1, drop onto saved-b's row
    const sel = [tid(1, 0, 0), tid(1, 0, 2)]
    const active = { ...tabRef(1, 0, 0), selectionIds: sel }

    const res = applyMove(m, s, active, groupRef(2))

    expect(res.next.available[1].windows[0].tabs.map((t) => t.title)).toEqual(['t2', 't4'])
    expect(res.next.available[2].windows.map((w) => w.tabs.map((t) => t.title))).toEqual([
      ['x1'],
      ['y1', 'y2'],
      ['t1', 't3']
    ])
    expect(res.next.available[1].pendingSync).toBe(true)
    expect(res.next.available[2].pendingSync).toBe(true)
    expect(res.undoable).toBe(true)
  })

  it('KEEPS a saved source window the multi-move emptied, alongside the windows that still have tabs', () => {
    const s = state([
      group('now-open', [], { permanent: true }),
      group('saved-a', [win([tab('t1'), tab('t2')]), win([tab('keep')]), win([tab('t3')])]),
      group('saved-b', [win([tab('x1')])])
    ])
    const { m, tabRef, groupRef, tid } = refs(s)
    // all of window 0 + all of window 2 → both empty; window 1 untouched
    const sel = [tid(1, 0, 0), tid(1, 0, 1), tid(1, 2, 0)]
    const res = applyMove(m, s, { ...tabRef(1, 0, 0), selectionIds: sel }, groupRef(2))

    // Emptied windows are KEPT (user rule, 2026-09-18) — w0 and w2 stay, now empty.
    expect(res.next.available[1].windows.map((w) => w.tabs.map((t) => t.title))).toEqual([[], ['keep'], []])
    expect(res.next.available[2].windows.map((w) => w.tabs.map((t) => t.title))).toEqual([
      ['x1'],
      ['t1', 't2', 't3']
    ])
    expect(res.undoable).toBe(true)
  })
})

describe('applyMove — multi-TAB move onto a group with ZERO windows (synthesised window)', () => {
  it('creates a single window in the empty target holding the whole run', () => {
    const s = state([
      group('now-open', [], { permanent: true }),
      group('saved-a', [win([tab('t1'), tab('t2'), tab('t3')])]),
      group('saved-b', []) // no windows at all
    ])
    const { m, tabRef, groupRef, tid } = refs(s)
    const sel = [tid(1, 0, 0), tid(1, 0, 2)]
    const active = { ...tabRef(1, 0, 0), selectionIds: sel }

    const res = applyMove(m, s, active, groupRef(2))

    expect(res.next.available[1].windows[0].tabs.map((t) => t.title)).toEqual(['t2'])
    expect(res.next.available[2].windows).toHaveLength(1)
    expect(res.next.available[2].windows[0].tabs.map((t) => t.title)).toEqual(['t1', 't3'])
  })
})

describe('applyMove — multi-WINDOW move dropped onto a specific window (dropIndex path)', () => {
  it('re-inserts the run at the target window index within the same group without drift', () => {
    const s = state([
      group('now-open', [], { permanent: true }),
      group('saved-a', [
        win([tab('a1')], { name: 'w0' }),
        win([tab('a2')], { name: 'w1' }),
        win([tab('a3')], { name: 'w2' })
      ])
    ])
    const { m, wid } = refs(s)
    // select w0 + w1, drop onto w2 (a window target with an explicit index)
    const sel = [wid(1, 0), wid(1, 1)]
    const active = { type: 'window' as const, id: wid(1, 0), selectionIds: sel }
    const over = { type: 'window' as const, id: wid(1, 2), index: 2 }

    const res = applyMove(m, s, active, over)

    // no window lost or duplicated; original order preserved
    expect(res.next.available[1].windows.map((w) => w.name)).toEqual(['w0', 'w1', 'w2'])
    expect(new Set(res.next.available[1].windows.map((w) => w.name)).size).toBe(3)
    expect(res.undoable).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Item 9 — Now Open window invariants
// ─────────────────────────────────────────────────────────────────────────────

describe('applyMove — LIVE window dragged out of Now Open (item 9)', () => {
  function nowOpenWithLiveWindow() {
    return state([
      group('now-open', [liveWin(500, [liveTab(9, 'live-9'), liveTab(10, 'live-10')])], { permanent: true }),
      group('saved-a', [win([tab('a1')])])
    ])
  }

  it('actually appends the dragged live window to the target saved group', () => {
    const s = nowOpenWithLiveWindow()
    const { m, winRef, groupRef } = refs(s)

    const res = applyMove(m, s, winRef(0, 0), groupRef(1))

    // saved-a must GAIN the window (2 windows now), not stay a no-op
    expect(res.next.available[1].windows).toHaveLength(2)
    const merged = res.next.available[1].windows.flatMap((w) => w.tabs.map((t) => t.title))
    expect(merged).toEqual(expect.arrayContaining(['live-9', 'live-10']))
  })

  it('is not undoable and bumps the receiving saved group', () => {
    const s = nowOpenWithLiveWindow()
    const beforeA = s.available[1].updatedAt
    const { m, winRef, groupRef } = refs(s)

    const res = applyMove(m, s, winRef(0, 0), groupRef(1))

    expect(res.undoable).toBe(false)
    expect(res.next.available[1].updatedAt).toBeGreaterThan(beforeA)
    expect(res.next.available[1].pendingSync).toBe(true)
  })

  it('is a MOVE: emits one tabs.remove naming every real tab of the live window', () => {
    const s = nowOpenWithLiveWindow()
    const { m, winRef, groupRef } = refs(s)

    const res = applyMove(m, s, winRef(0, 0), groupRef(1))

    // The real window goes with its last tab — at the drop, unless it is the popup's own
    // window: `runSideEffects` defers THAT window's active tab to popup teardown, so this
    // never dismisses the popup mid-drop (spec C7).
    expect(res.sideEffects).toEqual([{ type: 'tabs.remove', tabIds: [9, 10] }])
  })

  it('leaves available[permIndex] (Now Open) structurally untouched and detaches the copy', () => {
    const s = nowOpenWithLiveWindow()
    const { m, winRef, groupRef } = refs(s)

    const res = applyMove(m, s, winRef(0, 0), groupRef(1))

    // Now Open re-syncs from the browser — the model copy must not be mutated
    expect(res.next.available[0]).toEqual(s.available[0])
    // the detached copy landed in the saved group with id:0 tabs and focused:false
    const copy = res.next.available[1].windows.find((w) =>
      w.tabs.some((t) => t.title === 'live-9')
    )!
    expect(copy.id).toBe(0)
    expect(copy.focused).toBe(false)
    expect(copy.tabs.every((t) => t.id === 0)).toBe(true)
  })

  it('closes exactly the live tabs it moved (ids 9 + 10, never a saved id 0) and is not undoable', () => {
    const s = nowOpenWithLiveWindow() // live window 500 with tabs id 9 + id 10
    const { m, winRef, groupRef } = refs(s)

    const res = applyMove(m, s, winRef(0, 0), groupRef(1))

    const removals = res.sideEffects.filter((e) => e.type === 'tabs.remove')
    expect(removals).toHaveLength(1)
    expect((removals[0] as { tabIds: number[] }).tabIds).toEqual([9, 10])
    // Undo cannot faithfully reopen a closed tab.
    expect(res.undoable).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Item 8 — moveWindowsMulti spanning TWO source groups
// ─────────────────────────────────────────────────────────────────────────────

describe('applyMove — multi-WINDOW move across two source groups', () => {
  function threeGroups() {
    return state([
      group('now-open', [], { permanent: true }),
      group('saved-a', [
        win([tab('a1')], { name: 'wa1' }),
        win([tab('a2')], { name: 'wa2' })
      ]),
      group('saved-b', [win([tab('b1')], { name: 'wb1' })]),
      group('saved-c', [win([tab('c1')], { name: 'wc1', starred: true })])
    ])
  }

  it('moves a 3-window selection from two source groups onto a third; order preserved, every non-permanent source bumped, one undo', () => {
    const s = threeGroups()
    const beforeA = s.available[1].updatedAt
    const beforeB = s.available[2].updatedAt
    const { m, wid, groupRef } = refs(s)
    // wa1, wa2 (from saved-a) + wb1 (from saved-b), anchor wa1, drop onto saved-c
    const sel = [wid(1, 0), wid(1, 1), wid(2, 0)]
    const active = { type: 'window' as const, id: wid(1, 0), selectionIds: sel }

    const res = applyMove(m, s, active, groupRef(3))

    // both source groups emptied
    expect(res.next.available[1].windows).toHaveLength(0)
    expect(res.next.available[2].windows).toHaveLength(0)
    // all three landed in saved-c, source order preserved after the target's starred window
    const names = res.next.available[3].windows.map((w) => w.name)
    expect(names).toEqual(['wc1', 'wa1', 'wa2', 'wb1'])
    // every touched non-permanent source group bumped + pendingSync
    expect(res.next.available[1].updatedAt).toBeGreaterThan(beforeA)
    expect(res.next.available[2].updatedAt).toBeGreaterThan(beforeB)
    expect(res.next.available[1].pendingSync).toBe(true)
    expect(res.next.available[2].pendingSync).toBe(true)
    expect(res.next.available[3].pendingSync).toBe(true)
    // one logical op
    expect(res.undoable).toBe(true)
    expect(res).not.toHaveProperty('undoSnapshots')
  })
})
