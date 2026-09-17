/**
 * SelectionAnnouncer.test.tsx — selection changes (toggle, range, Ctrl+A, remap after a
 * drop, clear) are announced in an always-mounted polite live region.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'
import { SelectionAnnouncer, selectionMessage } from '@/components/SelectionAnnouncer'
import { useUIStore, type SelectedItem } from '@/stores/uiStore'
import { noteDropSelectionRemap } from '@/lib/dndAnnouncements'

const tabs = (...ids: string[]): SelectedItem[] => ids.map((id) => ({ type: 'tab', id }))

describe('selectionMessage', () => {
  it('count on change, silent for a same-size remap AFTER A DROP (the drop outcome says it), "cleared" on empty, null for no change', () => {
    expect(selectionMessage([], tabs('tab-1-0-0'))).toBe('1 tab selected.')
    expect(selectionMessage(tabs('tab-1-0-0'), tabs('tab-1-0-0', 'tab-1-0-1', 'tab-1-0-2'))).toBe('3 tabs selected.')
    expect(selectionMessage(tabs('tab-1-0-0', 'tab-1-0-1'), tabs('tab-2-1-0', 'tab-2-1-1'), true)).toBeNull()
    // the same size WITHOUT a drop (e.g. Ctrl+A in another window) is a real new selection
    expect(selectionMessage(tabs('tab-1-0-0', 'tab-1-0-1'), tabs('tab-2-1-0', 'tab-2-1-1'))).toBe('2 tabs selected.')
    expect(selectionMessage(tabs('tab-1-0-0'), [])).toBe('Selection cleared.')
    expect(selectionMessage([], [])).toBeNull()
    const same = tabs('tab-1-0-0')
    expect(selectionMessage(same, same)).toBeNull()
    expect(selectionMessage(tabs('tab-1-0-0'), tabs('tab-1-0-0'))).toBeNull()
    // a type switch of the same size is a new selection, not a remap
    expect(selectionMessage(tabs('tab-1-0-0'), [{ type: 'window', id: 'window-1-0' }])).toBe('1 window selected.')
  })
})

describe('<SelectionAnnouncer />', () => {
  beforeEach(() => {
    useUIStore.setState({ selectedItems: [], selectionMode: false, selectionAnchor: null })
  })

  it('is a polite status region that follows the store', () => {
    render(<SelectionAnnouncer />)
    const region = screen.getByRole('status')
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.textContent).toBe('')

    act(() => useUIStore.setState({ selectedItems: tabs('tab-1-0-0', 'tab-1-0-1') }))
    expect(region.textContent).toBe('2 tabs selected.')
    // a drop re-pointing the same selection stays silent (A3: no talk-over with the drop outcome)
    const remapped = tabs('tab-2-0-0', 'tab-2-0-1')
    noteDropSelectionRemap(remapped)
    act(() => useUIStore.setState({ selectedItems: remapped }))
    expect(region.textContent).toBe('2 tabs selected.')
    // the mark is single-use: the next same-size change is announced again
    act(() => useUIStore.setState({ selectedItems: tabs('tab-3-0-0', 'tab-3-0-1') }))
    expect(region.textContent?.trim()).toBe('2 tabs selected.')
    expect(region.textContent).not.toBe('2 tabs selected.')
    act(() => useUIStore.setState({ selectedItems: [] }))
    expect(region.textContent).toBe('Selection cleared.')
    // the identical message again is still re-announced (text differs by a no-break space)
    act(() => useUIStore.setState({ selectedItems: tabs('tab-1-0-0') }))
    act(() => useUIStore.setState({ selectedItems: [] }))
    expect(region.textContent?.trim()).toBe('Selection cleared.')
  })
})
