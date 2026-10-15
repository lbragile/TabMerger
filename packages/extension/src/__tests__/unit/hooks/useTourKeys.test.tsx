import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTourKeys } from '@/hooks/useTourKeys'

let card: HTMLDivElement
let skip: HTMLButtonElement
let back: HTMLButtonElement
let next: HTMLButtonElement
let outside: HTMLButtonElement
const handlers = { onNext: vi.fn(), onBack: vi.fn(), onSkip: vi.fn() }

function mount() {
  return renderHook(() => useTourKeys({ current: card }, handlers))
}

/** Dispatches a bubbling, cancelable keydown from `target` and returns the event. */
function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = card) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = `
    <button id="outside">outside</button>
    <div id="card" tabindex="-1"><button id="skip">Skip</button><button id="back">Back</button><button id="next">Next</button></div>`
  card = document.getElementById('card') as HTMLDivElement
  skip = document.getElementById('skip') as HTMLButtonElement
  back = document.getElementById('back') as HTMLButtonElement
  next = document.getElementById('next') as HTMLButtonElement
  outside = document.getElementById('outside') as HTMLButtonElement
})
afterEach(() => {
  document.body.innerHTML = ''
})

describe('useTourKeys', () => {
  it('Escape skips', () => {
    mount()
    const e = press('Escape')
    expect(handlers.onSkip).toHaveBeenCalledTimes(1)
    expect(e.defaultPrevented).toBe(true)
  })

  it('ArrowRight goes to the next step, flagged as an arrow', () => {
    mount()
    press('ArrowRight')
    expect(handlers.onNext).toHaveBeenCalledWith('arrow')
  })

  it('ArrowLeft goes back', () => {
    mount()
    press('ArrowLeft')
    expect(handlers.onBack).toHaveBeenCalledTimes(1)
  })

  it('Enter on the card itself advances, flagged as enter', () => {
    mount()
    const e = press('Enter', {}, card)
    expect(handlers.onNext).toHaveBeenCalledWith('enter')
    expect(e.defaultPrevented).toBe(true)
  })

  it('Enter on a card button is left to that button (not advanced, not prevented)', () => {
    mount()
    for (const button of [skip, back, next]) {
      const e = press('Enter', {}, button)
      expect(e.defaultPrevented).toBe(false)
    }
    expect(handlers.onNext).not.toHaveBeenCalled()
    expect(handlers.onSkip).not.toHaveBeenCalled()
    expect(handlers.onBack).not.toHaveBeenCalled()
  })

  it('Enter on Skip really activates Skip, and on Back really activates Back', () => {
    const onSkipClick = vi.fn()
    const onBackClick = vi.fn()
    skip.addEventListener('click', onSkipClick)
    back.addEventListener('click', onBackClick)
    mount()
    // a real Enter on a focused button fires click as the browser default; emulate it when not prevented
    for (const button of [skip, back]) {
      const e = press('Enter', {}, button)
      if (!e.defaultPrevented) button.click()
    }
    expect(onSkipClick).toHaveBeenCalledTimes(1)
    expect(onBackClick).toHaveBeenCalledTimes(1)
    expect(handlers.onNext).not.toHaveBeenCalled()
  })

  it('ignores modified keys but still keeps them from the app', () => {
    mount()
    const later = vi.fn()
    window.addEventListener('keydown', later)
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      const e = press('ArrowLeft', mod)
      expect(e.defaultPrevented).toBe(false)
    }
    expect(handlers.onBack).not.toHaveBeenCalled()
    expect(later).not.toHaveBeenCalled()
    window.removeEventListener('keydown', later)
  })

  it('Tab cycles forward through the card buttons and wraps', () => {
    mount()
    skip.focus()
    press('Tab')
    expect(document.activeElement).toBe(back)
    press('Tab')
    expect(document.activeElement).toBe(next)
    press('Tab')
    expect(document.activeElement).toBe(skip)
  })

  it('Shift+Tab cycles backward and wraps', () => {
    mount()
    skip.focus()
    press('Tab', { shiftKey: true })
    expect(document.activeElement).toBe(next)
    press('Tab', { shiftKey: true })
    expect(document.activeElement).toBe(back)
  })

  it('Tab from outside the card enters it at the first button, Shift+Tab at the last', () => {
    mount()
    outside.focus()
    press('Tab')
    expect(document.activeElement).toBe(skip)
    outside.focus()
    press('Tab', { shiftKey: true })
    expect(document.activeElement).toBe(next)
  })

  it('Tab on a card with a single button keeps focus there', () => {
    card.innerHTML = '<button id="only">Done</button>'
    mount()
    const only = document.getElementById('only') as HTMLButtonElement
    only.focus()
    press('Tab')
    expect(document.activeElement).toBe(only)
    press('Tab', { shiftKey: true })
    expect(document.activeElement).toBe(only)
  })

  it('stops every key from reaching other window and document listeners', () => {
    mount()
    const onWindow = vi.fn()
    const onDocument = vi.fn()
    window.addEventListener('keydown', onWindow)
    window.addEventListener('keydown', onWindow, true)
    document.addEventListener('keydown', onDocument)
    for (const key of ['ArrowDown', 'ArrowRight', 'Escape', 'k', 'Enter', 'Tab']) press(key, {}, outside)
    expect(onWindow).not.toHaveBeenCalled()
    expect(onDocument).not.toHaveBeenCalled()
    window.removeEventListener('keydown', onWindow)
    window.removeEventListener('keydown', onWindow, true)
    document.removeEventListener('keydown', onDocument)
  })

  it('uses the latest handlers after a re-render', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ onBack }) => useTourKeys({ current: card }, { ...handlers, onBack }), {
      initialProps: { onBack: first },
    })
    rerender({ onBack: second })
    press('ArrowLeft')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the card is not mounted', () => {
    const later = vi.fn()
    renderHook(() => useTourKeys({ current: null }, handlers))
    window.addEventListener('keydown', later)
    press('Escape')
    expect(handlers.onSkip).not.toHaveBeenCalled()
    expect(later).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', later)
  })

  it('removes its listener when the tour ends', () => {
    const { unmount } = mount()
    unmount()
    const later = vi.fn()
    window.addEventListener('keydown', later)
    press('Escape')
    expect(handlers.onSkip).not.toHaveBeenCalled()
    expect(later).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', later)
  })
})
