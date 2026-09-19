/**
 * dndMoveMultiRules.test.ts — multi-item drag commit rules (rbd multi-drag pattern) plus
 * two regression sweeps over EVERY move the engine can make:
 *   - no saved tab produced by any DnD move carries a nonzero (real browser) id — a saved
 *     tab with a real id could close the real tab when later removed via `useGroups`
 *   - every DnD `tabs.create` is `active:false` and every `windows.create` `focused:false`
 *     (activating / focusing takes focus from the popup's anchor window → popup dismissed)
 */
import { describe, it, expect } from 'vitest'
import { applyMove, canDrop, type DndRef } from '@/lib/dndMove'
import { buildDndModel } from '@/hooks/useDndModel'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

const tab = (t: string, over: Partial<Tab> = {}): Tab => ({ id: 0, title: t, url: `https://e.x/${t}`, ...over })
const win = (tabs: Tab[], over: Partial<ExtWindow> = {}): ExtWindow => ({ id: 0, tabs, incognito: false, focused: false, ...over })
const group = (id: string, windows: ExtWindow[], over: Partial<Group> = {}): Group => ({
  id,
  name: id,
  color: 'rgba(0,0,0,1)',
  updatedAt: 1,
  windows,
  ...over
})

function seed(): GroupsState {
  return {
    active: { id: 'now', index: 0 },
    available: [
      group('now', [win([tab('live1', { id: 11 }), tab('live2', { id: 12 })], { id: 700 }), win([tab('live3', { id: 13 })], { id: 701 })], { permanent: true }),
      group('work', [win([tab('a1'), tab('a2'), tab('a3')]), win([tab('b1'), tab('b2')])]),
      group('play', [win([tab('p1'), tab('p2')], { starred: true })])
    ]
  }
}

const titles = (g: Group) => g.windows.map((w) => w.tabs.map((t) => t.title))
const tabRef = (id: string, selectionIds?: string[]): DndRef => ({ type: 'tab', id, selectionIds })
const winRef = (id: string, selectionIds?: string[]): DndRef => ({ type: 'window', id, selectionIds })
const groupRef = (id: string): DndRef => ({ type: 'group', id })

function move(active: DndRef, over: DndRef, s = seed()) {
  const m = buildDndModel(s)
  expect(canDrop(m, active, over)).toBe(true)
  return { s, res: applyMove(m, s, active, over) }
}

describe('multi-TAB commit rules', () => {
  const SEL = ['work::w0::t0', 'work::w1::t0', 'work::w1::t1'] // a1, b1, b2

  it('onto a TAB position: ONE contiguous block at the gap in original order; sources removed; the emptied saved window KEPT; ONE undoable op; landed positions reported', () => {
    const { res } = move(tabRef(SEL[1], SEL), tabRef('play::w0::t1')) // before p2
    const [, work, play] = res.next.available
    expect(titles(play)).toEqual([['p1', 'a1', 'b1', 'b2', 'p2']])
    expect(titles(work)).toEqual([['a2', 'a3'], []]) // w1 emptied → KEPT (user rule)
    expect(res.undoable).toBe(true)
    expect(res.sideEffects).toEqual([])
    expect(res.landed).toEqual({
      type: 'tab',
      positions: [1, 2, 3].map((tabIndex) => ({ groupIndex: 2, windowIndex: 0, tabIndex }))
    })
  })

  it('selection order is SOURCE order (group, window, tab), not click order', () => {
    const { res } = move(tabRef('work::w1::t1', ['work::w1::t1', 'work::w0::t2', 'work::w0::t0']), tabRef('play::w0::t0'))
    expect(titles(res.next.available[2])).toEqual([['a1', 'a3', 'b2', 'p1', 'p2']])
  })

  it('onto a sidebar GROUP ROW: all selected tabs go into ONE new last window of that group', () => {
    const { res } = move(tabRef(SEL[0], SEL), groupRef('play'))
    expect(titles(res.next.available[2])).toEqual([['p1', 'p2'], ['a1', 'b1', 'b2']])
    expect(res.landed?.positions).toHaveLength(3)
  })

  it('onto the NEW-WINDOW zone: ONE new window holding all selected tabs', () => {
    const { res } = move(tabRef(SEL[0], SEL), { type: 'new-window', id: 'work::new-window', groupId: 'work', groupIndex: 1 })
    // w1 was emptied by the move and is KEPT, so the new window lands after it.
    expect(titles(res.next.available[1])).toEqual([['a2', 'a3'], [], ['a1', 'b1', 'b2']])
  })

  it('OUT of Now Open onto a saved group is a MOVE: detached (id 0, savedAt), Now Open model untouched, the real tabs closed, not undoable', () => {
    const sel = ['now::w0::t0', 'now::w1::t0']
    const { s, res } = move(tabRef(sel[0], sel), groupRef('work'))
    const copies = res.next.available[1].windows[2].tabs
    expect(copies.map((t) => t.title)).toEqual(['live1', 'live3'])
    for (const t of copies) {
      expect(t.id).toBe(0)
      expect(typeof t.savedAt).toBe('number')
    }
    expect(res.next.available[0]).toBe(s.available[0])
    // live1 (id 11) + live3 (id 13) — the two dragged live tabs, in selection order.
    expect(res.sideEffects).toEqual([{ type: 'tabs.remove', tabIds: [11, 13] }])
    expect(res.undoable).toBe(false)
  })

  it('a SAVED selection onto the Now Open ROW opens ONE unfocused real window with every URL; sources leave their groups; not undoable; nothing landed', () => {
    const { res } = move(tabRef(SEL[0], SEL), groupRef('now'))
    expect(res.sideEffects).toEqual([
      { type: 'windows.create', url: ['https://e.x/a1', 'https://e.x/b1', 'https://e.x/b2'], focused: false }
    ])
    expect(titles(res.next.available[1])).toEqual([['a2', 'a3'], []]) // emptied w1 kept
    expect(res.undoable).toBe(false)
    expect(res.landed).toBeUndefined()
  })

  it('a selection onto a LIVE Now Open tab: live members move contiguously (one tabs.move), saved members open as BACKGROUND tabs right after', () => {
    const sel = ['now::w1::t0', 'work::w0::t0']
    const { res } = move(tabRef(sel[1], sel), tabRef('now::w0::t1'))
    expect(res.sideEffects).toEqual([
      { type: 'tabs.move', tabId: 13, windowId: 700, index: 1 },
      { type: 'tabs.create', windowId: 700, url: 'https://e.x/a1', index: 2, active: false }
    ])
    expect(titles(res.next.available[1])).toEqual([['a2', 'a3'], ['b1', 'b2']])
    expect(res.undoable).toBe(false)
  })

  it('a selection containing a LIVE tab cannot target the Now Open row', () => {
    const s = seed()
    expect(canDrop(buildDndModel(s), tabRef('now::w0::t0', ['now::w0::t0', 'work::w0::t0']), groupRef('now'))).toBe(false)
  })

  it('a selected item is never a drop target for its own selection', () => {
    const s = seed()
    expect(canDrop(buildDndModel(s), tabRef(SEL[0], SEL), tabRef(SEL[1]))).toBe(false)
  })
})

describe('multi-WINDOW commit rules', () => {
  it('onto a group ROW: the selected windows become new last windows, starred-first kept, emptied source group keeps 0 windows; landed reported', () => {
    const sel = ['work::w0', 'work::w1']
    const { res } = move(winRef(sel[0], sel), groupRef('play'))
    expect(titles(res.next.available[2])).toEqual([['p1', 'p2'], ['a1', 'a2', 'a3'], ['b1', 'b2']])
    expect(res.next.available[2].windows[0].starred).toBe(true)
    expect(res.next.available[1].windows).toEqual([])
    expect(res.undoable).toBe(true)
    expect(res.landed).toEqual({ type: 'window', positions: [1, 2].map((windowIndex) => ({ groupIndex: 2, windowIndex })) })
  })

  it('live Now Open windows in a selection are MOVED: detached copies land (window + tab ids 0) and every real tab is closed', () => {
    const sel = ['now::w0', 'now::w1']
    const { s, res } = move(winRef(sel[0], sel), groupRef('work'))
    const added = res.next.available[1].windows.slice(2)
    expect(added.map((w) => w.id)).toEqual([0, 0])
    expect(added.flatMap((w) => w.tabs.map((t) => t.id))).toEqual([0, 0, 0])
    expect(res.next.available[0]).toBe(s.available[0])
    expect(res.sideEffects).toEqual([{ type: 'tabs.remove', tabIds: [11, 12, 13] }])
  })
})

// ─── sweeps ──────────────────────────────────────────────────────────────────

function allMoves(s: GroupsState) {
  const m = buildDndModel(s)
  const tabIds = Object.keys(m.tabs)
  const winIds = Object.keys(m.windows)
  const actives: DndRef[] = [
    ...tabIds.map((id) => tabRef(id)),
    ...winIds.map((id) => winRef(id)),
    tabRef('now::w0::t0', ['now::w0::t0', 'now::w0::t1']),
    tabRef('now::w0::t0', ['now::w0::t0', 'work::w1::t0']),
    tabRef('work::w0::t0', ['work::w0::t0', 'work::w1::t1', 'play::w0::t0']),
    winRef('now::w0', ['now::w0', 'work::w1']),
    winRef('work::w0', ['work::w0', 'work::w1'])
  ]
  const overs: DndRef[] = [
    ...tabIds.map((id) => tabRef(id)),
    ...winIds.map((id) => winRef(id)),
    ...m.groupIds.map((id) => groupRef(id)),
    ...m.groupIds
      .filter((id) => id !== m.permanentGroupId)
      .map((id) => ({ type: 'new-window' as const, id: `${id}::new-window`, groupId: id, groupIndex: m.groups[id].index }))
  ]
  const out: Array<{ a: DndRef; o: DndRef; res: ReturnType<typeof applyMove> }> = []
  for (const a of actives) for (const o of overs) if (canDrop(m, a, o)) out.push({ a, o, res: applyMove(m, s, a, o) })
  return out
}

describe('REGRESSION sweeps over every single and multi move', () => {
  it('NO saved tab produced by ANY DnD move has a nonzero id', () => {
    const moves = allMoves(seed())
    expect(moves.length).toBeGreaterThan(100)
    for (const { a, o, res } of moves) {
      for (const g of res.next.available) {
        if (g.permanent) continue
        for (const w of g.windows) {
          for (const t of w.tabs) {
            if (t.id !== 0) throw new Error(`saved tab "${t.title}" kept id ${t.id} after ${JSON.stringify(a)} → ${JSON.stringify(o)}`)
          }
        }
      }
    }
  })

  it('every tabs.create is active:false, every windows.create is focused:false, and every tabs.remove names only REAL live ids', () => {
    let creates = 0
    let removes = 0
    for (const { res } of allMoves(seed())) {
      for (const fx of res.sideEffects as Array<{
        type: string
        active?: boolean
        focused?: boolean
        tabIds?: number[]
      }>) {
        expect(['tabs.move', 'tabs.create', 'windows.create', 'tabs.remove']).toContain(fx.type)
        if (fx.type === 'tabs.create') {
          creates++
          expect(fx.active).toBe(false)
        }
        if (fx.type === 'windows.create') {
          creates++
          expect(fx.focused).toBe(false)
        }
        if (fx.type === 'tabs.remove') {
          removes++
          // A saved tab is `id: 0`; closing "tab 0" would be a bug, and a drag out of
          // Now Open must never try to close a tab it didn't move.
          expect(fx.tabIds!.length).toBeGreaterThan(0)
          expect(fx.tabIds!.every((id) => Number.isInteger(id) && id > 0)).toBe(true)
        }
      }
    }
    expect(creates).toBeGreaterThan(0)
    expect(removes).toBeGreaterThan(0)
  })

  it('anything touching Now Open is not undoable; saved-only moves are', () => {
    const s = seed()
    const m = buildDndModel(s)
    const perm = m.groups[m.permanentGroupId].index
    const gi = (id: string) => m.tabs[id]?.groupIndex ?? m.windows[id]?.groupIndex ?? m.groups[id]?.index ?? (id.endsWith('::new-window') ? m.groups[id.slice(0, -12)].index : -1)
    for (const { a, o, res } of allMoves(s)) {
      if (res.next === s && res.sideEffects.length === 0) continue // NOOP
      const touchesNow = [...(a.selectionIds ?? [a.id]), o.id].some((id) => gi(id) === perm)
      if (touchesNow) expect(res.undoable).toBe(false)
      else expect(res.undoable).toBe(true)
    }
  })
})
