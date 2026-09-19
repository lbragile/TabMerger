/**
 * useCloseOnOverlayDismiss.test.tsx — starting a multi-select closes any open dropdown,
 * context menu, colour picker or inline note/reminder editor.
 *
 * The negatives matter as much as the positive: the hook must not close anything on mount
 * (a row that renders AFTER a dismissal would otherwise close itself), and it must be
 * driven by a store signal rather than a synthesised Escape key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import React from 'react'
import { useCloseOnOverlayDismiss } from '@/hooks/useCloseOnOverlayDismiss'
import { useUIStore } from '@/stores/uiStore'

function Consumer({ close }: { close: () => void }) {
  useCloseOnOverlayDismiss(close)
  return React.createElement('div', { 'data-testid': 'consumer' })
}

const initial = useUIStore.getState()
beforeEach(() => {
  useUIStore.setState({
    ...initial,
    selectionMode: false,
    selectedItems: [],
    selectionAnchor: null,
    overlayDismissNonce: 0
  })
})
afterEach(cleanup)

describe('useCloseOnOverlayDismiss', () => {
  it('does not close on mount', () => {
    const close = vi.fn()
    render(React.createElement(Consumer, { close }))
    expect(close).not.toHaveBeenCalled()
  })

  it('closes when selection mode is entered', () => {
    const close = vi.fn()
    render(React.createElement(Consumer, { close }))
    act(() => useUIStore.getState().enterSelectionMode())
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('closes again on a second dismissal (it is a counter, not a latch)', () => {
    const close = vi.fn()
    render(React.createElement(Consumer, { close }))
    act(() => useUIStore.getState().dismissOverlays())
    act(() => useUIStore.getState().dismissOverlays())
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('does not close a component that MOUNTS after a dismissal', () => {
    act(() => useUIStore.getState().dismissOverlays())
    const close = vi.fn()
    render(React.createElement(Consumer, { close }))
    expect(close).not.toHaveBeenCalled()
  })

  it('calls the LATEST callback, so an inline arrow closure is safe', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(React.createElement(Consumer, { close: first }))
    rerender(React.createElement(Consumer, { close: second }))
    act(() => useUIStore.getState().dismissOverlays())
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('is silent for selection changes that are not an entry (exit, remap, extra item)', () => {
    const close = vi.fn()
    render(React.createElement(Consumer, { close }))
    act(() => useUIStore.getState().enterSelectionMode())
    act(() => useUIStore.getState().toggleSelection({ type: 'tab', id: 'tab-1-0-0' }))
    expect(close).toHaveBeenCalledTimes(2) // entry, then the FIRST item
    act(() => useUIStore.getState().toggleSelection({ type: 'tab', id: 'tab-1-0-1' }))
    act(() => useUIStore.getState().setSelection([{ type: 'tab', id: 'tab-1-0-2' }]))
    act(() => useUIStore.getState().exitSelectionMode())
    expect(close).toHaveBeenCalledTimes(2)
  })
})

describe('uiStore.overlayDismissNonce — which transitions bump it', () => {
  const nonce = () => useUIStore.getState().overlayDismissNonce

  it('enterSelectionMode bumps only on the false → true transition', () => {
    act(() => useUIStore.getState().enterSelectionMode())
    expect(nonce()).toBe(1)
    act(() => useUIStore.getState().enterSelectionMode())
    expect(nonce()).toBe(1)
  })

  it('toggleSelectionMode bumps on the way IN, never on the way out', () => {
    act(() => useUIStore.getState().toggleSelectionMode())
    expect(nonce()).toBe(1)
    act(() => useUIStore.getState().toggleSelectionMode())
    expect(nonce()).toBe(1)
  })

  it('toggleSelection bumps for the FIRST item only', () => {
    act(() => useUIStore.getState().toggleSelection({ type: 'tab', id: 'a' }))
    expect(nonce()).toBe(1)
    act(() => useUIStore.getState().toggleSelection({ type: 'tab', id: 'b' }))
    expect(nonce()).toBe(1)
  })

  it('selectRange bumps once when it both enters and fills an empty selection', () => {
    act(() =>
      useUIStore.getState().selectRange({ type: 'window', id: 'w0' }, [
        { type: 'window', id: 'w0' },
        { type: 'window', id: 'w1' }
      ])
    )
    expect(nonce()).toBe(1)
    expect(useUIStore.getState().selectionMode).toBe(true)
  })

  it('setSelection does NOT bump when it merely remaps a non-empty selection after a drop', () => {
    act(() => useUIStore.getState().setSelection([{ type: 'tab', id: 'a' }]))
    expect(nonce()).toBe(1)
    act(() => useUIStore.getState().setSelection([{ type: 'tab', id: 'a-moved' }]))
    expect(nonce()).toBe(1)
  })

  it('exitSelectionMode and clearSelection never bump', () => {
    act(() => useUIStore.getState().enterSelectionMode())
    act(() => useUIStore.getState().toggleSelection({ type: 'tab', id: 'a' }))
    const before = nonce()
    act(() => useUIStore.getState().clearSelection())
    act(() => useUIStore.getState().exitSelectionMode())
    expect(nonce()).toBe(before)
  })
})
