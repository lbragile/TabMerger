import { describe, it, expect, beforeEach } from 'vitest'
import { lockTourApp, tourFocusReturnTarget, tourFocusables } from '@/lib/tourDom'

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('tourFocusables', () => {
  it('adds the buttons of a toast on screen after the card ones, skipping disabled buttons', () => {
    document.body.innerHTML =
      '<div id="c"><button id="a"></button></div><div data-sonner-toast><button id="t1"></button><button id="t2" disabled></button></div>'
    expect(tourFocusables(document.getElementById('c')!).map((e) => e.id)).toEqual(['a', 't1'])
  })
})

describe('lockTourApp', () => {
  function mountRoot() {
    document.body.innerHTML =
      '<div id="root"><header id="h"><button id="hb">h</button></header><main id="m"></main><section id="toasts" aria-live="polite"></section></div>'
    return document.getElementById('root') as HTMLElement
  }

  it('makes every app child inert except the toast region, and the root itself stays interactive', () => {
    const root = mountRoot()
    lockTourApp()
    expect(root).not.toHaveAttribute('inert')
    expect(document.getElementById('h')).toHaveAttribute('inert')
    expect(document.getElementById('m')).toHaveAttribute('inert')
    expect(document.getElementById('toasts')).not.toHaveAttribute('inert')
  })

  it('leaves out a wrapper that contains the sonner toaster', () => {
    const root = mountRoot()
    root.insertAdjacentHTML('beforeend', '<div id="wrap"><ol data-sonner-toaster></ol></div>')
    lockTourApp()
    expect(document.getElementById('wrap')).not.toHaveAttribute('inert')
  })

  it('the returned function unlocks, and leaves children that were already inert alone', () => {
    mountRoot()
    document.getElementById('m')!.setAttribute('inert', '')
    const unlock = lockTourApp()
    unlock()
    expect(document.getElementById('h')).not.toHaveAttribute('inert')
    expect(document.getElementById('m')).toHaveAttribute('inert')
  })

  it('does nothing without an app root', () => {
    expect(() => lockTourApp()()).not.toThrow()
  })
})

describe('tourFocusReturnTarget', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div id="root"><header><button id="first">first</button><button id="help" data-tour="help">?</button></header><button id="last">last</button></div>'
  })

  it('prefers the element that launched the tour', () => {
    const last = document.getElementById('last') as HTMLElement
    expect(tourFocusReturnTarget(last, 'help')).toBe(last)
  })

  it('falls back to the help button when the launcher is the body, null, detached or locked', () => {
    const help = document.getElementById('help')
    expect(tourFocusReturnTarget(document.body, 'help')).toBe(help)
    expect(tourFocusReturnTarget(null, 'help')).toBe(help)
    expect(tourFocusReturnTarget(document.createElement('button'), 'help')).toBe(help)
    const last = document.getElementById('last') as HTMLElement
    last.setAttribute('inert', '')
    expect(tourFocusReturnTarget(last, 'help')).toBe(help)
  })

  it('falls back to the first control in the app when there is no help button', () => {
    document.getElementById('help')!.remove()
    expect(tourFocusReturnTarget(null, 'help')).toBe(document.getElementById('first'))
  })

  it('never picks a disabled control, and returns null when nothing can take focus', () => {
    ;(document.getElementById('first') as HTMLButtonElement).disabled = true
    document.getElementById('help')!.remove()
    expect(tourFocusReturnTarget(null, 'help')).toBe(document.getElementById('last'))
    ;(document.getElementById('last') as HTMLButtonElement).disabled = true
    expect(tourFocusReturnTarget(null, 'help')).toBeNull()
  })
})
