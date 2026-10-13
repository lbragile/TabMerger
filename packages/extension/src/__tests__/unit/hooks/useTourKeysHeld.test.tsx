import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTourKeys } from '@/hooks/useTourKeys'

let card: HTMLDivElement
let skip: HTMLButtonElement
let next: HTMLButtonElement
let outside: HTMLButtonElement
const handlers = { onNext: vi.fn(), onBack: vi.fn(), onSkip: vi.fn() }

function mount() {
  return renderHook(() => useTourKeys({ current: card }, handlers))
}

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = card) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = `
    <button id="outside">outside</button>
    <div id="card" tabindex="-1"><div data-tour-body id="body"></div><button id="skip">Skip</button><button id="next">Next</button></div>`
  card = document.getElementById('card') as HTMLDivElement
  skip = document.getElementById('skip') as HTMLButtonElement
  next = document.getElementById('next') as HTMLButtonElement
  outside = document.getElementById('outside') as HTMLButtonElement
})
afterEach(() => {
  document.body.innerHTML = ''
})

describe('useTourKeys — held keys, scrolling, toasts', () => {
  it('a held Escape, ArrowRight or ArrowLeft does nothing after the first press', () => {
    mount()
    press('Escape', { repeat: true })
    press('ArrowRight', { repeat: true })
    press('ArrowLeft', { repeat: true })
    expect(handlers.onSkip).not.toHaveBeenCalled()
    expect(handlers.onNext).not.toHaveBeenCalled()
    expect(handlers.onBack).not.toHaveBeenCalled()
  })

  it('a held Enter never advances and never re-clicks a focused button', () => {
    mount()
    expect(press('Enter', { repeat: true }, card).defaultPrevented).toBe(true)
    expect(press('Enter', { repeat: true }, skip).defaultPrevented).toBe(true)
    expect(handlers.onNext).not.toHaveBeenCalled()
  })

  it('Enter somewhere else in the page does nothing and is kept from the app', () => {
    mount()
    const e = press('Enter', {}, outside)
    expect(e.defaultPrevented).toBe(true)
    expect(handlers.onNext).not.toHaveBeenCalled()
  })

  it('Up/Down/PageUp/PageDown scroll the card text instead of reaching the app', () => {
    const body = document.getElementById('body') as HTMLElement
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 200 })
    mount()
    const later = vi.fn()
    window.addEventListener('keydown', later)
    press('ArrowDown')
    expect(body.scrollTop).toBe(50)
    press('PageDown')
    expect(body.scrollTop).toBe(230)
    press('ArrowUp')
    press('PageUp')
    expect(body.scrollTop).toBe(0)
    expect(later).not.toHaveBeenCalled()
    window.removeEventListener('keydown', later)
  })

  it('scroll keys are harmless when the card has no scrolling text', () => {
    document.getElementById('body')!.remove()
    mount()
    expect(() => press('ArrowDown')).not.toThrow()
  })

  it('Tab also reaches the buttons of a toast on screen, and Enter on them is left alone', () => {
    document.body.insertAdjacentHTML('beforeend', '<div data-sonner-toast><button id="toast-btn">Undo</button></div>')
    mount()
    next.focus()
    press('Tab')
    const toastButton = document.getElementById('toast-btn') as HTMLElement
    expect(document.activeElement).toBe(toastButton)
    expect(press('Enter', {}, toastButton).defaultPrevented).toBe(false)
    press('Tab')
    expect(document.activeElement).toBe(skip)
  })
})
