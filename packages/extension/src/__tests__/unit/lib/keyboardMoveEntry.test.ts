import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type React from 'react'
import { startMoveOnSpace, toggleSelectionOnCtrlSpace } from '@/lib/keyboardMoveEntry'
import { useUIStore } from '@/stores/uiStore'
import { useKeyboardMoveStore } from '@/stores/keyboardMoveStore'
import { setDndDragLive, clearDndDragLive } from '@/lib/dndMultiDrag'

const ev = (init: Partial<React.KeyboardEvent> & { key: string }) => {
  let prevented = false
  let stopped = false
  return {
    e: {
      code: init.key === ' ' ? 'Space' : init.key,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      repeat: false,
      ...init,
      preventDefault: () => (prevented = true),
      stopPropagation: () => (stopped = true)
    } as unknown as React.KeyboardEvent,
    prevented: () => prevented,
    stopped: () => stopped
  }
}

beforeEach(() => useKeyboardMoveStore.setState({ request: null }))
afterEach(() => clearDndDragLive())

describe('startMoveOnSpace', () => {
  it('plain Space requests a move, consumes the event, and stops it bubbling to the row', () => {
    const x = ev({ key: ' ' })
    expect(startMoveOnSpace(x.e, 'tab', 'g::w0::t1')).toBe(true)
    expect(x.prevented() && x.stopped()).toBe(true)
    expect(useKeyboardMoveStore.getState().request).toEqual({ kind: 'tab', id: 'g::w0::t1' })
  })

  it('Enter, modified Space, auto-repeat and a live move are left alone', () => {
    for (const init of [{ key: 'Enter' }, { key: ' ', shiftKey: true }, { key: ' ', ctrlKey: true }, { key: ' ', metaKey: true }, { key: ' ', altKey: true }, { key: ' ', repeat: true }]) {
      const x = ev(init)
      expect(startMoveOnSpace(x.e, 'tab', 'a')).toBe(false)
      expect(x.prevented()).toBe(false)
    }
    setDndDragLive('keyboard')
    expect(startMoveOnSpace(ev({ key: ' ' }).e, 'tab', 'a')).toBe(false)
    expect(useKeyboardMoveStore.getState().request).toBeNull()
  })
})

describe('toggleSelectionOnCtrlSpace', () => {
  const live = () => document.getElementById('tm-dnd-live-region')?.textContent?.trim() ?? ''
  const tabItem = (n: number) => ({ type: 'tab' as const, id: `tab-1-0-${n}` })
  beforeEach(() => {
    useUIStore.getState().clearSelection()
    useKeyboardMoveStore.setState({ request: null })
  })

  it('Ctrl+Space selects the row, consumes the event, announces it, and never requests a move', () => {
    const x = ev({ key: ' ', ctrlKey: true })
    expect(toggleSelectionOnCtrlSpace(x.e, tabItem(0))).toBe(true)
    expect(x.prevented() && x.stopped()).toBe(true)
    expect(useUIStore.getState().selectedItems).toEqual([tabItem(0)])
    expect(useUIStore.getState().selectionMode).toBe(true)
    expect(live()).toBe('Selected. 1 tab selected.')
    expect(useKeyboardMoveStore.getState().request).toBeNull()
  })

  it('Cmd+Space works the same; a second press deselects, and the count follows the selection', () => {
    toggleSelectionOnCtrlSpace(ev({ key: ' ', metaKey: true }).e, tabItem(0))
    toggleSelectionOnCtrlSpace(ev({ key: ' ', ctrlKey: true }).e, tabItem(1))
    expect(live()).toBe('Selected. 2 tabs selected.')
    toggleSelectionOnCtrlSpace(ev({ key: ' ', ctrlKey: true }).e, tabItem(0))
    expect(live()).toBe('Deselected. 1 tab selected.')
    expect(useUIStore.getState().selectedItems).toEqual([tabItem(1)])
    toggleSelectionOnCtrlSpace(ev({ key: ' ', ctrlKey: true }).e, tabItem(1))
    expect(live()).toBe('Deselected. nothing selected.')
  })

  it('a row of another kind replaces the selection (the same rule as Ctrl+click)', () => {
    toggleSelectionOnCtrlSpace(ev({ key: ' ', ctrlKey: true }).e, tabItem(0))
    toggleSelectionOnCtrlSpace(ev({ key: ' ', ctrlKey: true }).e, { type: 'window', id: 'window-1-0' })
    expect(useUIStore.getState().selectedItems).toEqual([{ type: 'window', id: 'window-1-0' }])
    expect(live()).toBe('Selected. 1 window selected.')
  })

  it('plain Space, Shift/Alt combos and other keys are not handled (left to the row)', () => {
    for (const init of [{ key: ' ' }, { key: ' ', shiftKey: true, ctrlKey: true }, { key: ' ', altKey: true, ctrlKey: true }, { key: 'Enter', ctrlKey: true }, { key: 'a', ctrlKey: true }]) {
      const x = ev(init)
      expect(toggleSelectionOnCtrlSpace(x.e, tabItem(0))).toBe(false)
      expect(x.prevented()).toBe(false)
    }
    expect(useUIStore.getState().selectedItems).toEqual([])
  })

  it('a held key (auto-repeat) or a live drag/move swallows the key without changing the selection', () => {
    const held = ev({ key: ' ', ctrlKey: true, repeat: true })
    expect(toggleSelectionOnCtrlSpace(held.e, tabItem(0))).toBe(true)
    expect(held.prevented()).toBe(true)
    setDndDragLive('keyboard')
    const during = ev({ key: ' ', ctrlKey: true })
    expect(toggleSelectionOnCtrlSpace(during.e, tabItem(0))).toBe(true)
    expect(during.prevented()).toBe(true)
    expect(useUIStore.getState().selectedItems).toEqual([])
  })
})
