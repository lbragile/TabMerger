/**
 * useRovingRow.test.tsx — a11y M3 roving tabindex.
 *
 * One Tab stop per row (the row itself), with Left/Right/Home/End walking the row's
 * controls. The negatives matter most: the hook must be completely inert during a drag
 * (dnd-kit owns the arrows then — spec C13) and inside a text field.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import { useRovingRow, rovingControls } from '@/hooks/useRovingRow'
import { clearDndDragLive, setDndDragLive } from '@/lib/dndMultiDrag'

function Row({ withInput = false }: { withInput?: boolean }) {
  const roving = useRovingRow<HTMLDivElement>()
  return React.createElement(
    'div',
    {
      'data-testid': 'row',
      ref: roving.ref,
      tabIndex: 0,
      role: 'listitem',
      onKeyDown: roving.onKeyDown
    },
    // dnd-kit declares tabIndex 0 on the grip, so the component pins -1 explicitly.
    React.createElement('span', { 'data-testid': 'grip', role: 'button', tabIndex: -1, 'aria-label': 'Drag to reorder tab: x' }),
    React.createElement('button', { 'data-testid': 'checkbox', role: 'checkbox', 'aria-checked': false }),
    React.createElement('button', { 'data-testid': 'close' }, 'x'),
    React.createElement('button', { 'data-testid': 'disabled', disabled: true }, 'nope'),
    React.createElement('span', { 'data-testid': 'spacer', 'aria-hidden': 'true', tabIndex: 0 }),
    withInput ? React.createElement('input', { 'data-testid': 'rename', defaultValue: 'abc' }) : null
  )
}

/**
 * The Window.tsx header, in miniature: a focusable `role="toolbar"` container wrapping the
 * aria-hidden context-menu trigger, the grip, the checkbox, note, star and "More". Before
 * a11y M3 this row exposed up to 4 natural Tab stops; now it must expose exactly one.
 */
function WindowHeader({ selectionMode = false }: { selectionMode?: boolean }) {
  const roving = useRovingRow<HTMLDivElement>()
  return React.createElement(
    'div',
    { 'data-testid': 'card', 'data-tm-dnd-id': 'g::w1' },
    React.createElement(
      'div',
      {
        'data-testid': 'header',
        'data-window-header': '',
        ref: roving.ref,
        tabIndex: 0,
        role: 'toolbar',
        'aria-label': 'Window 2 controls',
        onKeyDown: roving.onKeyDown
      },
      // The invisible context-menu trigger: aria-hidden, so never a roving stop.
      React.createElement('button', { 'data-testid': 'ctx', tabIndex: -1, 'aria-hidden': 'true' }),
      React.createElement('span', {
        'data-testid': 'grip',
        role: 'button',
        tabIndex: -1,
        'aria-label': 'Drag to reorder window: Window 2'
      }),
      selectionMode
        ? React.createElement('button', {
            'data-testid': 'checkbox',
            role: 'checkbox',
            'aria-checked': false,
            'aria-label': 'Select Window 2'
          })
        : null,
      React.createElement('button', { 'data-testid': 'note', 'aria-label': 'Edit window note' }),
      React.createElement('button', { 'data-testid': 'star', 'aria-label': 'Star window' }),
      React.createElement('button', { 'data-testid': 'more', 'aria-label': 'More window options' })
    ),
    // The tabs list is a SIBLING of the header, so its rows are not header stops.
    React.createElement(
      'div',
      { role: 'list' },
      React.createElement('div', { 'data-testid': 'tabrow', role: 'listitem', tabIndex: 0 })
    )
  )
}

beforeEach(() => clearDndDragLive())
afterEach(() => {
  cleanup()
  clearDndDragLive()
})

describe('useRovingRow — one Tab stop per row', () => {
  it('sets tabIndex -1 on every control, leaving the row the only natural stop', () => {
    const { getByTestId } = render(React.createElement(Row))
    expect(getByTestId('row').tabIndex).toBe(0)
    for (const id of ['grip', 'checkbox', 'close']) {
      expect(getByTestId(id).tabIndex).toBe(-1)
    }
  })

  it('still lets every control be focused programmatically (dndFocus relies on it)', () => {
    const { getByTestId } = render(React.createElement(Row))
    getByTestId('grip').focus()
    expect(document.activeElement).toBe(getByTestId('grip'))
  })

  it('skips disabled and aria-hidden elements when enumerating controls', () => {
    const { getByTestId } = render(React.createElement(Row))
    const ids = rovingControls(getByTestId('row')).map((el) => el.getAttribute('data-testid'))
    expect(ids).toEqual(['grip', 'checkbox', 'close'])
  })
})

describe('useRovingRow — Left/Right/Home/End', () => {
  const press = (el: Element, key: string, init: Record<string, unknown> = {}) =>
    fireEvent.keyDown(el, { key, bubbles: true, ...init })

  it('ArrowRight walks row → grip → checkbox → close and stops at the end', () => {
    const { getByTestId } = render(React.createElement(Row))
    const row = getByTestId('row')
    row.focus()
    press(row, 'ArrowRight')
    expect(document.activeElement).toBe(getByTestId('grip'))
    press(getByTestId('grip'), 'ArrowRight')
    expect(document.activeElement).toBe(getByTestId('checkbox'))
    press(getByTestId('checkbox'), 'ArrowRight')
    expect(document.activeElement).toBe(getByTestId('close'))
    press(getByTestId('close'), 'ArrowRight')
    expect(document.activeElement).toBe(getByTestId('close')) // no wrap
  })

  it('ArrowLeft walks back and stops on the row', () => {
    const { getByTestId } = render(React.createElement(Row))
    getByTestId('close').focus()
    press(getByTestId('close'), 'ArrowLeft')
    expect(document.activeElement).toBe(getByTestId('checkbox'))
    press(getByTestId('checkbox'), 'ArrowLeft')
    expect(document.activeElement).toBe(getByTestId('grip'))
    press(getByTestId('grip'), 'ArrowLeft')
    expect(document.activeElement).toBe(getByTestId('row'))
    press(getByTestId('row'), 'ArrowLeft')
    expect(document.activeElement).toBe(getByTestId('row')) // no wrap
  })

  it('Home returns to the row, End jumps to the last control', () => {
    const { getByTestId } = render(React.createElement(Row))
    const row = getByTestId('row')
    row.focus()
    press(row, 'End')
    expect(document.activeElement).toBe(getByTestId('close'))
    press(getByTestId('close'), 'Home')
    expect(document.activeElement).toBe(row)
  })

  it('consumes the key it handled so no global shortcut also fires', () => {
    const { getByTestId } = render(React.createElement(Row))
    const row = getByTestId('row')
    row.focus()
    const evt = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    row.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(true)
  })
})

describe('useRovingRow — window header (a11y M3: the header is the row)', () => {
  const press = (el: Element, key: string) => fireEvent.keyDown(el, { key, bubbles: true })

  it('exposes exactly ONE natural Tab stop — the header itself (was grip + note + star + More)', () => {
    const { getByTestId } = render(React.createElement(WindowHeader))
    const header = getByTestId('header')
    const stops = Array.from(header.querySelectorAll<HTMLElement>('button, [role="button"], [tabindex]')).filter(
      (el) => el.tabIndex >= 0 && el.getAttribute('aria-hidden') !== 'true'
    )
    expect(stops).toEqual([])
    expect(header.tabIndex).toBe(0)
    expect(header.getAttribute('role')).toBe('toolbar')
    // The accessible name is what announces WHICH window's controls these are.
    expect(header.getAttribute('aria-label')).toBe('Window 2 controls')
  })

  it('ArrowRight walks header → grip → note → star → More', () => {
    const { getByTestId } = render(React.createElement(WindowHeader))
    const header = getByTestId('header')
    header.focus()
    for (const id of ['grip', 'note', 'star', 'more']) {
      press(document.activeElement!, 'ArrowRight')
      expect(document.activeElement).toBe(getByTestId(id))
    }
    press(document.activeElement!, 'ArrowRight')
    expect(document.activeElement).toBe(getByTestId('more')) // no wrap
    press(document.activeElement!, 'Home')
    expect(document.activeElement).toBe(header)
    press(header, 'End')
    expect(document.activeElement).toBe(getByTestId('more'))
  })

  it('picks up the checkbox that selection mode adds, and never the sibling tab rows', () => {
    const { getByTestId } = render(React.createElement(WindowHeader, { selectionMode: true }))
    const ids = rovingControls(getByTestId('header')).map((el) => el.getAttribute('data-testid'))
    expect(ids).toEqual(['grip', 'checkbox', 'note', 'star', 'more'])
    // The tab row lives outside the header and keeps its own Tab stop.
    expect(getByTestId('tabrow').tabIndex).toBe(0)
  })
})

describe('useRovingRow — when it must stay out of the way', () => {
  const press = (el: Element, key: string, init: Record<string, unknown> = {}) =>
    fireEvent.keyDown(el, { key, bubbles: true, ...init })

  it('never touches ArrowUp / ArrowDown (the group switcher and the drag mover)', () => {
    const { getByTestId } = render(React.createElement(Row))
    const row = getByTestId('row')
    row.focus()
    press(row, 'ArrowDown')
    expect(document.activeElement).toBe(row)
    press(row, 'ArrowUp')
    expect(document.activeElement).toBe(row)
  })

  it('is INERT during a drag, so dnd-kit still gets ArrowLeft (spec C13)', () => {
    const { getByTestId } = render(React.createElement(Row))
    const row = getByTestId('row')
    row.focus()
    setDndDragLive('keyboard')
    const evt = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    row.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(row)
  })

  it('ignores modified arrows (Shift/Ctrl/Alt/Meta belong to selection and shortcuts)', () => {
    const { getByTestId } = render(React.createElement(Row))
    const row = getByTestId('row')
    row.focus()
    for (const mod of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey']) {
      press(row, 'ArrowRight', { [mod]: true })
      expect(document.activeElement).toBe(row)
    }
  })

  it('leaves arrows alone inside a text field (rename input / note textarea)', () => {
    const { getByTestId } = render(React.createElement(Row, { withInput: true }))
    const input = getByTestId('rename')
    input.focus()
    press(input, 'ArrowRight')
    expect(document.activeElement).toBe(input)
  })

  it('leaves the window header alone during a drag too (the grip owns ArrowLeft, C13)', () => {
    const { getByTestId } = render(React.createElement(WindowHeader))
    const grip = getByTestId('grip')
    grip.focus()
    setDndDragLive('keyboard')
    const evt = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
    grip.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(grip)
  })

  it('does nothing for an already-handled key', () => {
    const { getByTestId } = render(React.createElement(Row))
    const row = getByTestId('row')
    row.focus()
    const evt = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    evt.preventDefault()
    row.dispatchEvent(evt)
    expect(document.activeElement).toBe(row)
  })
})
