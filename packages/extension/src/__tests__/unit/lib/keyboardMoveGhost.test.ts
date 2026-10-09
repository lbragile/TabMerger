/**
 * keyboardMoveGhost.test.ts — the floating copy of the moving item(s) in keyboard move mode:
 * the same ghost the pointer drag builds, parented in the aux host, docked by `place`.
 * Also `translateY` / `gapRectFor`, the layout-space measurements the docking relies on.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createMoveGhost, gapRectFor, translateY } from '@/lib/keyboardMoveGhost'

function tabRow(title = 'Bravo'): HTMLElement {
  const row = document.createElement('div')
  row.setAttribute('role', 'listitem')
  row.setAttribute('data-tm-dnd-id', 'g::w0::t1')
  row.textContent = title
  document.body.appendChild(row)
  return row
}
const rect = (r: Partial<DOMRect>) => () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}), ...r }) as DOMRect

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('createMoveGhost', () => {
  it('clones the row into the aux host as an aria-hidden, inert, non-interactive copy with its own background', () => {
    const ghost = createMoveGhost(tabRow('Bravo'), 1)
    const el = document.querySelector<HTMLElement>('#tm-dnd-aux-host [data-testid="drag-ghost"]')!
    expect(ghost).not.toBeNull()
    expect(el).not.toBeNull()
    expect(el.textContent).toContain('Bravo')
    expect(el.getAttribute('aria-hidden')).toBe('true')
    expect(el.hasAttribute('inert')).toBe(true)
    expect(el.style.pointerEvents).toBe('none')
    expect(el.classList.contains('bg-card')).toBe(true) // the text under it must not show through
  })

  it('a single item has no count badge; a selection gets "+N-1" and a stacked card', () => {
    createMoveGhost(tabRow(), 1)
    expect(document.querySelector('[data-testid="drag-ghost-count"]')).toBeNull()
    document.body.innerHTML = ''
    createMoveGhost(tabRow(), 3)
    expect(document.querySelector('[data-testid="drag-ghost-count"]')?.textContent).toBe('+2')
    expect(document.querySelectorAll('[data-testid="drag-ghost-stack"]').length).toBeGreaterThan(0)
  })

  it('setCount(): the badge shows the number of items being moved, and goes away for a single item', () => {
    const ghost = createMoveGhost(tabRow(), 4)!
    const badge = () => document.querySelector('[data-testid="drag-ghost-count"]')
    const stack = () => document.querySelectorAll('[data-testid="drag-ghost-stack"]').length
    expect(badge()?.textContent).toBe('+3')
    expect(stack()).toBe(2)
    ghost.setCount(3)
    expect(badge()?.textContent).toBe('+2')
    expect(stack()).toBe(2)
    ghost.setCount(2)
    expect(badge()?.textContent).toBe('+1')
    expect(stack()).toBe(1)
    ghost.setCount(1)
    expect(badge()).toBeNull()
    expect(stack()).toBe(0)
    expect(document.querySelector('[data-testid="drag-ghost"]')?.textContent).toContain('Bravo')
  })

  it('place() docks the copy at the rect (rounded) and sizes it; place(null) parks it off screen', () => {
    const ghost = createMoveGhost(tabRow(), 1)!
    const el = document.querySelector<HTMLElement>('[data-testid="drag-ghost"]')!
    ghost.place({ left: 10.4, top: 99.6, width: 299.5 })
    expect(el.style.transform).toBe('translate3d(10px, 100px, 0)')
    expect(el.style.width).toBe('300px')
    ghost.place(null)
    expect(el.style.transform).toBe('translate3d(-9999px, -9999px, 0)')
  })

  it('height() reports the copy\'s rendered height; remove() takes it out of the DOM', () => {
    const ghost = createMoveGhost(tabRow(), 1)!
    const el = document.querySelector<HTMLElement>('[data-testid="drag-ghost"]')!
    Object.defineProperty(el, 'offsetHeight', { value: 32, configurable: true })
    expect(ghost.height()).toBe(32)
    ghost.remove()
    expect(document.querySelector('[data-testid="drag-ghost"]')).toBeNull()
  })
})

describe('translateY', () => {
  const withTransform = (t: string) => {
    const el = document.createElement('div')
    el.style.transform = t
    document.body.appendChild(el)
    return el
  }
  it('reads the vertical part of a 2D or 3D matrix; 0 for none / a non-matrix value', () => {
    expect(translateY(withTransform('matrix(1, 0, 0, 1, 5, 24)'))).toBe(24)
    expect(translateY(withTransform('matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 5,-18,0,1)'))).toBe(-18)
    expect(translateY(withTransform('none'))).toBe(0)
    expect(translateY(document.createElement('div'))).toBe(0)
    expect(translateY(withTransform('translateY(10px)'))).toBe(0)
  })
})

describe('gapRectFor', () => {
  const el = (r: Partial<DOMRect>, style: Partial<CSSStyleDeclaration> = {}) => {
    const e = document.createElement('div')
    e.getBoundingClientRect = rect(r)
    Object.assign(e.style, style)
    document.body.appendChild(e)
    return e
  }

  it('"before" opens the gap at the row\'s layout top (its displacement taken out); "after" below its bottom plus margin', () => {
    const row = el({ left: 10, top: 124, bottom: 154, width: 300, height: 30 }, { transform: 'matrix(1, 0, 0, 1, 0, 24)', marginBottom: '4px' })
    expect(gapRectFor({ type: 'line', elementId: 'x', side: 'before' }, row, 24)).toEqual({ left: 10, top: 100, width: 300 })
    expect(gapRectFor({ type: 'line', elementId: 'x', side: 'after' }, row, 24)).toEqual({ left: 10, top: 134, width: 300 })
  })

  it('null for a non-line marker, a missing marker or a missing element', () => {
    const row = el({ width: 10 })
    expect(gapRectFor({ type: 'box', elementId: 'x' }, row, 1)).toBeNull()
    expect(gapRectFor(null, row, 1)).toBeNull()
    expect(gapRectFor({ type: 'line', elementId: 'x', side: 'before' }, null, 1)).toBeNull()
  })
})
