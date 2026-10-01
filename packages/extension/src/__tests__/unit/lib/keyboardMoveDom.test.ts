/**
 * keyboardMoveDom.test.ts — where the docked copy goes for a keyboard-move target and how the
 * scroll containers move so it is ALWAYS inside the visible rect of each of them.
 * jsdom has no layout, so rects / scroll metrics are stubbed per element.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  KEYBOARD_ZONE_MIN_HEIGHT,
  anchorFor,
  clampToVisible,
  dockRectFor,
  markerElement,
  revealSpan,
  rowFor
} from '@/lib/keyboardMoveDom'
import type { MoveTarget } from '@/lib/keyboardMove'

type R = { left?: number; top?: number; width?: number; height?: number }
const domRect = ({ left = 0, top = 0, width = 0, height = 0 }: R): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

function el(parent: HTMLElement | null, attrs: Record<string, string> = {}, r: R = {}, style: Partial<CSSStyleDeclaration> = {}) {
  const e = document.createElement('div')
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  Object.assign(e.style, style)
  e.getBoundingClientRect = () => domRect(r)
  ;(parent ?? document.body).appendChild(e)
  return e
}

/** A vertically scrollable container with stubbed metrics and a real settable scrollTop. */
function scroller(parent: HTMLElement | null, box: { top: number; height: number; scrollHeight: number; scrollTop?: number; clientTop?: number }) {
  const c = el(parent, {}, { top: box.top, left: 0, width: 300, height: box.height }, { overflowY: 'auto' })
  let st = box.scrollTop ?? 0
  Object.defineProperty(c, 'scrollTop', { get: () => st, set: (v: number) => (st = v), configurable: true })
  Object.defineProperty(c, 'scrollHeight', { value: box.scrollHeight, configurable: true })
  Object.defineProperty(c, 'clientHeight', { value: box.height, configurable: true })
  Object.defineProperty(c, 'clientTop', { value: box.clientTop ?? 0, configurable: true })
  const scrollTo = vi.fn()
  c.scrollTo = scrollTo as never
  return Object.assign(c, { scrollToSpy: scrollTo })
}

const target = (over: Partial<MoveTarget>): MoveTarget => ({
  key: 'k',
  over: null,
  text: 't',
  marker: null,
  gap: { containerKey: null, shiftIds: [] },
  ...over
})

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('rowFor / markerElement', () => {
  it('finds a row by model id (ids with quotes are escaped) and returns null for a missing one', () => {
    const a = el(null, { 'data-tm-dnd-id': 'work::w0::t1' })
    el(null, { 'data-tm-dnd-id': 'we"ird' })
    expect(rowFor('work::w0::t1')).toBe(a)
    expect(rowFor('we"ird')).not.toBeNull()
    expect(rowFor('nope')).toBeNull()
  })

  it('markerElement: zones by test id, rows/boxes/lines by element id, nothing for null', () => {
    const nw = el(null, { 'data-testid': 'new-window-dropzone' })
    const ng = el(null, { 'data-testid': 'new-group-dropzone' })
    const row = el(null, { 'data-tm-dnd-id': 'r1' })
    expect(markerElement({ type: 'zone', zone: 'new-window' })).toBe(nw)
    expect(markerElement({ type: 'zone', zone: 'new-group' })).toBe(ng)
    expect(markerElement({ type: 'line', elementId: 'r1', side: 'before' })).toBe(row)
    expect(markerElement({ type: 'box', elementId: 'r1' })).toBe(row)
    expect(markerElement(null)).toBeNull()
  })

  it('exports the zone growth class used while a zone is the keyboard target', () => {
    expect(KEYBOARD_ZONE_MIN_HEIGHT).toBe('min-h-[4.5rem]')
  })
})

describe('dockRectFor', () => {
  it('null for no target', () => {
    expect(dockRectFor(null, 30)).toBeNull()
  })

  it('a zone: centred and inset (0.5rem each side) so its frame shows, with the zone height as the span to reveal', () => {
    el(null, { 'data-testid': 'new-window-dropzone' }, { left: 20, top: 400, width: 300, height: 72 })
    const rect = dockRectFor(target({ marker: { type: 'zone', zone: 'new-window' } }), 30)!
    expect(rect.left).toBe(28)
    expect(rect.top).toBe(402)
    expect(rect.width).toBe(284)
    expect(rect.reveal).toBe(72)
  })

  it('a zone that is not rendered yields null', () => {
    expect(dockRectFor(target({ marker: { type: 'zone', zone: 'new-group' } }), 30)).toBeNull()
  })

  it('a line before a row docks at the row\'s LAYOUT top (the animated displacement taken out); after: below it plus its margin', () => {
    el(null, { 'data-tm-dnd-id': 'r1' }, { left: 10, top: 154, width: 280, height: 30 }, { transform: 'matrix(1, 0, 0, 1, 0, 30)', marginBottom: '2px' })
    expect(dockRectFor(target({ marker: { type: 'line', elementId: 'r1', side: 'before' } }), 30)).toEqual({ left: 10, top: 124, width: 280 })
    expect(dockRectFor(target({ marker: { type: 'line', elementId: 'r1', side: 'after' } }), 30)).toEqual({ left: 10, top: 156, width: 280 })
  })

  it('no row marker (empty window, origin, append): the end of the list that holds the gap, under its last laid-out row', () => {
    const list = el(null, { 'data-tm-dnd-list': 'work::w1' }, { left: 10, top: 100, width: 300, height: 200 }, { paddingLeft: '4px', paddingRight: '4px', paddingTop: '2px' })
    el(list, { 'data-tm-dnd-id': 'a' }, { top: 102, height: 30 }, { marginBottom: '4px' })
    el(list, { 'data-tm-dnd-id': 'b' }, { top: 136, height: 30 }, { marginBottom: '4px' })
    el(list, { 'data-tm-dnd-id': 'zero' }, { top: 0, height: 0 }) // collapsed source rows are skipped
    const rect = dockRectFor(target({ gap: { containerKey: 'work::w1', shiftIds: [] } }), 30)!
    expect(rect.left).toBe(14)
    expect(rect.width).toBe(292)
    expect(rect.top).toBe(170) // 166 (bottom of b) + 4 (margin)
  })

  it('an empty list: the top of its content box', () => {
    el(null, { 'data-tm-dnd-list': 'work::w1' }, { left: 10, top: 100, width: 300, height: 40 }, { paddingTop: '2px' })
    expect(dockRectFor(target({ gap: { containerKey: 'work::w1', shiftIds: [] } }), 30)).toEqual({ left: 10, top: 102, width: 300 })
  })

  it('a row of a nested list does not count as a row of the outer list', () => {
    const outer = el(null, { 'data-tm-dnd-list': 'g' }, { left: 0, top: 0, width: 300, height: 300 })
    const card = el(outer, { 'data-tm-dnd-id': 'win' }, { top: 0, height: 100 })
    const inner = el(card, { 'data-tm-dnd-list': 'win' }, { top: 20, height: 80 })
    el(inner, { 'data-tm-dnd-id': 'tab' }, { top: 20, height: 400 })
    expect(dockRectFor(target({ gap: { containerKey: 'g', shiftIds: [] } }), 30)!.top).toBe(100)
  })

  it('null when neither a marker element nor a list is rendered, or there is no container', () => {
    expect(dockRectFor(target({ gap: { containerKey: 'ghost', shiftIds: [] } }), 30)).toBeNull()
    expect(dockRectFor(target({}), 30)).toBeNull()
    // a line whose row is gone falls back to the list
    el(null, { 'data-tm-dnd-list': 'w' }, { top: 50, width: 100 })
    expect(dockRectFor(target({ marker: { type: 'line', elementId: 'gone', side: 'before' }, gap: { containerKey: 'w', shiftIds: [] } }), 30)).toEqual({ left: 0, top: 50, width: 100 })
  })
})

describe('anchorFor', () => {
  it('the marker element when rendered, else the gap\'s list, else null', () => {
    const row = el(null, { 'data-tm-dnd-id': 'r1' })
    const list = el(null, { 'data-tm-dnd-list': 'w' })
    expect(anchorFor(target({ marker: { type: 'box', elementId: 'r1' } }))).toBe(row)
    expect(anchorFor(target({ marker: { type: 'box', elementId: 'gone' }, gap: { containerKey: 'w', shiftIds: [] } }))).toBe(list)
    expect(anchorFor(target({}))).toBeNull()
    expect(anchorFor(null)).toBeNull()
  })
})

describe('revealSpan — the minimum scroll that makes a span visible', () => {
  it('scrolls down just enough to show a span below the visible box (nearest edge, not centred)', () => {
    const c = scroller(null, { top: 100, height: 200, scrollHeight: 1000 })
    const anchor = el(c, {}, {})
    revealSpan(anchor, { top: 350, bottom: 380 }, 'auto')
    expect(c.scrollTop).toBe(80)
  })

  it('scrolls up just enough to show a span above it', () => {
    const c = scroller(null, { top: 100, height: 200, scrollHeight: 1000, scrollTop: 80 })
    revealSpan(el(c), { top: 50, bottom: 80 }, 'auto')
    expect(c.scrollTop).toBe(30)
  })

  it('does nothing when the span is already visible', () => {
    const c = scroller(null, { top: 100, height: 200, scrollHeight: 1000, scrollTop: 40 })
    revealSpan(el(c), { top: 120, bottom: 290 }, 'auto')
    expect(c.scrollTop).toBe(40)
  })

  it('a span taller than the container shows its top; the box\'s border (clientTop) is respected', () => {
    const c = scroller(null, { top: 100, height: 200, scrollHeight: 1000, clientTop: 2 })
    revealSpan(el(c), { top: 150, bottom: 450 }, 'auto')
    expect(c.scrollTop).toBe(48) // 150 - (100 + 2)
  })

  it('never scrolls past either end of the content', () => {
    const c = scroller(null, { top: 100, height: 200, scrollHeight: 1000, scrollTop: 790 })
    revealSpan(el(c), { top: 380, bottom: 400 }, 'auto')
    expect(c.scrollTop).toBe(800) // max = 1000 - 200
    const d = scroller(null, { top: 100, height: 200, scrollHeight: 1000, scrollTop: 10 })
    revealSpan(el(d), { top: 0, bottom: 20 }, 'auto')
    expect(d.scrollTop).toBe(0)
  })

  it('a container that is not scrollable (content fits) is left alone', () => {
    const c = scroller(null, { top: 100, height: 200, scrollHeight: 200 })
    revealSpan(el(c), { top: 500, bottom: 520 }, 'auto')
    expect(c.scrollTop).toBe(0)
  })

  it('every scrollable ancestor is scrolled: the outer one sees the span where the inner scroll left it', () => {
    const outer = scroller(null, { top: 0, height: 300, scrollHeight: 900 })
    const inner = scroller(outer, { top: 100, height: 100, scrollHeight: 500 })
    revealSpan(el(inner), { top: 350, bottom: 380 }, 'auto')
    expect(inner.scrollTop).toBe(180) // brings the span's bottom to the inner box bottom (200)
    expect(outer.scrollTop).toBe(0) // after the inner scroll the span (170..200) is inside the outer box
    // a span that is also past the OUTER box needs the outer to scroll too
    const outer2 = scroller(null, { top: 0, height: 150, scrollHeight: 900 })
    const inner2 = scroller(outer2, { top: 100, height: 100, scrollHeight: 500 })
    revealSpan(el(inner2), { top: 350, bottom: 380 }, 'auto')
    expect(inner2.scrollTop).toBe(180)
    expect(outer2.scrollTop).toBe(50) // span now at 170..200, outer box bottom is 150
  })

  it('smooth: asks for the scroll once per distinct target (a per-frame follow does not restart the animation)', () => {
    const c = scroller(null, { top: 100, height: 200, scrollHeight: 1000 })
    const anchor = el(c)
    revealSpan(anchor, { top: 350, bottom: 380 }, 'smooth')
    revealSpan(anchor, { top: 350, bottom: 380 }, 'smooth')
    expect(c.scrollToSpy).toHaveBeenCalledTimes(1)
    expect(c.scrollToSpy).toHaveBeenCalledWith({ top: 80, behavior: 'smooth' })
    revealSpan(anchor, { top: 400, bottom: 430 }, 'smooth')
    expect(c.scrollToSpy).toHaveBeenCalledTimes(2)
    expect(c.scrollTop).toBe(0) // smooth never sets scrollTop itself
  })
})

describe('clampToVisible — the copy never leaves the scroll container\'s visible rect', () => {
  it('returns the very same rect when it already fits', () => {
    const c = scroller(null, { top: 100, height: 200, scrollHeight: 1000 })
    const rect = { left: 0, top: 150, width: 200 }
    expect(clampToVisible(el(c), rect, 30)).toBe(rect)
  })

  it('pulls a copy that would hang below up to the bottom edge, and one above down to the top edge', () => {
    const c = scroller(null, { top: 100, height: 200, scrollHeight: 1000 })
    const a = el(c)
    expect(clampToVisible(a, { left: 0, top: 320, width: 200 }, 30).top).toBe(270)
    expect(clampToVisible(a, { left: 0, top: 40, width: 200 }, 30).top).toBe(100)
  })

  it('a copy taller than the visible box is top-aligned', () => {
    const c = scroller(null, { top: 100, height: 20, scrollHeight: 1000 })
    expect(clampToVisible(el(c), { left: 0, top: 300, width: 200 }, 30).top).toBe(100)
  })

  it('applies every scroll ancestor (even ones that do not currently scroll)', () => {
    const outer = scroller(null, { top: 0, height: 200, scrollHeight: 200 })
    const inner = scroller(outer, { top: 0, height: 400, scrollHeight: 900 })
    expect(clampToVisible(el(inner), { left: 0, top: 380, width: 100 }, 30).top).toBe(170)
  })
})
