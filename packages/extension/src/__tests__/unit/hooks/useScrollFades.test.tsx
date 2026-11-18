import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, fireEvent } from '@testing-library/react'
import { FadedScrollArea } from '@/components/SectionView/FadedScrollArea'

/**
 * The read-only views' edge fades (`useScrollFades` through `FadedScrollArea`): the top one only
 * once scrolled, the bottom one only while there is more below, measured on scroll and on resize
 * at most once a frame. jsdom has no layout, so the scroll metrics are stubbed per element.
 */

type Metrics = { scrollTop: number; clientHeight: number; scrollHeight: number }

function stub(el: HTMLElement, m: Metrics) {
  for (const [key, value] of Object.entries(m)) Object.defineProperty(el, key, { configurable: true, get: () => value })
}

let frames: FrameRequestCallback[] = []
let observed: { callback: ResizeObserverCallback; targets: Element[] }[] = []

beforeEach(() => {
  frames = []
  observed = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb)
    return frames.length
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  vi.stubGlobal(
    'ResizeObserver',
    class {
      entry: { callback: ResizeObserverCallback; targets: Element[] }
      constructor(callback: ResizeObserverCallback) {
        this.entry = { callback, targets: [] }
        observed.push(this.entry)
      }
      observe(el: Element) { this.entry.targets.push(el) }
      disconnect() { this.entry.targets = [] }
      unobserve() {}
    },
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const flush = () => act(() => {
  const pending = frames
  frames = []
  for (const cb of pending) cb(0)
})

function setup() {
  const utils = render(<FadedScrollArea><p>content</p></FadedScrollArea>)
  const scroller = utils.container.querySelector('[data-faded-scroll]') as HTMLElement
  const top = () => utils.container.querySelector('[data-fade="top"]') as HTMLElement
  const bottom = () => utils.container.querySelector('[data-fade="bottom"]') as HTMLElement
  const scrollTo = (m: Metrics) => {
    stub(scroller, m)
    fireEvent.scroll(scroller)
    flush()
  }
  return { ...utils, scroller, top, bottom, scrollTo }
}

describe('useScrollFades / FadedScrollArea', () => {
  it('at the top of a long list: no top fade, a bottom fade', () => {
    const { scrollTo, top, bottom } = setup()
    scrollTo({ scrollTop: 0, clientHeight: 400, scrollHeight: 1200 })
    expect(top()).toHaveClass('opacity-0')
    expect(bottom()).toHaveClass('opacity-100')
  })

  it('in the middle: both fades', () => {
    const { scrollTo, top, bottom } = setup()
    scrollTo({ scrollTop: 300, clientHeight: 400, scrollHeight: 1200 })
    expect(top()).toHaveClass('opacity-100')
    expect(bottom()).toHaveClass('opacity-100')
  })

  it('at the end (within 2px): the top fade only', () => {
    const { scrollTo, top, bottom } = setup()
    scrollTo({ scrollTop: 799, clientHeight: 400, scrollHeight: 1200 })
    expect(top()).toHaveClass('opacity-100')
    expect(bottom()).toHaveClass('opacity-0')
  })

  it('a list that fits shows neither', () => {
    const { scrollTo, top, bottom } = setup()
    scrollTo({ scrollTop: 0, clientHeight: 400, scrollHeight: 400 })
    expect(top()).toHaveClass('opacity-0')
    expect(bottom()).toHaveClass('opacity-0')
  })

  it('measures at most once a frame however many scroll events arrive', () => {
    const { scroller } = setup()
    stub(scroller, { scrollTop: 10, clientHeight: 400, scrollHeight: 1200 })
    fireEvent.scroll(scroller)
    fireEvent.scroll(scroller)
    fireEvent.scroll(scroller)
    expect(frames).toHaveLength(1)
  })

  it('measures again when the area or its content changes size', () => {
    const { scroller, bottom } = setup()
    expect(observed[0].targets).toEqual([scroller, scroller.firstElementChild])
    stub(scroller, { scrollTop: 0, clientHeight: 400, scrollHeight: 1200 })
    act(() => observed[0].callback([], {} as ResizeObserver))
    flush()
    expect(bottom()).toHaveClass('opacity-100')
  })

  it('stops listening on unmount and drops a pending frame', () => {
    const { scroller, unmount } = setup()
    stub(scroller, { scrollTop: 10, clientHeight: 400, scrollHeight: 1200 })
    fireEvent.scroll(scroller)
    unmount()
    expect(window.cancelAnimationFrame).toHaveBeenCalled()
    expect(observed[0].targets).toEqual([])
  })

  it('works without ResizeObserver (scroll only)', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const { scrollTo, top } = setup()
    scrollTo({ scrollTop: 50, clientHeight: 400, scrollHeight: 1200 })
    expect(top()).toHaveClass('opacity-100')
  })

  it('the fades are decorative and stop short of the scrollbar', () => {
    const { top, bottom } = setup()
    for (const f of [top(), bottom()]) {
      expect(f).toHaveAttribute('aria-hidden', 'true')
      expect(f).toHaveClass('pointer-events-none', 'end-1', 'from-background')
    }
  })
})
