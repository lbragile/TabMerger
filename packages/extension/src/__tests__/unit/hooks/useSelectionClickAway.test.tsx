/**
 * useSelectionClickAway.test.tsx — 2d: selection mode exits on ANY plain click that isn't
 * a selection control (previously only an empty-space click inside the windows panel did).
 *
 * The negative cases are the point: a click that MODIFIES the selection, the action bar,
 * the checkboxes, a live drag, an open menu's dismiss click, the click that ENTERED
 * selection mode, and anything inside a menu/dialog/toast must all leave it alone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup, act } from '@testing-library/react'
import React from 'react'
import { useSelectionClickAway } from '@/hooks/useSelectionClickAway'
import { SELECTION_ACTION_BAR_ATTR } from '@/lib/selectionFocus'
import { clearDndDragLive, setDndDragLive } from '@/lib/dndMultiDrag'

/**
 * `overlay` renders an OPEN menu + toast. It is opt-in because their mere presence in the
 * DOM at `pointerdown` is what suppresses the following click (the outside-dismiss case),
 * so a positive "plain click cancels" assertion has to run without them.
 */
function Harness({ active, exit, overlay = false }: { active: boolean; exit: () => void; overlay?: boolean }) {
  useSelectionClickAway(active, exit)
  return React.createElement(
    'div',
    null,
    React.createElement('div', { 'data-testid': 'background' }, 'background'),
    React.createElement('div', { 'data-testid': 'row', role: 'listitem' }, 'row'),
    React.createElement('button', {
      'data-testid': 'checkbox',
      role: 'checkbox',
      'aria-checked': false,
      'aria-label': 'Select x'
    }),
    React.createElement(
      'div',
      { [SELECTION_ACTION_BAR_ATTR]: '', 'data-testid': 'bar' },
      React.createElement('button', { 'data-testid': 'bar-button' }, 'Delete')
    ),
    React.createElement('button', { 'data-testid': 'menu-trigger', 'aria-haspopup': 'menu' }, 'More'),
    overlay &&
      React.createElement(
        'div',
        { key: 'menu', 'data-testid': 'menu', role: 'menu' },
        React.createElement('div', { 'data-testid': 'menu-item', role: 'menuitem' }, 'Move')
      ),
    overlay && React.createElement('div', { key: 'toast', 'data-testid': 'toast', 'data-sonner-toast': '' }, 'toast')
  )
}

/**
 * Let the hook ARM. It ignores clicks until the macrotask AFTER it attaches, because in the
 * real popup the click that turns selection mode on is still propagating when the effect
 * runs (for a discrete event React flushes passive effects inside its own root-container
 * listener, and a `document` listener added mid-dispatch still gets that same event).
 */
const arm = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

/** Render the harness and arm it, i.e. the steady state a user actually clicks in. */
async function setup(props: { active: boolean; exit: () => void; overlay?: boolean }) {
  const utils = render(React.createElement(Harness, props))
  await arm()
  return utils
}

/** Click that carries the `pointerdown` the hook probes for open overlays. */
function click(el: Element, init: Partial<MouseEventInit> = {}) {
  fireEvent.pointerDown(el, { ...init, bubbles: true })
  fireEvent.click(el, init)
}

let exit: (() => void) & ReturnType<typeof vi.fn>
beforeEach(() => {
  exit = vi.fn() as typeof exit
  clearDndDragLive()
})
afterEach(() => {
  cleanup()
  clearDndDragLive()
})

describe('useSelectionClickAway — exits', () => {
  it('on a plain click on empty background', async () => {
    const { getByTestId } = await setup({ active: true, exit })
    click(getByTestId('background'))
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('on a plain click on a row (not just empty space)', async () => {
    const { getByTestId } = await setup({ active: true, exit })
    click(getByTestId('row'))
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('never while selection mode is off', async () => {
    const { getByTestId } = await setup({ active: false, exit })
    click(getByTestId('background'))
    expect(exit).not.toHaveBeenCalled()
  })

  it('stops listening once selection mode ends', async () => {
    const { getByTestId, rerender } = await setup({ active: true, exit })
    rerender(React.createElement(Harness, { active: false, exit }))
    await arm()
    click(getByTestId('background'))
    expect(exit).not.toHaveBeenCalled()
  })
})

describe('useSelectionClickAway — does NOT exit', () => {
  const cases: Array<[string, string, Partial<MouseEventInit>]> = [
    ['the checkbox itself', 'checkbox', {}],
    ['the selection action bar', 'bar', {}],
    ['a button inside the action bar', 'bar-button', {}],
    ['a menu trigger', 'menu-trigger', {}],

    ['a Ctrl-click that modifies the selection', 'row', { ctrlKey: true }],
    ['a Meta-click that modifies the selection', 'row', { metaKey: true }],
    ['a Shift-click that extends the selection', 'row', { shiftKey: true }],
    ['an Alt-click', 'row', { altKey: true }],
    ['a non-primary button', 'background', { button: 2 }]
  ]
  for (const [label, testid, init] of cases) {
    it(`on ${label}`, async () => {
      const { getByTestId } = await setup({ active: true, exit })
      click(getByTestId(testid), init)
      expect(exit).not.toHaveBeenCalled()
    })
  }

  it('on a menu item or a toast (they frequently act on the selection)', async () => {
    const { getByTestId } = await setup({ active: true, exit, overlay: true })
    click(getByTestId('menu-item'))
    click(getByTestId('toast'))
    expect(exit).not.toHaveBeenCalled()
  })

  it('on a click while a drag is live', async () => {
    const { getByTestId } = await setup({ active: true, exit })
    setDndDragLive('pointer')
    click(getByTestId('background'))
    expect(exit).not.toHaveBeenCalled()
  })

  it('on the very click that ENTERED selection mode — it is still propagating when the listener attaches', async () => {
    // Regression: clicking the header's "Select items" turned selection mode on and
    // straight back off, because React flushed this effect inside its own listener for
    // that click and the new `document` listener received the same event. The extension
    // E2E suite (`selection.spec.ts` → "shows tab checkboxes") caught it. Here the
    // UNARMED window stands in for "still inside the entering click's task".
    const { getByTestId } = render(React.createElement(Harness, { active: true, exit }))
    click(getByTestId('background'))
    expect(exit).not.toHaveBeenCalled()
    // One macrotask later, a genuine click-away still cancels.
    await arm()
    click(getByTestId('background'))
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('on an already-handled (defaultPrevented) click', async () => {
    const { getByTestId } = await setup({ active: true, exit })
    const el = getByTestId('background')
    el.addEventListener('click', (e) => e.preventDefault())
    click(el)
    expect(exit).not.toHaveBeenCalled()
  })

  it('on the click that DISMISSES an open menu — but does on the very next one', async () => {
    const { getByTestId } = await setup({ active: true, exit, overlay: true })
    // The menu is in the DOM at `pointerdown` (Radix closes on pointerdown, so by the time
    // `click` fires it looks like a plain background click).
    click(getByTestId('background'))
    expect(exit).not.toHaveBeenCalled()
    // Menu gone → the next background click is a real cancel.
    getByTestId('menu').remove()
    getByTestId('toast').remove()
    click(getByTestId('background'))
    expect(exit).toHaveBeenCalledTimes(1)
  })
})
