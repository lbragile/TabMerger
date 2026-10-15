import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { DeferredOnLoad, IDLE_DELAY_MS, whenPageIdle } from '@/components/DeferredOnLoad'

function setReadyState(state: DocumentReadyState) {
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => state })
}

describe('whenPageIdle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // jsdom has no requestIdleCallback; the helper must fall back to calling straight away.
    vi.stubGlobal('requestIdleCallback', undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    setReadyState('complete')
  })

  it('waits for the load event, then the delay, before running', () => {
    setReadyState('loading')
    const fn = vi.fn()
    whenPageIdle(fn)

    vi.advanceTimersByTime(IDLE_DELAY_MS * 2)
    expect(fn).not.toHaveBeenCalled()

    globalThis.dispatchEvent(new Event('load'))
    vi.advanceTimersByTime(IDLE_DELAY_MS - 1)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('starts the delay at once when the page has already loaded', () => {
    setReadyState('complete')
    const fn = vi.fn()
    whenPageIdle(fn)
    vi.advanceTimersByTime(IDLE_DELAY_MS)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('runs at once on the first interaction after the page has loaded, and only once', () => {
    setReadyState('complete')
    const fn = vi.fn()
    whenPageIdle(fn)
    vi.advanceTimersByTime(100)
    expect(fn).not.toHaveBeenCalled()

    globalThis.dispatchEvent(new Event('pointerdown'))
    expect(fn).toHaveBeenCalledTimes(1)
    globalThis.dispatchEvent(new Event('keydown'))
    vi.advanceTimersByTime(IDLE_DELAY_MS * 2)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('ignores an interaction that happens before the page has loaded', () => {
    setReadyState('loading')
    const fn = vi.fn()
    whenPageIdle(fn)
    globalThis.dispatchEvent(new Event('scroll'))
    expect(fn).not.toHaveBeenCalled()
  })

  it('uses requestIdleCallback when the browser has it', () => {
    const idle = vi.fn((cb: () => void) => cb())
    vi.stubGlobal('requestIdleCallback', idle)
    setReadyState('complete')
    const fn = vi.fn()
    whenPageIdle(fn)
    vi.advanceTimersByTime(IDLE_DELAY_MS)
    expect(idle).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('never runs once cancelled, before or after the load event', () => {
    setReadyState('loading')
    const early = vi.fn()
    whenPageIdle(early)()
    globalThis.dispatchEvent(new Event('load'))

    setReadyState('complete')
    const late = vi.fn()
    whenPageIdle(late)()

    vi.advanceTimersByTime(IDLE_DELAY_MS * 2)
    expect(early).not.toHaveBeenCalled()
    expect(late).not.toHaveBeenCalled()
  })
})

describe('DeferredOnLoad', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestIdleCallback', undefined)
    setReadyState('complete')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('renders its children only after the page is idle', () => {
    const { queryByText } = render(
      <DeferredOnLoad>
        <span>analytics</span>
      </DeferredOnLoad>,
    )
    expect(queryByText('analytics')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(IDLE_DELAY_MS)
    })
    expect(queryByText('analytics')).not.toBeNull()
  })

  it('does not mount its children if it unmounts first', () => {
    const { queryByText, unmount } = render(
      <DeferredOnLoad>
        <span>analytics</span>
      </DeferredOnLoad>,
    )
    unmount()
    act(() => {
      vi.advanceTimersByTime(IDLE_DELAY_MS * 2)
    })
    expect(queryByText('analytics')).toBeNull()
  })
})
