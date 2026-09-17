/**
 * selectionFocus.test.ts — focus never falls to <body> when selection controls unmount
 * (a selection checkbox, or anything in the selection action bar).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { moveFocusOutOfSelectionControls, selectionFocusFallback, SELECTION_ACTION_BAR_ATTR } from '@/lib/selectionFocus'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, parent: Element = document.body) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  parent.appendChild(node)
  return node
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('moveFocusOutOfSelectionControls', () => {
  it('a focused tab checkbox → its row', () => {
    const row = el('div', { role: 'listitem', tabindex: '0' })
    const box = el('button', { role: 'checkbox' }, row)
    box.focus()
    moveFocusOutOfSelectionControls()
    expect(document.activeElement).toBe(row)
  })

  it('focus inside the ACTION BAR → the header selection toggle (not a row the bar happens to follow)', () => {
    const toggle = el('button', { 'aria-label': 'Exit selection mode' })
    const bar = el('div', { [SELECTION_ACTION_BAR_ATTR]: '' })
    const cancel = el('button', { 'aria-label': 'Cancel selection' }, bar)
    cancel.focus()
    moveFocusOutOfSelectionControls()
    expect(document.activeElement).toBe(toggle)
  })

  it('no toggle → the first drag grip in the panel', () => {
    const row = el('div', { 'data-tm-dnd-id': 'g::w0::t0' })
    const grip = el('span', { 'aria-label': 'Drag to reorder tab: a', tabindex: '0' }, row)
    const bar = el('div', { [SELECTION_ACTION_BAR_ATTR]: '' })
    el('button', {}, bar).focus()
    moveFocusOutOfSelectionControls()
    expect(document.activeElement).toBe(grip)
  })

  it('focus elsewhere → left alone', () => {
    el('button', { 'aria-label': 'Select items' })
    const other = el('button', { 'aria-label': 'Search' })
    other.focus()
    moveFocusOutOfSelectionControls()
    expect(document.activeElement).toBe(other)
  })

  it('selectionFocusFallback with no source (focus already lost) → the toggle', () => {
    const toggle = el('button', { 'aria-label': 'Select items' })
    expect(selectionFocusFallback()).toBe(toggle)
  })
})
