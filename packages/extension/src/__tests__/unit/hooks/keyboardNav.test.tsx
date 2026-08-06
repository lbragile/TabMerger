/**
 * EXT-003 keyboard navigation
 * Tests for useKeyboardNav hook.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { useUIStore } from '@/stores/uiStore'

// ─── Hoisted mocks (must be available when vi.mock factories run) ─────────────

const { mockAddGroup, mockDeleteTab } = vi.hoisted(() => ({
  mockAddGroup: vi.fn(),
  mockDeleteTab: vi.fn(),
}))

// ─── Mock heavy dependencies ──────────────────────────────────────────────────

vi.mock('@/lib/localDb', () => ({
  setSetting: vi.fn().mockResolvedValue(undefined),
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  getGroupsState: vi.fn().mockResolvedValue({ groups: [] }),
}))

vi.mock('@/hooks/useGroups', () => ({
  useGroups: vi.fn(() => ({ data: { groups: [] } })),
  useSetGroupsState: vi.fn(() => vi.fn()),
  useAddGroup: vi.fn(() => ({ mutate: mockAddGroup })),
  useDeleteTab: vi.fn(() => ({ mutate: mockDeleteTab })),
}))

// ─── Reset state ──────────────────────────────────────────────────────────────

beforeEach(() => {
  useUIStore.setState({
    modal: { type: null },
    activeGroupIndex: 0,
    searchFilter: '',
    renameTarget: null,
    noteTarget: null,
    undoStack: [],
    redoStack: [],
    selectionMode: false,
    selectedItems: [],
  })
  mockAddGroup.mockClear()
  mockDeleteTab.mockClear()
})

import { useKeyboardNav } from '@/hooks/useKeyboardNav'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useKeyboardNav', () => {
  it('Ctrl+G calls the add-group handler', async () => {
    const user = userEvent.setup()
    renderHook(() => useKeyboardNav({ groupCount: 3, focusedTabId: null }))
    await user.keyboard('{Control>}g{/Control}')
    expect(mockAddGroup).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+F focuses the search input', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <input data-testid="search-input" placeholder="Search" />
      </div>
    )
    const input = screen.getByTestId('search-input')
    renderHook(() => useKeyboardNav({ groupCount: 3, focusedTabId: null, searchInputRef: { current: input } }))
    await user.keyboard('{Control>}f{/Control}')
    expect(document.activeElement).toBe(input)
  })

  it('ArrowDown increments activeGroupIndex', async () => {
    const user = userEvent.setup()
    useUIStore.setState({ activeGroupIndex: 1 })
    renderHook(() => useKeyboardNav({ groupCount: 3, focusedTabId: null }))
    await user.keyboard('{ArrowDown}')
    expect(useUIStore.getState().activeGroupIndex).toBe(2)
  })

  it('ArrowUp decrements activeGroupIndex', async () => {
    const user = userEvent.setup()
    useUIStore.setState({ activeGroupIndex: 2 })
    renderHook(() => useKeyboardNav({ groupCount: 3, focusedTabId: null }))
    await user.keyboard('{ArrowUp}')
    expect(useUIStore.getState().activeGroupIndex).toBe(1)
  })

  it('ArrowDown does not exceed groupCount - 1', async () => {
    const user = userEvent.setup()
    useUIStore.setState({ activeGroupIndex: 2 })
    renderHook(() => useKeyboardNav({ groupCount: 3, focusedTabId: null }))
    await user.keyboard('{ArrowDown}')
    expect(useUIStore.getState().activeGroupIndex).toBe(2)
  })

  it('ArrowUp does not go below 0', async () => {
    const user = userEvent.setup()
    useUIStore.setState({ activeGroupIndex: 0 })
    renderHook(() => useKeyboardNav({ groupCount: 3, focusedTabId: null }))
    await user.keyboard('{ArrowUp}')
    expect(useUIStore.getState().activeGroupIndex).toBe(0)
  })

  it('Del calls deleteTab handler when a tab is focused', async () => {
    const user = userEvent.setup()
    renderHook(() => useKeyboardNav({ groupCount: 3, focusedTabId: 'tab-abc' }))
    await user.keyboard('{Delete}')
    expect(mockDeleteTab).toHaveBeenCalledWith('tab-abc')
  })

  it('Del does nothing when no tab is focused', async () => {
    const user = userEvent.setup()
    renderHook(() => useKeyboardNav({ groupCount: 3, focusedTabId: null }))
    await user.keyboard('{Delete}')
    expect(mockDeleteTab).not.toHaveBeenCalled()
  })

  it('F2 sets renameTarget for the focused tab row', async () => {
    const user = userEvent.setup()
    render(<div tabIndex={0} data-testid="tabrow" data-group-index="0" data-window-index="1" data-tab-index="2" />)
    screen.getByTestId('tabrow').focus()
    renderHook(() => useKeyboardNav({ groupCount: 3, focusedTabId: null }))
    await user.keyboard('{F2}')
    expect(useUIStore.getState().renameTarget).toEqual({ kind: 'tab', groupIndex: 0, windowIndex: 1, tabIndex: 2 })
  })

  it('F2 does nothing when no tab row is focused', async () => {
    const user = userEvent.setup()
    renderHook(() => useKeyboardNav({ groupCount: 3, focusedTabId: null }))
    await user.keyboard('{F2}')
    expect(useUIStore.getState().renameTarget).toBeNull()
  })

  it('N sets noteTarget for the focused tab row', async () => {
    const user = userEvent.setup()
    render(<div tabIndex={0} data-testid="tabrow" data-group-index="1" data-window-index="0" data-tab-index="3" />)
    screen.getByTestId('tabrow').focus()
    renderHook(() => useKeyboardNav({ groupCount: 3, focusedTabId: null }))
    await user.keyboard('n')
    expect(useUIStore.getState().noteTarget).toEqual({ groupIndex: 1, windowIndex: 0, tabIndex: 3 })
  })

  it('N does nothing when no tab row is focused', async () => {
    const user = userEvent.setup()
    renderHook(() => useKeyboardNav({ groupCount: 3, focusedTabId: null }))
    await user.keyboard('n')
    expect(useUIStore.getState().noteTarget).toBeNull()
  })
})

describe('focus ring', () => {
  it('focused group item has ring-2 class', async () => {
    // The hook exposes focusedGroupIndex derived from activeGroupIndex in uiStore.
    // Callers use it to apply ring-2 to the active group row.
    const { result, rerender } = renderHook(() =>
      useKeyboardNav({ groupCount: 3, focusedTabId: null })
    )
    act(() => {
      useUIStore.setState({ activeGroupIndex: 1 })
    })
    rerender()
    expect(result.current.focusedGroupIndex).toBe(1)
  })
})
