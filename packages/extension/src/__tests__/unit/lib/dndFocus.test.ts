/**
 * dndFocus.test.ts — focus after a keyboard move goes to where the item LANDED (its row, the roving Tab stop),
 * or the nearest remaining item when it left the panel — never to whatever now occupies
 * the old positional slot by accident, and never to <body>.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  focusAfterDrop,
  focusFirst,
  focusSelectorsForGroupIndex,
  focusSelectorsForItem,
  focusSelectorsNear
} from '@/lib/dndFocus'

function row(id: string, label: string, withGrip = true) {
  const el = document.createElement('div')
  el.setAttribute('role', 'listitem')
  el.setAttribute('data-tm-dnd-id', id)
  el.tabIndex = 0
  if (withGrip) {
    const grip = document.createElement('span')
    grip.tabIndex = 0
    grip.setAttribute('aria-label', `Drag to reorder tab: ${label}`)
    el.appendChild(grip)
  }
  document.body.appendChild(el)
  return el
}

beforeEach(() => {
  document.body.innerHTML = ''
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('selector builders', () => {
  it('tab → its row then the grip; window → its (focusable, roving) header, then its grip, then that header first real control, then its first tab row; group → the row then its grip', () => {
    expect(focusSelectorsForItem('g::w1::t2')).toEqual([
      '[data-tm-dnd-id="g::w1::t2"]',
      '[data-tm-dnd-id="g::w1::t2"] [aria-label^="Drag to reorder"]'
    ])
    expect(focusSelectorsForItem('g::w1')).toEqual([
      '[data-tm-dnd-id="g::w1"] [data-window-header]',
      '[data-tm-dnd-id="g::w1"] [aria-label^="Drag to reorder window"]',
      '[data-tm-dnd-id="g::w1"] [data-window-header] button:not([aria-hidden="true"])',
      '[data-tm-dnd-id="g::w1"] [role="listitem"]'
    ])
    expect(focusSelectorsForItem('groupId')).toEqual([])
    expect(focusSelectorsForGroupIndex(3)).toEqual([
      '[data-sidebar-group-index="3"]',
      '[data-sidebar-group-index="3"] [aria-label^="Drag to reorder"]'
    ])
  })

  it('near: the slot, the previous tab, the window, the previous window, then the visible group row', () => {
    const sels = focusSelectorsNear('g::w1::t2', 4)
    expect(sels[0]).toContain('g::w1::t2')
    expect(sels[2]).toContain('g::w1::t1')
    expect(sels.some((s) => s.includes('"g::w1"'))).toBe(true)
    expect(sels.some((s) => s.includes('"g::w0"'))).toBe(true)
    expect(sels[sels.length - 1]).toBe('[data-sidebar-group-index="4"] [aria-label^="Drag to reorder"]')
    // first tab of the first window: no negative indices
    expect(focusSelectorsNear('g::w0::t0', 1).join(' ')).not.toMatch(/-1/)
    expect(focusSelectorsNear('g::w0', 1)[0]).toContain('"g::w0"')
  })
})

describe('focusFirst', () => {
  it('focuses the first match that exists — the row (the Tab stop) in preference to the grip', () => {
    row('g::w0::t0', 'A')
    const b = row('g::w0::t1', 'B')
    const el = focusFirst([...focusSelectorsForItem('g::w9::t9'), ...focusSelectorsForItem('g::w0::t1')])
    expect(el).toBe(b)
    expect(document.activeElement).toBe(b)
  })

  it('falls back to the row when the grip is absent, skips the ghost host, and ignores bad selectors', () => {
    const host = document.createElement('div')
    host.id = 'tm-dnd-aux-host'
    host.appendChild(row('g::w0::t0', 'ghost'))
    document.body.appendChild(host)
    expect(focusFirst(['[[bad', ...focusSelectorsForItem('g::w0::t0')])).toBeNull()
    const r = row('g::w0::t1', 'B', false)
    expect(focusFirst(focusSelectorsForItem('g::w0::t1'))).toBe(r)
  })

  it('a grip-less window lands on its FOCUSABLE header (the roving toolbar), not on the star inside it', () => {
    const card = document.createElement('div')
    card.setAttribute('data-tm-dnd-id', 'g::w0')
    const header = document.createElement('div')
    header.setAttribute('data-window-header', '')
    header.setAttribute('role', 'toolbar')
    header.tabIndex = 0 // a11y M3: the header is one Tab stop
    const star = document.createElement('button')
    star.setAttribute('aria-label', 'Star window')
    star.tabIndex = -1
    header.appendChild(star)
    card.appendChild(header)
    document.body.appendChild(card)
    expect(focusFirst(focusSelectorsForItem('g::w0'))).toBe(header)
    expect(document.activeElement).toBe(header)
  })
})

describe('focusAfterDrop', () => {
  it('runs in an animation frame and retries once a frame later (the commit may still be rendering)', () => {
    const frames: Array<() => void> = []
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      frames.push(cb)
      return frames.length
    })
    focusAfterDrop(focusSelectorsForItem('g::w0::t3'))
    expect(frames).toHaveLength(1)
    frames.shift()!() // not rendered yet → schedules one retry
    expect(frames).toHaveLength(1)
    const r = row('g::w0::t3', 'Late')
    frames.shift()!()
    expect(document.activeElement).toBe(r)
  })

  it('no selectors → nothing scheduled', () => {
    const raf = vi.fn()
    vi.stubGlobal('requestAnimationFrame', raf)
    focusAfterDrop([])
    expect(raf).not.toHaveBeenCalled()
  })
})
