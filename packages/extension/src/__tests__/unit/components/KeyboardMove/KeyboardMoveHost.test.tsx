/**
 * KeyboardMoveHost.test.tsx — the host of keyboard move mode is NOT a drawn marker any more:
 * the preview is the pointer drag's own (collapsed rows, insertion gap, docked copy, zone
 * highlight). What the host renders is one stable, visually hidden, programmatically
 * focusable element that owns focus during a move, and it runs the controller hook with it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

const { useKeyboardMoveSpy } = vi.hoisted(() => ({ useKeyboardMoveSpy: vi.fn() }))
vi.mock('@/hooks/useKeyboardMove', () => ({ useKeyboardMove: useKeyboardMoveSpy }))

import { KeyboardMoveHost } from '@/components/KeyboardMove/KeyboardMoveHost'

beforeEach(() => useKeyboardMoveSpy.mockClear())

describe('KeyboardMoveHost', () => {
  it('draws no marker (no line, box or outline element of its own)', () => {
    const { container } = render(<KeyboardMoveHost />)
    expect(screen.queryByTestId('keyboard-move-marker')).toBeNull()
    expect(container.children).toHaveLength(1)
    expect(container.firstElementChild?.children).toHaveLength(0)
  })

  it('renders a visually hidden, labelled group that can take programmatic focus but is not a Tab stop', () => {
    render(<KeyboardMoveHost />)
    const host = screen.getByTestId('keyboard-move-host')
    expect(host.getAttribute('role')).toBe('group')
    expect(host.getAttribute('aria-label')).toBe('Moving items')
    expect(host.getAttribute('tabindex')).toBe('-1')
    expect(host.className).toMatch(/\bsr-only\b/)
    host.focus()
    expect(document.activeElement).toBe(host)
  })

  it('runs the controller with a ref to that very element', () => {
    render(<KeyboardMoveHost />)
    expect(useKeyboardMoveSpy).toHaveBeenCalled()
    const ref = useKeyboardMoveSpy.mock.calls[useKeyboardMoveSpy.mock.calls.length - 1][0] as React.RefObject<HTMLElement>
    expect(ref.current).toBe(screen.getByTestId('keyboard-move-host'))
  })
})
