import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  sidebarTargets,
  mainTargets,
  groupTargets,
  pickSidebarStart,
  stepTargets,
  isSidebarType,
  getForcedKeyboardTarget,
  clearForcedKeyboardTarget,
  createKeyboardCoordinateGetter,
  type KbTargetInfo,
} from '@/lib/dndKeyboardTargets'

const rows: KbTargetInfo[] = [
  { id: 'now', type: 'group', index: 0, top: 10, left: 0 },
  { id: 'work', type: 'group', index: 1, top: 50, left: 0 },
  { id: 'other', type: 'group', index: 2, top: 90, left: 0 },
  { id: '::new-group', type: 'new-group', top: 130, left: 0 },
  // main pane: window 0 (two tabs), window 1 (one tab), window 2 (EMPTY), zone
  { id: 'g::w0', type: 'window', top: 20, left: 300 },
  { id: 'g::w0::t0', type: 'tab', windowId: 'g::w0', top: 40, left: 300 },
  { id: 'g::w0::t1', type: 'tab', windowId: 'g::w0', top: 70, left: 300 },
  { id: 'g::w1', type: 'window', top: 100, left: 300 },
  { id: 'g::w1::t0', type: 'tab', windowId: 'g::w1', top: 120, left: 300 },
  { id: 'g::w2', type: 'window', top: 150, left: 300 },
  { id: 'g::new-window', type: 'new-window', top: 300, left: 300 },
]
const ids = (t: KbTargetInfo[]) => t.map((x) => x.id)

describe('target lists', () => {
  it('classifies sidebar types', () => {
    expect(isSidebarType('group')).toBe(true)
    expect(isSidebarType('new-group')).toBe(true)
    expect(isSidebarType('tab')).toBe(false)
    expect(isSidebarType(undefined)).toBe(false)
  })

  it('sidebarTargets: visual order, main items excluded, Now Open dropped for a Now Open source', () => {
    expect(ids(sidebarTargets([...rows].reverse(), false))).toEqual(['now', 'work', 'other', '::new-group'])
    expect(ids(sidebarTargets(rows, true))).toEqual(['work', 'other', '::new-group'])
  })

  it('mainTargets (tab): tabs + empty windows + the zone; NO phantom stops for windows that have tabs', () => {
    expect(ids(mainTargets(rows, 'tab'))).toEqual(['g::w0::t0', 'g::w0::t1', 'g::w1::t0', 'g::w2', 'g::new-window'])
  })

  it('mainTargets (window): windows only, no tabs and no zone', () => {
    expect(ids(mainTargets(rows, 'window'))).toEqual(['g::w0', 'g::w1', 'g::w2'])
  })

  it('mainTargets skips the other members of a multi-selection but keeps the dragged item', () => {
    const skip = new Set(['g::w0::t0', 'g::w0::t1'])
    expect(ids(mainTargets(rows, 'tab', skip, 'g::w0::t0'))).toEqual(['g::w0::t0', 'g::w1::t0', 'g::w2', 'g::new-window'])
  })

  it('groupTargets: saved group rows only (never Now Open, never the new-group zone)', () => {
    expect(ids(groupTargets(rows))).toEqual(['work', 'other'])
  })

  it('pickSidebarStart: the active group, else the nearest valid group row, else the first target', () => {
    const t = sidebarTargets(rows, false)
    expect(pickSidebarStart(t, 2)).toBe('other')
    const noNow = sidebarTargets(rows, true)
    expect(pickSidebarStart(noNow, 0)).toBe('work')
    expect(pickSidebarStart(noNow, 9)).toBe('other')
    expect(pickSidebarStart([{ id: '::new-group', type: 'new-group', top: 1 }], 0)).toBe('::new-group')
    expect(pickSidebarStart([], 0)).toBeNull()
  })

  it('stepTargets clamps at BOTH ends with no extra step, and re-enters at the first target for an unknown id', () => {
    const t = mainTargets(rows, 'tab')
    expect(stepTargets(t, 'g::w0::t0', 'up')).toBe('g::w0::t0')
    expect(stepTargets(t, 'g::w0::t0', 'down')).toBe('g::w0::t1')
    expect(stepTargets(t, 'g::new-window', 'down')).toBe('g::new-window')
    expect(stepTargets(t, 'g::new-window', 'up')).toBe('g::w2')
    expect(stepTargets(t, 'gone', 'down')).toBe('g::w0::t0')
    // walking N+3 steps past the end never leaves the list nor wraps
    let cur = 'g::w0::t0'
    for (let i = 0; i < t.length + 3; i++) cur = stepTargets(t, cur, 'down')
    expect(cur).toBe('g::new-window')
    for (let i = 0; i < t.length + 3; i++) cur = stepTargets(t, cur, 'up')
    expect(cur).toBe('g::w0::t0')
  })
})

function makeCtx(kind: string, activeId: string, groupId = 'work') {
  const entries = rows.map((r) => ({ id: r.id, data: { current: { type: r.type, index: r.index, windowId: r.windowId } } }))
  const rects = new Map(rows.map((r) => [r.id, { left: r.left ?? 0, top: r.top }]))
  return {
    active: { id: activeId, data: { current: { type: kind, groupId } }, rect: { current: { initial: { left: 320, top: 200 } } } },
    droppableRects: rects,
    droppableContainers: { getEnabled: () => entries, get: (id: string) => entries.find((e) => e.id === id) },
  }
}
const key = (code: string) => ({ code, preventDefault: vi.fn() }) as unknown as KeyboardEvent

describe('createKeyboardCoordinateGetter', () => {
  const getter = createKeyboardCoordinateGetter(() => 1)
  const call = (code: string, ctx = makeCtx('tab', 'g::w0::t0')) =>
    getter(key(code), { active: ctx.active.id, context: ctx as never, currentCoordinates: { x: 0, y: 0 } })

  beforeEach(() => clearForcedKeyboardTarget())

  it('ignores non-arrow keys (Enter is inert) and stops Tab from walking focus out', () => {
    expect(call('Enter')).toBeUndefined()
    expect(call('KeyA')).toBeUndefined()
    const ev = key('Tab')
    expect(getter(ev, { active: 'x', context: makeCtx('tab', 'g::w0::t0') as never, currentCoordinates: { x: 0, y: 0 } })).toBeUndefined()
    expect(ev.preventDefault).toHaveBeenCalled()
  })

  it('MAIN pane down: tab -> tab -> tab -> empty window -> zone, then clamps (no overshoot)', () => {
    const seen: Array<string | null> = []
    for (let i = 0; i < 9; i++) {
      call('ArrowDown')
      seen.push(getForcedKeyboardTarget('g::w0::t0'))
    }
    expect(seen).toEqual([
      'g::w0::t1', 'g::w1::t0', 'g::w2', 'g::new-window', 'g::new-window', 'g::new-window', 'g::new-window', 'g::new-window', 'g::new-window',
    ])
    expect(call('ArrowDown')).toBeUndefined() // clamped: no movement at all
  })

  it('MAIN pane up from the zone returns to the first tab and then stays', () => {
    call('ArrowDown'); call('ArrowDown'); call('ArrowDown'); call('ArrowDown')
    for (let i = 0; i < 8; i++) call('ArrowUp')
    expect(getForcedKeyboardTarget('g::w0::t0')).toBe('g::w0::t0')
    // top of list: nothing above the first row, and the window CONTAINER is not a stop
    expect(call('ArrowUp')).toBeUndefined()
  })

  it('window drag walks windows only and clamps at both ends', () => {
    const ctx = makeCtx('window', 'g::w0')
    const at = () => getForcedKeyboardTarget('g::w0')
    expect(call('ArrowUp', ctx)).toBeUndefined()
    call('ArrowDown', ctx); expect(at()).toBe('g::w1')
    call('ArrowDown', ctx); expect(at()).toBe('g::w2')
    expect(call('ArrowDown', ctx)).toBeUndefined()
    expect(at()).toBe('g::w2')
  })

  it('SIDEBAR pane: Left enters at the active group; Down/Up clamp at Now Open and the new-group zone; Right returns', () => {
    expect(call('ArrowLeft')).toEqual({ x: 0, y: 50 })
    expect(getForcedKeyboardTarget('g::w0::t0')).toBe('work')
    expect(call('ArrowLeft')).toBeUndefined()
    call('ArrowDown'); call('ArrowDown')
    expect(getForcedKeyboardTarget('g::w0::t0')).toBe('::new-group')
    for (let i = 0; i < 5; i++) expect(call('ArrowDown')).toBeUndefined()
    expect(getForcedKeyboardTarget('g::w0::t0')).toBe('::new-group')
    for (let i = 0; i < 6; i++) call('ArrowUp')
    expect(getForcedKeyboardTarget('g::w0::t0')).toBe('now')
    expect(call('ArrowUp')).toBeUndefined()
    expect(call('ArrowRight')).toEqual({ x: 300, y: 40 })
    expect(getForcedKeyboardTarget('g::w0::t0')).toBe('g::w0::t0')
    expect(call('ArrowRight')).toBeUndefined() // already in the main pane
  })

  it('a Now Open source can never step onto the Now Open row', () => {
    const ctx = makeCtx('tab', 'g::w0::t0', 'now')
    expect(call('ArrowLeft', ctx)).toEqual({ x: 0, y: 50 })
    expect(call('ArrowUp', ctx)).toBeUndefined()
  })

  it('group drags step saved group rows only; Left/Right are inert', () => {
    const ctx = makeCtx('group', 'work')
    expect(call('ArrowLeft', ctx)).toBeUndefined()
    expect(call('ArrowRight', ctx)).toBeUndefined()
    expect(call('ArrowUp', ctx)).toBeUndefined() // Now Open / nothing above the first saved group
    call('ArrowDown', ctx)
    expect(getForcedKeyboardTarget('work')).toBe('other')
    expect(call('ArrowDown', ctx)).toBeUndefined() // the new-group zone is not a group-drag target
  })
})
