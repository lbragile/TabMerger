import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import React from 'react'
import { pickUpFromRow } from '@/lib/dndKeyboardPickup'

const live = vi.hoisted(() => ({ value: false }))
vi.mock('@/lib/dndMultiDrag', () => ({ isDndDragLive: () => live.value }))

function Row({ grip = true, disabled = false, onFallthrough }: { grip?: boolean; disabled?: boolean; onFallthrough?: () => void }) {
  return (
    <div
      data-testid="row"
      tabIndex={0}
      onKeyDown={(e) => {
        if (pickUpFromRow(e)) return
        // Like the real rows: only keys on the row ITSELF fall through to "activate".
        if (e.target === e.currentTarget) onFallthrough?.()
      }}
    >
      {grip && <span data-testid="grip" tabIndex={-1} aria-label="Drag to reorder tab: x" aria-disabled={disabled ? 'true' : undefined} />}
      <button data-testid="inner" />
    </div>
  )
}

afterEach(() => {
  live.value = false
})

describe('pickUpFromRow', () => {
  it('Space on the row focuses the grip, dispatches a Space keydown there, and consumes the key', () => {
    const fall = vi.fn()
    const { getByTestId } = render(<Row onFallthrough={fall} />)
    const seen = vi.fn()
    getByTestId('grip').addEventListener('keydown', (e) => seen((e as KeyboardEvent).code))
    getByTestId('row').focus()
    const notPrevented = fireEvent.keyDown(getByTestId('row'), { key: ' ', code: 'Space' })
    expect(seen).toHaveBeenCalledWith('Space')
    expect(document.activeElement).toBe(getByTestId('grip'))
    expect(notPrevented).toBe(false)
    expect(fall).not.toHaveBeenCalled()
  })

  it('does not consume Enter, modified Space, or keys from nested controls', () => {
    const fall = vi.fn()
    const { getByTestId } = render(<Row onFallthrough={fall} />)
    fireEvent.keyDown(getByTestId('row'), { key: 'Enter', code: 'Enter' })
    fireEvent.keyDown(getByTestId('row'), { key: ' ', code: 'Space', shiftKey: true })
    fireEvent.keyDown(getByTestId('row'), { key: ' ', code: 'Space', ctrlKey: true })
    fireEvent.keyDown(getByTestId('inner'), { key: ' ', code: 'Space' })
    expect(fall).toHaveBeenCalledTimes(3)
    expect(document.activeElement).not.toBe(getByTestId('inner'))
    expect(document.activeElement).not.toBe(getByTestId('grip'))
  })

  it('falls through when a drag is already live, the row has no grip, or the grip is disabled', () => {
    const fall = vi.fn()
    const { getByTestId, rerender } = render(<Row onFallthrough={fall} />)
    live.value = true
    fireEvent.keyDown(getByTestId('row'), { key: ' ', code: 'Space' })
    live.value = false
    rerender(<Row grip={false} onFallthrough={fall} />)
    fireEvent.keyDown(getByTestId('row'), { key: ' ', code: 'Space' })
    rerender(<Row disabled onFallthrough={fall} />)
    fireEvent.keyDown(getByTestId('row'), { key: ' ', code: 'Space' })
    expect(fall).toHaveBeenCalledTimes(3)
  })
})
