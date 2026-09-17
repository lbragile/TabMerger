/**
 * uiStoreSelection.test.ts — selection actions used by multi-drag: Ctrl/checkbox toggle
 * (sets the Shift anchor), Shift range, mixed-type rejection, clear, remap-after-drop.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/localDb', () => ({ setSetting: vi.fn().mockResolvedValue(undefined) }))

import { useUIStore } from '@/stores/uiStore'

const T = (n: number) => ({ type: 'tab' as const, id: `tab-1-0-${n}` })
const W = (n: number) => ({ type: 'window' as const, id: `window-1-${n}` })
const st = () => useUIStore.getState()

beforeEach(() => {
  useUIStore.setState({ selectionMode: false, selectedItems: [], selectionAnchor: null })
})

describe('uiStore selection', () => {
  it('Ctrl/checkbox toggle ON makes the item the anchor; toggling the anchor OFF clears it', () => {
    st().toggleSelection(T(0))
    st().toggleSelection(T(2))
    expect(st().selectedItems).toEqual([T(0), T(2)])
    expect(st().selectionAnchor).toEqual(T(2))
    st().toggleSelection(T(0)) // not the anchor → anchor kept
    expect(st().selectionAnchor).toEqual(T(2))
    st().toggleSelection(T(2))
    expect(st().selectedItems).toEqual([])
    expect(st().selectionAnchor).toBeNull()
  })

  it('mixed types are rejected: toggling another type replaces the selection', () => {
    st().toggleSelection(T(0))
    st().toggleSelection(W(0))
    expect(st().selectedItems).toEqual([W(0)])
  })

  it('Shift range ADDS the range to the selection (no duplicates), enters selection mode and keeps the anchor', () => {
    st().toggleSelection(T(1))
    st().selectRange(T(3), [T(1), T(2), T(3)])
    expect(st().selectionMode).toBe(true)
    expect(st().selectedItems).toEqual([T(1), T(2), T(3)])
    expect(st().selectionAnchor).toEqual(T(1))
  })

  it('Shift with no usable anchor (empty range) selects just the clicked item and anchors there', () => {
    st().selectRange(T(4), [])
    expect(st().selectedItems).toEqual([T(4)])
    expect(st().selectionAnchor).toEqual(T(4))
  })

  it('Shift range of another type replaces the selection', () => {
    st().toggleSelection(T(1))
    st().selectRange(W(2), [])
    expect(st().selectedItems).toEqual([W(2)])
  })

  it('setSelection replaces the items (drop remap); clearSelection / exitSelectionMode drop the anchor too', () => {
    st().toggleSelection(T(0))
    st().setSelection([T(5), T(6)])
    expect(st().selectedItems).toEqual([T(5), T(6)])
    expect(st().selectionAnchor).toEqual(T(5))
    st().setSelection([])
    expect(st().selectionAnchor).toBeNull()
    st().toggleSelection(T(0))
    st().clearSelection()
    expect(st().selectedItems).toEqual([])
    expect(st().selectionAnchor).toBeNull()
    st().enterSelectionMode()
    st().toggleSelection(T(0))
    st().exitSelectionMode()
    expect(st()).toMatchObject({ selectionMode: false, selectedItems: [], selectionAnchor: null })
  })

  it('toggleSelectionMode off clears items and the anchor', () => {
    st().toggleSelectionMode()
    st().toggleSelection(T(0))
    st().toggleSelectionMode()
    expect(st()).toMatchObject({ selectionMode: false, selectedItems: [], selectionAnchor: null })
  })
})
