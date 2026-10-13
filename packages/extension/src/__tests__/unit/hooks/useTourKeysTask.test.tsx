import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTourKeys } from '@/hooks/useTourKeys'

/** Interactive steps: the unlocked controls, Tab order while a task waits, foreign layers. */
let card: HTMLDivElement
const handlers = { onNext: vi.fn(), onBack: vi.fn(), onSkip: vi.fn() }

const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = card) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}
const el = (id: string) => document.getElementById(id) as HTMLElement

beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = `
    <div id="root"><div id="zone"><button id="c1">dot</button><input id="field" /></div><button id="app">app</button></div>
    <div id="card" tabindex="-1"><button id="skip">Skip</button><button id="next">Next</button></div>`
  card = el('card') as HTMLDivElement
})
afterEach(() => {
  document.body.innerHTML = ''
})

const mount = (extra: Partial<Parameters<typeof useTourKeys>[1]> = {}) =>
  renderHook(() => useTourKeys({ current: card }, { ...handlers, getAllowed: () => [el('zone')], ...extra }))

describe('Tab order while a task waits', () => {
  it('with allowedFirst, one Tab from the card itself reaches the unlocked control, then the card buttons', () => {
    mount({ allowedFirst: () => true })
    card.focus()
    press('Tab')
    expect(document.activeElement).toBe(el('c1'))
    press('Tab', {}, el('c1'))
    expect(document.activeElement).toBe(el('field'))
    press('Tab', {}, el('field'))
    expect(document.activeElement).toBe(el('skip'))
    press('Tab', {}, el('skip'))
    expect(document.activeElement).toBe(el('next'))
  })

  it('without allowedFirst, the card buttons come first and the unlocked controls after them', () => {
    mount({ allowedFirst: () => false })
    card.focus()
    press('Tab')
    expect(document.activeElement).toBe(el('skip'))
    press('Tab', {}, el('skip'))
    press('Tab', {}, el('next'))
    expect(document.activeElement).toBe(el('c1'))
  })

  it('Shift+Tab from the card with allowedFirst lands on the last card button', () => {
    mount({ allowedFirst: () => true })
    card.focus()
    press('Tab', { shiftKey: true })
    expect(document.activeElement).toBe(el('next'))
  })

  it('reads allowedFirst on every key press, so it follows the task finishing', () => {
    let waiting = true
    mount({ allowedFirst: () => waiting })
    card.focus()
    press('Tab')
    expect(document.activeElement).toBe(el('c1'))
    waiting = false
    card.focus()
    press('Tab')
    expect(document.activeElement).toBe(el('skip'))
  })
})

describe('keys on an unlocked control', () => {
  it('reach that control (not stopped, not prevented) but never the popup shortcuts', () => {
    mount()
    const own = vi.fn()
    const global = vi.fn()
    el('field').addEventListener('keydown', own)
    document.addEventListener('keydown', global)
    const e = press('a', {}, el('field'))
    expect(own).toHaveBeenCalledTimes(1)
    expect(e.defaultPrevented).toBe(false)
    expect(global).not.toHaveBeenCalled() // quarantined on the app root
    document.removeEventListener('keydown', global)
  })

  it('Enter and Escape typed in an unlocked field do not advance or skip the tour', () => {
    mount()
    press('Enter', {}, el('field'))
    press('Escape', {}, el('field'))
    expect(handlers.onNext).not.toHaveBeenCalled()
    expect(handlers.onSkip).not.toHaveBeenCalled()
  })

  it('Tab on the unlocked control is still handled, so focus can leave it', () => {
    mount({ allowedFirst: () => true })
    el('field').focus()
    press('Tab', {}, el('field'))
    expect(document.activeElement).toBe(el('skip'))
  })

  it('an element outside the unlocked set is treated as the page: Arrow keys step the tour', () => {
    mount()
    press('ArrowRight', {}, el('app'))
    expect(handlers.onNext).toHaveBeenCalledWith('arrow')
  })
})

describe('foreign layers (Settings, menus, select lists)', () => {
  it('Escape with a dialog open is left to the dialog and does not end the tour', () => {
    document.body.insertAdjacentHTML('beforeend', '<div role="dialog" id="settings"><button id="close">x</button></div>')
    mount()
    const later = vi.fn()
    window.addEventListener('keydown', later)
    const fromBody = press('Escape', {}, document.body)
    const fromDialog = press('Escape', {}, el('close'))
    expect(handlers.onSkip).not.toHaveBeenCalled()
    expect(fromBody.defaultPrevented).toBe(false)
    expect(fromDialog.defaultPrevented).toBe(false)
    expect(later).toHaveBeenCalledTimes(2) // the dialog's own handling still sees the key
    window.removeEventListener('keydown', later)
  })

  it('Escape skips again once the dialog is closed', () => {
    document.body.insertAdjacentHTML('beforeend', '<div role="dialog" id="settings"></div>')
    mount()
    press('Escape')
    expect(handlers.onSkip).not.toHaveBeenCalled()
    el('settings').remove()
    press('Escape')
    expect(handlers.onSkip).toHaveBeenCalledTimes(1)
  })

  it('Tab inside a dialog or a menu is untouched', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div role="dialog"><button id="d1"></button></div><div data-radix-popper-content-wrapper><button id="m1"></button></div>'
    )
    mount()
    for (const id of ['d1', 'm1']) {
      const e = press('Tab', {}, el(id))
      expect(e.defaultPrevented).toBe(false)
    }
  })

  it('Escape while only a tooltip is open still skips (tooltips own no keys)', () => {
    document.body.insertAdjacentHTML('beforeend', '<div data-radix-popper-content-wrapper><div role="tooltip">Pin group</div></div>')
    mount()
    press('Escape')
    expect(handlers.onSkip).toHaveBeenCalledTimes(1)
  })

  it('the tour card itself (a role=dialog) is not a foreign layer', () => {
    card.setAttribute('role', 'dialog')
    card.setAttribute('data-tour-card', '')
    mount()
    press('Escape')
    expect(handlers.onSkip).toHaveBeenCalledTimes(1)
  })
})

describe('pointer guard', () => {
  const click = (target: EventTarget) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return event
  }

  it('swallows a click on the app outside the unlocked controls', () => {
    mount()
    const reached = vi.fn()
    el('app').addEventListener('click', reached)
    const e = click(el('app'))
    expect(e.defaultPrevented).toBe(true)
    expect(reached).not.toHaveBeenCalled()
  })

  it('lets a click on an unlocked control through', () => {
    mount()
    const reached = vi.fn()
    el('c1').addEventListener('click', reached)
    click(el('c1'))
    expect(reached).toHaveBeenCalledTimes(1)
  })

  it('lets clicks on the card and on a toast through', () => {
    document.getElementById('root')!.insertAdjacentHTML('beforeend', '<section aria-live="polite"><button id="toastbtn"></button></section>')
    mount()
    const reached = vi.fn()
    el('toastbtn').addEventListener('click', reached)
    el('next').addEventListener('click', reached)
    click(el('toastbtn'))
    click(el('next'))
    expect(reached).toHaveBeenCalledTimes(2)
  })
})
