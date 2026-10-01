/**
 * keyboardMove.test.ts — the pure keyboard MOVE MODE model, as a matrix of the approved
 * behaviour. Every case is a plain function of (groups state, source, key presses): the
 * `press` helper below plays the part of the controller (`useKeyboardMove`) for the keys that
 * need the group list, and the commit half runs the REAL `applyMove` (the engine pointer
 * drops use), so a target that would commit something different from what it announces fails
 * here.
 *
 * Spec encoded here:
 *  - main panel: Up/Down walk the shown group and WRAP; Left enters the group list (cursor on
 *    the shown group, item at the END of it); Right does nothing.
 *  - group list: Up/Down choose a group (wrapping, "New group" last when allowed); Right enters
 *    the highlighted group (never on "New group"); Left does nothing.
 *  - groups: Up/Down reorder among saved groups, wrapping, never above Now Open; Left/Right nothing.
 */
import { describe, it, expect } from 'vitest'
import { buildDndModel } from '@/hooks/useDndModel'
import { applyMove } from '@/lib/dndMove'
import {
  activeRefFor,
  buildNewGroupTargets,
  buildTargets,
  currentTarget,
  describeGroupEntry,
  describeListStop,
  describePickup,
  describeWrap,
  endIndex,
  enterGroup,
  enterList,
  enterListScope,
  groupStops,
  listNeighbor,
  listStops,
  rebuildMove,
  startMove,
  stepMove,
  wouldWrap,
  type MoveKind,
  type MoveOptions,
  type MoveScope,
  type MoveState
} from '@/lib/keyboardMove'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

const tab = (title: string, id = 0): Tab => ({ id, title, url: `https://example.com/${title.toLowerCase()}` })
const win = (titles: string[], extra: Partial<ExtWindow> = {}): ExtWindow => ({
  id: 0,
  tabs: titles.map((t) => tab(t)),
  incognito: false,
  focused: false,
  ...extra
})
const grp = (id: string, name: string, windows: ExtWindow[], extra: Partial<Group> = {}): Group => ({
  id,
  name,
  color: 'rgba(1,2,3,1)',
  updatedAt: 1,
  windows,
  ...extra
})

/** Now Open (2 live windows), Work (2 windows), Play, Extra, Quad. */
function fixture(): GroupsState {
  return {
    active: { id: 'now', index: 0 },
    available: [
      grp(
        'now',
        'Now Open',
        [
          { id: 101, incognito: false, focused: true, tabs: [tab('L1', 11), tab('L2', 12), tab('L3', 13)] },
          { id: 102, incognito: false, focused: false, tabs: [tab('L4', 14), tab('L5', 15)] }
        ],
        { permanent: true }
      ),
      grp('work', 'Work', [win(['Alpha', 'Bravo', 'Charlie']), win(['Delta', 'Echo'])]),
      grp('play', 'Play', [win(['Foxtrot'])]),
      grp('extra', 'Extra', [win(['Golf'])]),
      grp('quad', 'Quad', [win(['Hotel'])])
    ]
  }
}

const OPTS = (gi: number, more: Partial<MoveOptions> = {}): MoveOptions => ({ activeGroupIndex: gi, newGroupAllowed: true, ...more })
const model = (s: GroupsState) => buildDndModel(s)
const tabId = (gid: string, wi: number, ti: number) => `${gid}::w${wi}::t${ti}`
const src = (kind: MoveKind, anchorId: string, ids = [anchorId]) => ({ kind, anchorId, ids })

type Key = 'down' | 'up' | 'left' | 'right'

/**
 * Plays the controller: Up/Down in `main` step the target list; in `list` they hop to the next
 * group stop that offers a target (`listStops` + `listNeighbor` + `enterListScope`); Left =
 * `enterList`, Right = `enterGroup`. A key that does nothing returns the SAME state object.
 */
function press(ms: MoveState, s: GroupsState, opts: MoveOptions, ...keys: Key[]): MoveState {
  return keys.reduce((cur, k) => {
    if (k === 'left') return enterList(cur) ?? cur
    if (k === 'right') return enterGroup(cur) ?? cur
    const dir = k
    if (cur.mode === 'main') return stepMove(cur, dir)
    const stops = listStops(s, cur.source, opts)
    let from: MoveScope = cur.scope
    for (let guard = 0; guard < 32; guard++) {
      const hop = listNeighbor(from, dir, stops)
      if (!hop) return cur
      const entered = enterListScope(cur, hop.scope, s, opts)
      if (entered) return entered
      from = hop.scope
    }
    return cur
  }, ms)
}
const texts = (ms: MoveState) => ms.targets.map((t) => t.text)

/** Commit the current target with the real engine and return the resulting state + effects. */
function commit(s: GroupsState, ms: MoveState) {
  const t = currentTarget(ms)
  if (!t?.over) return { next: s, sideEffects: [], undoable: false } as ReturnType<typeof applyMove>
  return applyMove(model(s), s, activeRefFor(ms.source), t.over)
}
const layout = (s: GroupsState, gid: string) => s.available.find((g) => g.id === gid)!.windows.map((w) => w.tabs.map((t) => t.title))
const newest = (s: GroupsState) => s.available[s.available.length - 1]

describe('saved tab (Bravo, position 2 of Work window 1)', () => {
  const s = fixture()
  const o = OPTS(1)
  const start = () => startMove(s, src('tab', tabId('work', 0, 1)), o)

  it('starts on its own slot in the main panel; the targets are slots, then the new-window zone', () => {
    const ms = start()
    expect(ms.mode).toBe('main')
    expect(ms.scope).toBe(1)
    expect(ms.originGroup).toBe(1)
    expect(currentTarget(ms)?.text).toBe('Bravo, original position')
    expect(currentTarget(ms)?.origin).toBe(true)
    expect(texts(ms)).toEqual([
      'Bravo, first in Window 1',
      'Bravo, original position',
      'Bravo, last in Window 1',
      'Bravo, first in Window 2',
      'Bravo, position 2 of 3 in Window 2',
      'Bravo, last in Window 2',
      'Bravo, in a new window'
    ])
  })

  it('every target carries the gap the pointer would show: its list and the rows it displaces', () => {
    const ms = start()
    const first = ms.targets[0]
    expect(first.gap).toEqual({ containerKey: 'work::w0', shiftIds: [tabId('work', 0, 0), tabId('work', 0, 2)] })
    expect(ms.targets[2].gap.shiftIds).toEqual([]) // the end slot displaces nothing
    const zone = ms.targets[ms.targets.length - 1]
    expect(zone.zone).toBe(true)
    expect(zone.gap).toEqual({ containerKey: null, shiftIds: [] })
    expect(zone.marker).toEqual({ type: 'zone', zone: 'new-window' })
  })

  it('Down reorders to after Charlie; Up to before Alpha', () => {
    expect(layout(commit(s, press(start(), s, o, 'down')).next, 'work')).toEqual([['Alpha', 'Charlie', 'Bravo'], ['Delta', 'Echo']])
    expect(layout(commit(s, press(start(), s, o, 'up')).next, 'work')).toEqual([['Bravo', 'Alpha', 'Charlie'], ['Delta', 'Echo']])
  })

  it('Down crosses into Window 2 (first slot, then each slot, then its end), then the new-window zone', () => {
    const ms = press(start(), s, o, 'down', 'down')
    expect(currentTarget(ms)?.text).toBe('Bravo, first in Window 2')
    expect(layout(commit(s, ms).next, 'work')).toEqual([['Alpha', 'Charlie'], ['Bravo', 'Delta', 'Echo']])
    const endOfW2 = press(start(), s, o, 'down', 'down', 'down', 'down')
    expect(layout(commit(s, endOfW2).next, 'work')).toEqual([['Alpha', 'Charlie'], ['Delta', 'Echo', 'Bravo']])
    const zone = press(endOfW2, s, o, 'down')
    expect(currentTarget(zone)?.key).toBe('zone:new-window')
    expect(layout(commit(s, zone).next, 'work')).toEqual([['Alpha', 'Charlie'], ['Delta', 'Echo'], ['Bravo']])
  })

  it('Down from the new-window zone WRAPS to the top; Up from the top WRAPS to the zone', () => {
    const atZone = press(start(), s, o, 'down', 'down', 'down', 'down', 'down')
    expect(currentTarget(atZone)?.key).toBe('zone:new-window')
    expect(wouldWrap(atZone, 'down')).toBe(true)
    expect(wouldWrap(atZone, 'up')).toBe(false)
    const top = stepMove(atZone, 'down')
    expect(top.index).toBe(0)
    expect(currentTarget(top)?.text).toBe('Bravo, first in Window 1')
    expect(wouldWrap(top, 'up')).toBe(true)
    expect(stepMove(top, 'up').index).toBe(atZone.index)
  })

  it('a full lap of N Down presses returns to the origin; every stop is distinct', () => {
    let ms = start()
    const n = ms.targets.length
    const seen = new Set<string>()
    for (let i = 0; i < n; i++) {
      seen.add(currentTarget(ms)!.key)
      ms = press(ms, s, o, 'down')
    }
    expect(seen.size).toBe(n)
    expect(ms.index).toBe(start().index)
  })

  it('Right in the main panel does nothing (same object)', () => {
    const ms = start()
    expect(press(ms, s, o, 'right')).toBe(ms)
  })

  it('Left enters the group list: cursor on the shown group, the item held at the END of it', () => {
    const ms = press(start(), s, o, 'left')
    expect(ms.mode).toBe('list')
    expect(ms.scope).toBe(1)
    expect(currentTarget(ms)?.text).toBe('Bravo, last in Window 2')
    expect(layout(commit(s, ms).next, 'work')).toEqual([['Alpha', 'Charlie'], ['Delta', 'Echo', 'Bravo']])
  })

  it('in the list Up/Down choose a group; the drop lands at the END of the highlighted group', () => {
    const inList = press(start(), s, o, 'left')
    const play = press(inList, s, o, 'down')
    expect(play.scope).toBe(2)
    expect(currentTarget(play)?.text).toBe('Bravo, last in Window 1')
    const next = commit(s, play).next
    expect(layout(next, 'play')).toEqual([['Foxtrot', 'Bravo']])
    expect(layout(next, 'work')).toEqual([['Alpha', 'Charlie'], ['Delta', 'Echo']])
  })

  it('the group list wraps in both directions and ends with the "New group" stop', () => {
    const inList = press(start(), s, o, 'left')
    expect(listStops(s, inList.source, o)).toEqual([0, 1, 2, 3, 4, 'new-group'])
    const up = press(inList, s, o, 'up') // Work -> Now Open
    expect(up.scope).toBe(0)
    const wrapped = press(up, s, o, 'up') // Now Open -> New group (wrapped)
    expect(wrapped.scope).toBe('new-group')
    expect(listNeighbor(0, 'up', listStops(s, inList.source, o))).toEqual({ scope: 'new-group', wrapped: true })
    const back = press(wrapped, s, o, 'down') // New group -> Now Open (wrapped)
    expect(back.scope).toBe(0)
    expect(listNeighbor('new-group', 'down', listStops(s, inList.source, o))).toEqual({ scope: 0, wrapped: true })
  })

  it('on "New group" the target is the new-group zone and Space would create a group holding the tab', () => {
    const ms = press(start(), s, o, 'left', 'down', 'down', 'down', 'down') // Play, Extra, Quad, New group
    expect(ms.scope).toBe('new-group')
    expect(currentTarget(ms)?.key).toBe('zone:new-group')
    expect(currentTarget(ms)?.marker).toEqual({ type: 'zone', zone: 'new-group' })
    const next = commit(s, ms).next
    expect(next.available).toHaveLength(6)
    expect(layout(next, newest(next).id)).toEqual([['Bravo']])
    expect(layout(next, 'work')).toEqual([['Alpha', 'Charlie'], ['Delta', 'Echo']])
  })

  it('Right enters the highlighted group (back to main, item already at its end); Right on "New group" does nothing', () => {
    const inPlay = press(start(), s, o, 'left', 'down')
    const entered = press(inPlay, s, o, 'right')
    expect(entered.mode).toBe('main')
    expect(entered.scope).toBe(2)
    expect(entered.index).toBe(inPlay.index)
    expect(layout(commit(s, entered).next, 'play')).toEqual([['Foxtrot', 'Bravo']])
    expect(describeGroupEntry(s, entered)).toBe('Play: Bravo, last in Window 1')

    const onNew = press(start(), s, o, 'left', 'down', 'down', 'down', 'down')
    expect(onNew.scope).toBe('new-group')
    expect(enterGroup(onNew)).toBeNull()
    expect(press(onNew, s, o, 'right')).toBe(onNew)
  })

  it('Left inside the list does nothing', () => {
    const inList = press(start(), s, o, 'left')
    expect(enterList(inList)).toBeNull()
    expect(press(inList, s, o, 'left')).toBe(inList)
  })

  it('walking the entered group with Up/Down moves within THAT group', () => {
    const inPlay = press(start(), s, o, 'left', 'down', 'right')
    const up = stepMove(inPlay, 'up')
    expect(currentTarget(up)?.text).toBe('Bravo, first in Window 1')
    expect(layout(commit(s, up).next, 'play')).toEqual([['Bravo', 'Foxtrot']])
  })

  it('"New group" is not offered at the free-tier group cap', () => {
    const capped = OPTS(1, { newGroupAllowed: false })
    expect(buildNewGroupTargets(s, src('tab', tabId('work', 0, 1)), capped)).toEqual([])
    expect(listStops(s, src('tab', tabId('work', 0, 1)), capped)).toEqual([0, 1, 2, 3, 4])
  })

  it('groups the rows do not render (hidden / filtered) are skipped in the list', () => {
    const noExtra = OPTS(1, { isVisible: (id) => id !== 'extra' })
    expect(groupStops(s, src('tab', tabId('work', 0, 1)), noExtra)).toEqual([0, 1, 2, 4])
    const ms = startMove(s, src('tab', tabId('work', 0, 1)), noExtra)
    const atQuad = press(ms, s, noExtra, 'left', 'down', 'down') // Play, then Quad (Extra skipped)
    expect(atQuad.scope).toBe(4)
  })

  it('enterListScope refuses the sidebar scope and a scope with no target', () => {
    const ms = start()
    expect(enterListScope(ms, 'sidebar', s, o)).toBeNull()
    const none = enterListScope(ms, 'new-group', s, OPTS(1, { newGroupAllowed: false }))
    expect(none).toBeNull()
  })
})

describe('endIndex / listNeighbor / listStops edge cases', () => {
  it('endIndex is the last slot among rows, ignoring the zone; -1 for an empty list', () => {
    const s = fixture()
    const ms = startMove(s, src('tab', tabId('work', 0, 1)), OPTS(1))
    expect(endIndex(ms.targets)).toBe(ms.targets.length - 2)
    expect(endIndex([])).toBe(-1)
    const zoneOnly = ms.targets.filter((t) => t.zone)
    expect(endIndex(zoneOnly)).toBe(0)
  })

  it('listNeighbor: nothing with no stops; the first stop when the cursor is not on one; null when alone', () => {
    expect(listNeighbor(1, 'down', [])).toBeNull()
    expect(listNeighbor(7, 'down', [1, 2])).toEqual({ scope: 1, wrapped: false })
    expect(listNeighbor(1, 'down', [1])).toBeNull()
    expect(listNeighbor(1, 'down', [1, 2])).toEqual({ scope: 2, wrapped: false })
    expect(listNeighbor(2, 'down', [1, 2])).toEqual({ scope: 1, wrapped: true })
    expect(listNeighbor(1, 'up', [1, 2])).toEqual({ scope: 2, wrapped: true })
  })

  it('a group source has no list stops and cannot enter the list', () => {
    const s = fixture()
    const g = startMove(s, src('group', 'work'), OPTS(1))
    expect(listStops(s, g.source, OPTS(1))).toEqual([])
    expect(groupStops(s, g.source, OPTS(1))).toEqual([])
    expect(buildNewGroupTargets(s, g.source, OPTS(1))).toEqual([])
    expect(enterList(g)).toBeNull()
  })

  it('stepMove with one target (or none) returns the same object and never wraps', () => {
    const s = fixture()
    const lone = startMove(s, src('window', 'play::w0'), OPTS(2))
    expect(lone.targets).toHaveLength(1)
    expect(stepMove(lone, 'down')).toBe(lone)
    expect(wouldWrap(lone, 'down')).toBe(false)
  })

  it('describeWrap / describeListStop / describeGroupEntry wording', () => {
    const s = fixture()
    expect(describeWrap('down')).toBe('Wrapped to top.')
    expect(describeWrap('up')).toBe('Wrapped to bottom.')
    expect(describeListStop(s, 'new-group')).toBe('Group list: New group')
    expect(describeListStop(s, 2)).toBe('Group list: Play')
    expect(describeListStop(s, 'sidebar')).toBe('Group list: ')
    const ms = startMove(s, src('tab', tabId('work', 0, 1)), OPTS(1))
    expect(describeGroupEntry(s, { ...ms, scope: 'sidebar' })).toMatch(/^: /)
  })
})

describe('several selected tabs (Alpha + Bravo)', () => {
  const s = fixture()
  const o = OPTS(1)
  const ids = [tabId('work', 0, 0), tabId('work', 0, 1)]
  const start = () => startMove(s, src('tab', ids[1], ids), o)

  it('the moving tabs are never their own slots: the origin slot, then Charlie\'s far side', () => {
    const ms = start()
    expect(texts(ms).slice(0, 2)).toEqual(['2 tabs, original position', '2 tabs, last in Window 1'])
  })

  it('reorder: the block lands after Charlie, in original order', () => {
    expect(layout(commit(s, press(start(), s, o, 'down')).next, 'work')).toEqual([['Charlie', 'Alpha', 'Bravo'], ['Delta', 'Echo']])
  })

  it('other window / new-window zone / other group (end of it) / new group', () => {
    expect(layout(commit(s, press(start(), s, o, 'down', 'down')).next, 'work')).toEqual([['Charlie'], ['Alpha', 'Bravo', 'Delta', 'Echo']])
    const zone = press(start(), s, o, 'down', 'down', 'down', 'down', 'down')
    expect(currentTarget(zone)?.key).toBe('zone:new-window')
    expect(layout(commit(s, zone).next, 'work')).toEqual([['Charlie'], ['Delta', 'Echo'], ['Alpha', 'Bravo']])
    expect(layout(commit(s, press(start(), s, o, 'left', 'down')).next, 'play')).toEqual([['Foxtrot', 'Alpha', 'Bravo']])
    const ng = commit(s, press(start(), s, o, 'left', 'down', 'down', 'down', 'down')).next
    expect(layout(ng, newest(ng).id)).toEqual([['Alpha', 'Bravo']])
  })

  it('a selection spread over two windows gathers into one block at the origin slot', () => {
    const spread = [tabId('work', 0, 2), tabId('work', 1, 0)] // Charlie + Delta, anchor Charlie
    const ms = startMove(s, src('tab', spread[0], spread), o)
    const next = commit(s, ms).next
    expect(layout(next, 'work').flat().sort()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'])
    expect(layout(next, 'work')[0]).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
  })

  it('the pick-up announcement counts the selection', () => {
    expect(describePickup(s, start().source)).toMatch(/^Picked up 2 tabs\./)
  })
})

describe('window (Work window 1)', () => {
  const s = fixture()
  const o = OPTS(1)
  const start = () => startMove(s, src('window', 'work::w0'), o)

  it('main targets are window slots only (no tabs, no zone); Down swaps with window 2', () => {
    const ms = start()
    expect(texts(ms)).toEqual(['Window 1, original position', 'Window 1, last in Work'])
    expect(layout(commit(s, press(ms, s, o, 'down')).next, 'work')).toEqual([['Delta', 'Echo'], ['Alpha', 'Bravo', 'Charlie']])
  })

  it('Down/Up wrap among the window slots', () => {
    const ms = start()
    const last = press(ms, s, o, 'down')
    expect(wouldWrap(last, 'down')).toBe(true)
    expect(press(last, s, o, 'down').index).toBe(0)
    expect(press(ms, s, o, 'up').index).toBe(1)
  })

  it('Left enters the list (end of Work); Down -> Play appends the window at the end; Right enters it', () => {
    const inList = press(start(), s, o, 'left')
    expect(inList.mode).toBe('list')
    const play = press(inList, s, o, 'down')
    expect(currentTarget(play)?.text).toBe('Window 1, last in Play')
    const next = commit(s, play).next
    expect(layout(next, 'play')).toEqual([['Foxtrot'], ['Alpha', 'Bravo', 'Charlie']])
    expect(layout(next, 'work')).toEqual([['Delta', 'Echo']])
    expect(press(play, s, o, 'right').mode).toBe('main')
  })

  it('"New group" creates a group holding the window', () => {
    const ms = press(start(), s, o, 'left', 'down', 'down', 'down', 'down')
    expect(ms.scope).toBe('new-group')
    const ng = commit(s, ms).next
    expect(layout(ng, newest(ng).id)).toEqual([['Alpha', 'Bravo', 'Charlie']])
  })

  it('a starred window only gets slots inside the starred zone, and wraps there', () => {
    const st = fixture()
    st.available[1] = grp('work', 'Work', [win(['A'], { starred: true }), win(['B'], { starred: true }), win(['C'])])
    const ms = startMove(st, src('window', 'work::w0'), o)
    expect(ms.targets).toHaveLength(2) // origin + after B; never below the unstarred C
    const moved = press(ms, st, o, 'down')
    expect(layout(commit(st, moved).next, 'work')).toEqual([['B'], ['A'], ['C']])
    expect(press(moved, st, o, 'down').index).toBe(0) // wrapped inside the zone
  })

  it('a starred window dropped on a group with no starred window is the group-append target', () => {
    const st = fixture()
    st.available[1] = grp('work', 'Work', [win(['A'], { starred: true }), win(['B'])])
    const ms = startMove(st, src('window', 'work::w0'), o)
    const inPlay = enterListScope(enterList(ms)!, 2, st, o)
    expect(inPlay).not.toBeNull()
    expect(currentTarget(inPlay!)?.key).toBe('win:append')
    expect(currentTarget(inPlay!)?.text).toBe('Window 1, first window in Play')
    expect(currentTarget(inPlay!)?.over).toEqual({ type: 'group', id: 'play', index: 2 })
  })

  it('a lone window has only its origin; committing it moves nothing', () => {
    const lone = fixture()
    const ms = startMove(lone, src('window', 'play::w0'), OPTS(2))
    expect(ms.targets.map((t) => t.origin)).toEqual([true])
    expect(currentTarget(ms)?.over).toBeNull()
    expect(commit(lone, ms).next).toBe(lone)
  })
})

describe('group (sidebar rows)', () => {
  const s = fixture()
  const o = OPTS(1)
  const start = (anchor = 'work', ids = [anchor]) => startMove(s, src('group', anchor, ids), o)
  const order = (st: GroupsState) => st.available.map((g) => g.id)

  it('scope is the sidebar; the main/list keys do nothing; Now Open is never a target', () => {
    const ms = start()
    expect(ms.scope).toBe('sidebar')
    expect(ms.originGroup).toBe(-1)
    expect(press(ms, s, o, 'left')).toBe(ms)
    expect(press(ms, s, o, 'right')).toBe(ms)
    expect(ms.targets.every((t) => t.over === null || t.over.id !== 'now')).toBe(true)
    expect(ms.targets.some((t) => t.key === 'zone:new-group')).toBe(false)
    expect(texts(ms)).toEqual(['Work, original position', 'Work, position 2 of 4', 'Work, position 3 of 4', 'Work, last'])
  })

  it('Up from the first saved group WRAPS to the bottom; it can never land above Now Open', () => {
    const ms = start()
    expect(wouldWrap(ms, 'up')).toBe(true)
    const wrapped = press(ms, s, o, 'up')
    expect(wrapped.index).toBe(ms.targets.length - 1)
    expect(order(commit(s, wrapped).next)).toEqual(['now', 'play', 'extra', 'quad', 'work'])
    expect(order(commit(s, wrapped).next)[0]).toBe('now')
    for (const t of ms.targets) {
      const next = t.over ? applyMove(model(s), s, activeRefFor(ms.source), t.over).next : s
      expect(order(next)[0]).toBe('now')
    }
  })

  it('Down from the last WRAPS to the origin', () => {
    const ms = start('quad')
    expect(ms.index).toBe(ms.targets.length - 1)
    expect(wouldWrap(ms, 'down')).toBe(true)
    expect(press(ms, s, o, 'down').index).toBe(0)
  })

  it('reorder Down / Up commit the right order', () => {
    expect(order(commit(s, press(start(), s, o, 'down')).next)).toEqual(['now', 'play', 'work', 'extra', 'quad'])
    expect(order(commit(s, press(start('quad'), s, OPTS(4), 'up')).next)).toEqual(['now', 'work', 'play', 'quad', 'extra'])
  })

  it('several groups move as one block', () => {
    const ms = start('work', ['work', 'play'])
    expect(order(commit(s, press(ms, s, o, 'down')).next)).toEqual(['now', 'extra', 'work', 'play', 'quad'])
    expect(texts(ms)[0]).toBe('2 groups, original position')
  })

  it('starred groups stay in their zone', () => {
    const st = fixture()
    st.available[1] = grp('work', 'Work', [win(['A'])], { starred: true })
    st.available[2] = grp('play', 'Play', [win(['B'])], { starred: true })
    const ms = startMove(st, src('group', 'work'), o)
    expect(ms.targets).toHaveLength(2) // origin + after Play; never among the unstarred
  })

  it('a lone saved group has only its origin', () => {
    const lone: GroupsState = { active: { id: 'now', index: 0 }, available: [fixture().available[0], grp('solo', 'Solo', [win(['A'])])] }
    const ms = startMove(lone, src('group', 'solo'), OPTS(1))
    expect(ms.targets).toHaveLength(1)
    expect(currentTarget(ms)?.over).toBeNull()
  })

  it('describePickup for a group has no Left key', () => {
    expect(describePickup(s, src('group', 'work'))).toBe('Picked up group Work, position 1 of 4. Up and Down arrows move it, Space drops, Escape cancels.')
  })
})

describe('Now Open (live) tab', () => {
  const s = fixture()
  const o = OPTS(0)
  const start = () => startMove(s, src('tab', tabId('now', 0, 1)), o) // L2

  it('the list offers Now Open (its own group), the saved groups and "New group"', () => {
    const ms = start()
    expect(listStops(s, ms.source, o)).toEqual([0, 1, 2, 3, 4, 'new-group'])
  })

  it('reorder within Now Open is a real tabs.move (index of the slot)', () => {
    const r = commit(s, press(start(), s, o, 'down'))
    expect(r.sideEffects).toEqual([{ type: 'tabs.move', tabId: 12, windowId: 101, index: 2 }])
    expect(r.undoable).toBe(false)
  })

  it('to the other live window moves the real tab there', () => {
    // Down: L2 -> after L3 (end of window 1) -> first of window 2
    const ms = press(start(), s, o, 'down', 'down')
    expect(currentTarget(ms)?.text).toMatch(/first in Window/)
    expect(commit(s, ms).sideEffects).toEqual([{ type: 'tabs.move', tabId: 12, windowId: 102, index: 0 }])
  })

  it('the new-window zone detaches the tab into a new browser window', () => {
    let ms = start()
    while (currentTarget(ms)?.key !== 'zone:new-window') ms = press(ms, s, o, 'down')
    expect(commit(s, ms).sideEffects).toEqual([{ type: 'tabs.detachToNewWindow', tabIds: [12] }])
  })

  it('Left then Down to a saved group MOVES the tab there (tabs.remove) at the end of the group', () => {
    const r = commit(s, press(start(), s, o, 'left', 'down'))
    expect(r.sideEffects).toEqual([{ type: 'tabs.remove', tabIds: [12] }])
    expect(layout(r.next, 'work')).toEqual([['Alpha', 'Bravo', 'Charlie'], ['Delta', 'Echo', 'L2']])
  })

  it('"New group" creates a group and closes the real tab', () => {
    const r = commit(s, press(start(), s, o, 'left', 'down', 'down', 'down', 'down', 'down'))
    expect(r.sideEffects).toEqual([{ type: 'tabs.remove', tabIds: [12] }])
    expect(r.next.available).toHaveLength(6)
  })
})

describe('extra conditions', () => {
  const o = OPTS(1)
  it('an empty window is a stop of its own ("empty") and receives the tab', () => {
    const s = fixture()
    s.available[1] = grp('work', 'Work', [win(['Alpha', 'Bravo']), win([])])
    const ms = startMove(s, src('tab', tabId('work', 0, 1)), o)
    const empty = ms.targets.find((t) => t.key === 'win:work::w1')
    expect(empty?.text).toBe('Bravo, in Window 2, empty')
    expect(empty?.gap).toEqual({ containerKey: 'work::w1', shiftIds: [] })
    expect(empty?.marker).toEqual({ type: 'box', elementId: 'work::w1' })
    const at = press(ms, s, o, 'down') // origin (after Alpha), then the empty window
    expect(currentTarget(at)?.key).toBe('win:work::w1')
    expect(layout(commit(s, at).next, 'work')).toEqual([['Alpha'], ['Bravo']])
  })

  it('a search filter (isVisible) removes hidden tabs from the slots, using the true index', () => {
    const s = fixture()
    const hidden = new Set([tabId('work', 0, 0)]) // Alpha filtered out
    const opts = OPTS(1, { isVisible: (id) => !hidden.has(id) })
    const ms = startMove(s, src('tab', tabId('work', 0, 1)), opts)
    expect(ms.targets.filter((t) => t.key.startsWith('tab:work::w0')).length).toBe(2) // rest = [Charlie]: origin + end
    const next = commit(s, press(ms, s, opts, 'down')).next
    expect(layout(next, 'work')[0]).toEqual(['Alpha', 'Charlie', 'Bravo'])
  })

  it('a whole window hidden by the filter is not walked', () => {
    const s = fixture()
    const opts = OPTS(1, { isVisible: (id) => id !== 'work::w1' })
    const ms = startMove(s, src('tab', tabId('work', 0, 1)), opts)
    expect(ms.targets.some((t) => t.key.includes('work::w1'))).toBe(false)
  })

  it('a single-window group: the tab can reach its own new-window zone', () => {
    const s = fixture()
    const opts = OPTS(2)
    const ms = startMove(s, src('tab', tabId('play', 0, 0)), opts)
    const zone = press(ms, s, opts, 'down')
    expect(currentTarget(zone)?.key).toBe('zone:new-window')
    expect(layout(commit(s, zone).next, 'play')).toEqual([[], ['Foxtrot']])
  })

  it('a lone tab in its window: the origin is its window; committing it moves nothing', () => {
    const s = fixture()
    const ms = startMove(s, src('tab', tabId('play', 0, 0)), OPTS(2))
    expect(currentTarget(ms)?.key).toBe('win:play::w0')
    expect(currentTarget(ms)?.origin).toBe(true)
    expect(currentTarget(ms)?.text).toBe('Foxtrot, original position')
  })

  it('an out-of-range shown group falls back to the nearest one instead of throwing', () => {
    const s = fixture()
    const { targets } = buildTargets(s, src('tab', tabId('work', 0, 1)), OPTS(99))
    expect(targets.length).toBeGreaterThan(0)
    expect(buildTargets(s, src('tab', tabId('work', 0, 1)), OPTS(-4)).targets.length).toBeGreaterThan(0)
  })
})

describe('rebuildMove / describePickup', () => {
  const o = OPTS(1)
  it('keeps the cursor on the same target key when the groups change under it (main)', () => {
    const s = fixture()
    const ms = press(startMove(s, src('tab', tabId('work', 0, 1)), o), s, o, 'down')
    const changed = fixture()
    changed.available[3] = grp('extra', 'Extra renamed', [win(['Golf'])])
    const rebuilt = rebuildMove(ms, changed, o)
    expect(rebuilt && currentTarget(rebuilt)?.key).toBe(currentTarget(ms)?.key)
  })

  it('in the list the cursor stays on the END of the highlighted group', () => {
    const s = fixture()
    const ms = press(startMove(s, src('tab', tabId('work', 0, 1)), o), s, o, 'left', 'down') // Play
    const changed = fixture()
    changed.available[2] = grp('play', 'Play', [win(['Foxtrot', 'Extra'])])
    const rebuilt = rebuildMove(ms, changed, o)
    expect(rebuilt?.mode).toBe('list')
    expect(rebuilt?.scope).toBe(2)
    expect(rebuilt && currentTarget(rebuilt)?.text).toBe('Bravo, last in Window 1')
  })

  it('the "New group" stop is rebuilt as the zone', () => {
    const s = fixture()
    const ms = press(startMove(s, src('tab', tabId('work', 0, 1)), o), s, o, 'left', 'down', 'down', 'down', 'down')
    const rebuilt = rebuildMove(ms, fixture(), o)
    expect(rebuilt && currentTarget(rebuilt)?.key).toBe('zone:new-group')
  })

  it('returns to the origin when the cursor target vanished, and null when the moving item is gone', () => {
    const s = fixture()
    const ms = press(startMove(s, src('tab', tabId('work', 0, 1)), o), s, o, 'down') // last in Window 1
    const smaller = fixture()
    smaller.available[1] = grp('work', 'Work', [win(['Alpha', 'Bravo']), win(['Delta', 'Echo'])])
    const rebuilt = rebuildMove(ms, smaller, o)
    expect(rebuilt).not.toBeNull()
    const noTab = fixture()
    noTab.available[1] = grp('work', 'Work', [win(['Alpha'])])
    expect(rebuildMove(ms, noTab, o)).toBeNull()
  })

  it('describePickup names the item, its position, the count and the keys', () => {
    const s = fixture()
    expect(describePickup(s, src('tab', tabId('work', 0, 1)))).toBe(
      'Picked up tab Bravo, position 2 of 3 in Window 1 of group Work. Up and Down arrows move it, Left chooses a group, Space drops, Escape cancels.'
    )
    expect(describePickup(s, src('tab', tabId('work', 0, 1), [tabId('work', 0, 0), tabId('work', 0, 1)]))).toMatch(/^Picked up 2 tabs\. /)
    expect(describePickup(s, src('tab', 'nope'))).toBe('Picked up.')
  })
})
