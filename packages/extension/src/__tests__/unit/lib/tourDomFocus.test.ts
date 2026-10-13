import { describe, it, expect, beforeEach } from 'vitest'
import {
  allowedFocusables,
  isForeignLayerOpen,
  isInAllowed,
  isInForeignLayer,
  isInToastRegion,
  isTextEntry,
  lockTourApp,
  measureTourHighlight,
  tourFocusables,
  visibleRect
} from '@/lib/tourDom'

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('tourFocusables with allowedFirst', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div id="root"><div id="zone"><button id="c1"></button><input id="c2" /></div></div>' +
      '<div id="card"><button id="back"></button><button id="next"></button></div>' +
      '<div data-sonner-toast><button id="toast"></button></div>'
  })
  const ids = (allowedFirst: boolean) =>
    tourFocusables(document.getElementById('card')!, [document.getElementById('zone')!], allowedFirst).map((e) => e.id)

  it('puts the card buttons first by default', () => {
    expect(ids(false)).toEqual(['back', 'next', 'c1', 'c2', 'toast'])
  })

  it('puts the unlocked controls first while a task waits, toasts still last', () => {
    expect(ids(true)).toEqual(['c1', 'c2', 'back', 'next', 'toast'])
  })

  it('skips unlocked controls that are inert', () => {
    document.getElementById('c1')!.setAttribute('inert', '')
    expect(ids(true)).toEqual(['c2', 'back', 'next', 'toast'])
  })

  it('lists an allowed element that is itself a control', () => {
    expect(allowedFocusables([document.getElementById('c1')!]).map((e) => e.id)).toEqual(['c1'])
  })
})

describe('isTextEntry', () => {
  it('is true for text-like inputs, textareas and contenteditable', () => {
    const input = document.createElement('input')
    expect(isTextEntry(input)).toBe(true)
    input.type = 'search'
    expect(isTextEntry(input)).toBe(true)
    expect(isTextEntry(document.createElement('textarea'))).toBe(true)
    const div = document.createElement('div')
    Object.defineProperty(div, 'isContentEditable', { value: true })
    expect(isTextEntry(div)).toBe(true)
  })

  it('is false for buttons, checkboxes and ordinary elements', () => {
    for (const type of ['button', 'checkbox', 'radio', 'range', 'submit']) {
      const input = document.createElement('input')
      input.type = type
      expect(isTextEntry(input), type).toBe(false)
    }
    // jsdom has no isContentEditable, so a plain element reads as undefined (falsy)
    expect(isTextEntry(document.createElement('button'))).toBeFalsy()
    expect(isTextEntry(document.createElement('div'))).toBeFalsy()
    expect(isTextEntry(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))).toBeFalsy()
  })
})

describe('isForeignLayerOpen', () => {
  it('is false with nothing open', () => {
    expect(isForeignLayerOpen()).toBe(false)
  })

  it('ignores a tooltip, which lives in a popper wrapper too', () => {
    document.body.innerHTML = '<div data-radix-popper-content-wrapper><div role="tooltip">Pin group</div></div>'
    expect(isForeignLayerOpen()).toBe(false)
  })

  it('counts a menu', () => {
    document.body.innerHTML = '<div data-radix-popper-content-wrapper><div role="menu"></div></div>'
    expect(isForeignLayerOpen()).toBe(true)
  })

  it('counts a menu even while a tooltip sits in another wrapper', () => {
    document.body.innerHTML =
      '<div data-radix-popper-content-wrapper><div role="tooltip"></div></div><div data-radix-popper-content-wrapper><div role="listbox"></div></div>'
    expect(isForeignLayerOpen()).toBe(true)
  })

  it('counts a dialog but not the tour card', () => {
    document.body.innerHTML = '<div role="dialog" data-tour-card></div>'
    expect(isForeignLayerOpen()).toBe(false)
    document.body.innerHTML = '<div role="dialog"></div>'
    expect(isForeignLayerOpen()).toBe(true)
  })
})

describe('layer and allow-list membership', () => {
  it('isInForeignLayer is true inside a menu and false inside the card', () => {
    document.body.innerHTML =
      '<div data-radix-popper-content-wrapper><button id="m"></button></div><div role="dialog" data-tour-card><button id="c"></button></div>'
    expect(isInForeignLayer(document.getElementById('m')!)).toBe(true)
    expect(isInForeignLayer(document.getElementById('c')!)).toBe(false)
  })

  it('isInAllowed accepts the element or anything inside it', () => {
    document.body.innerHTML = '<div id="a"><span id="x"></span></div><span id="y"></span>'
    const a = document.getElementById('a')!
    expect(isInAllowed(document.getElementById('x')!, [a])).toBe(true)
    expect(isInAllowed(a, [a])).toBe(true)
    expect(isInAllowed(document.getElementById('y')!, [a])).toBe(false)
    expect(isInAllowed(a, [])).toBe(false)
  })

  it('isInToastRegion matches toasts and sonner regions', () => {
    document.body.innerHTML = '<section aria-live="polite"><button id="a"></button></section><div data-sonner-toast><i id="b"></i></div><p id="c"></p>'
    expect(isInToastRegion(document.getElementById('a')!)).toBe(true)
    expect(isInToastRegion(document.getElementById('b')!)).toBe(true)
    expect(isInToastRegion(document.getElementById('c')!)).toBe(false)
  })
})

describe('lockTourApp with an allow-list', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div id="root"><header id="h"><button id="hb">h</button></header>' +
      '<aside id="side"><div id="row"><button id="star"></button><button id="del"></button></div><div id="other"></div></aside></div>' +
      '<div id="menu"><button id="keep"></button><button id="drop"></button></div>'
  })

  it('leaves the allowed control and its ancestors usable and makes their siblings inert', () => {
    const star = document.getElementById('star')!
    const unlock = lockTourApp([star])
    expect(document.getElementById('h')).toHaveAttribute('inert')
    expect(document.getElementById('side')).not.toHaveAttribute('inert')
    expect(document.getElementById('row')).not.toHaveAttribute('inert')
    expect(document.getElementById('other')).toHaveAttribute('inert')
    expect(document.getElementById('del')).toHaveAttribute('inert')
    expect(star).not.toHaveAttribute('inert')
    unlock()
    expect(document.querySelectorAll('[inert]')).toHaveLength(0)
  })

  it('locks a surface outside the root down to the allowed controls only', () => {
    const keep = document.getElementById('keep')!
    lockTourApp([keep], [document.getElementById('menu')!])
    expect(keep).not.toHaveAttribute('inert')
    expect(document.getElementById('drop')).toHaveAttribute('inert')
  })
})

describe('measureTourHighlight and visibleRect', () => {
  const box = (el: HTMLElement, left: number, top: number, width: number, height: number) => {
    el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect
  }

  it('takes the first list with something visible and unions its elements', () => {
    document.body.innerHTML = '<i id="a" class="x"></i><i id="b" class="x"></i><i id="c" class="y"></i>'
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 800 })
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 600 })
    box(document.getElementById('a')!, 10, 10, 20, 20)
    box(document.getElementById('b')!, 50, 10, 20, 20)
    box(document.getElementById('c')!, 300, 300, 20, 20)
    expect(measureTourHighlight([['.missing'], ['.x', '.nothing'], ['.y']])?.rect).toEqual({ left: 10, top: 10, width: 60, height: 20 })
    expect(measureTourHighlight([['.missing'], ['.y']])?.rect).toEqual({ left: 300, top: 300, width: 20, height: 20 })
  })

  it('skips a list whose elements are zero-sized, and returns null when nothing shows', () => {
    document.body.innerHTML = '<i id="a" class="x"></i>'
    box(document.getElementById('a')!, 0, 0, 0, 0)
    expect(measureTourHighlight([['.x']])).toBeNull()
    expect(measureTourHighlight([])).toBeNull()
  })

  it('survives an invalid selector', () => {
    expect(measureTourHighlight([['[[bad']])).toBeNull()
  })

  it('cuts an element by an ancestor that clips it', () => {
    document.body.innerHTML = '<div id="clip" style="overflow-x:hidden;overflow-y:hidden"><i id="a"></i></div>'
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 800 })
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 600 })
    box(document.getElementById('clip')!, 0, 0, 100, 50)
    box(document.getElementById('a')!, 0, 40, 100, 40)
    expect(visibleRect(document.getElementById('a')!)).toEqual({ left: 0, top: 40, width: 100, height: 10 })
    box(document.getElementById('a')!, 0, 60, 100, 40)
    expect(visibleRect(document.getElementById('a')!)).toBeNull()
  })
})
