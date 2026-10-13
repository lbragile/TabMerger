import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  elementRect,
  findScrollContainer,
  findTourAnchor,
  revealTourAnchor,
  rootFontSize,
  tourFocusables,
  tourFrame,
  tourRemToPx,
} from '@/lib/tourDom'

function rect(top: number, height: number): DOMRect {
  return { left: 0, top, width: 100, height, right: 100, bottom: top + height, x: 0, y: top, toJSON: () => ({}) } as DOMRect
}

/** A scrollable container (overflow-y auto, content taller than the box) holding one anchor. */
function mountScroller({ anchorTop, anchorHeight = 40 }: { anchorTop: number; anchorHeight?: number }) {
  document.body.innerHTML = `<div id="outer"><div id="scroller" style="overflow-y:auto"><div id="anchor" data-tour="x"></div></div></div>`
  const scroller = document.getElementById('scroller') as HTMLElement
  const anchor = document.getElementById('anchor') as HTMLElement
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1000 })
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 300 })
  scroller.getBoundingClientRect = () => rect(100, 300)
  anchor.getBoundingClientRect = () => rect(anchorTop, anchorHeight)
  scroller.scrollTo = vi.fn() as unknown as typeof scroller.scrollTo
  return { scroller, anchor }
}

beforeEach(() => {
  document.body.innerHTML = ''
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.documentElement.style.fontSize = ''
})

describe('findTourAnchor', () => {
  it('finds the element carrying the data-tour attribute', () => {
    document.body.innerHTML = '<button data-tour="search"></button>'
    expect(findTourAnchor('search')).toBe(document.querySelector('button'))
  })
  it('returns null for a null/empty name or a missing element', () => {
    expect(findTourAnchor(null)).toBeNull()
    expect(findTourAnchor('')).toBeNull()
    expect(findTourAnchor('nope')).toBeNull()
  })
})

describe('measurements', () => {
  it('rootFontSize reads the root font size and falls back to 16', () => {
    document.documentElement.style.fontSize = '20px'
    expect(rootFontSize()).toBe(20)
    expect(tourRemToPx(0.5)).toBe(10)
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ fontSize: 'garbage' } as CSSStyleDeclaration)
    expect(rootFontSize()).toBe(16)
  })

  it('tourFrame is the document client size', () => {
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(800)
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(600)
    expect(tourFrame()).toEqual({ width: 800, height: 600 })
  })

  it('elementRect copies the four box values', () => {
    const el = document.createElement('div')
    el.getBoundingClientRect = () => rect(5, 7)
    expect(elementRect(el)).toEqual({ left: 0, top: 5, width: 100, height: 7 })
  })

  it('tourFocusables lists enabled buttons and links only', () => {
    document.body.innerHTML = '<div id="c"><button id="a"></button><button id="b" disabled></button><a id="l" href="#">x</a><span></span></div>'
    const ids = tourFocusables(document.getElementById('c')!).map((e) => e.id)
    expect(ids).toEqual(['a', 'l'])
  })
})

describe('findScrollContainer', () => {
  it('returns the nearest ancestor that scrolls vertically and has overflow', () => {
    const { scroller, anchor } = mountScroller({ anchorTop: 150 })
    expect(findScrollContainer(anchor)).toBe(scroller)
  })

  it('skips an overflow:auto ancestor with nothing to scroll', () => {
    const { scroller, anchor } = mountScroller({ anchorTop: 150 })
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 300 })
    expect(findScrollContainer(anchor)).toBeNull()
  })

  it('returns null when no ancestor scrolls, and never walks up to the body', () => {
    document.body.innerHTML = '<div><span id="a"></span></div>'
    document.body.style.overflowY = 'auto'
    expect(findScrollContainer(document.getElementById('a')!)).toBeNull()
    document.body.style.overflowY = ''
  })
})

describe('revealTourAnchor', () => {
  it('does nothing without a scroll container', () => {
    document.body.innerHTML = '<span id="a"></span>'
    expect(() => revealTourAnchor(document.getElementById('a')!)).not.toThrow()
  })

  it('does not scroll an anchor that is already visible', () => {
    const { scroller, anchor } = mountScroller({ anchorTop: 200 })
    revealTourAnchor(anchor)
    expect(scroller.scrollTo).not.toHaveBeenCalled()
  })

  it('scrolls only its own container, smoothly, to bring a hidden anchor into view', () => {
    const windowScroll = vi.fn()
    vi.stubGlobal('scrollTo', windowScroll)
    const { scroller, anchor } = mountScroller({ anchorTop: 600 })
    anchor.scrollIntoView = vi.fn()
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    revealTourAnchor(anchor)
    expect(scroller.scrollTo).toHaveBeenCalledTimes(1)
    const arg = (scroller.scrollTo as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg.top).toBeGreaterThan(0)
    expect(arg.behavior).toBe('smooth')
    expect(anchor.scrollIntoView).not.toHaveBeenCalled()
    expect(windowScroll).not.toHaveBeenCalled()
  })

  it('jumps instead of animating under reduced motion', () => {
    const { scroller, anchor } = mountScroller({ anchorTop: 600 })
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    revealTourAnchor(anchor)
    expect((scroller.scrollTo as ReturnType<typeof vi.fn>).mock.calls[0][0].behavior).toBe('auto')
  })

  it('sets scrollTop directly when scrollTo is unavailable', () => {
    const { scroller, anchor } = mountScroller({ anchorTop: 600 })
    ;(scroller as unknown as { scrollTo: unknown }).scrollTo = undefined
    revealTourAnchor(anchor)
    expect(scroller.scrollTop).toBeGreaterThan(0)
  })
})
