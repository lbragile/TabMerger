/**
 * Feature 61 — Session restore (web dashboard)
 *
 * Tests the behaviors the implementation must satisfy.
 * ALL tests FAIL until SessionCard gains: Restore button, windowCount,
 * tabCount, full datetime format, and 0-safe stat display.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
// ponytail: import the component under test — will fail if SessionCard
// doesn't yet accept the new props (windowCount, tabCount, onRestore)
import { SessionCard } from '@/components/dashboard/SessionCard'

const BASE_PROPS = {
  id: 'sess-1',
  name: 'My Session',
  groupCount: 3,
  windowCount: 2,
  tabCount: 12,
  createdAt: '2026-07-18T15:45:00.000Z',
}

describe('SessionCard — Feature 61 restore', () => {
  it('renders a Restore button', () => {
    render(<SessionCard {...BASE_PROPS} onRestore={vi.fn()} />)
    expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument()
  })

  it('displays group count in stats badge', () => {
    render(<SessionCard {...BASE_PROPS} onRestore={vi.fn()} />)
    expect(screen.getByText(/3 groups/i)).toBeInTheDocument()
  })

  it('displays window count in stats', () => {
    render(<SessionCard {...BASE_PROPS} onRestore={vi.fn()} />)
    expect(screen.getByText(/2 windows/i)).toBeInTheDocument()
  })

  it('displays tab count in stats', () => {
    render(<SessionCard {...BASE_PROPS} onRestore={vi.fn()} />)
    expect(screen.getByText(/12 tabs/i)).toBeInTheDocument()
  })

  it('pluralizes "window" correctly for 1 window', () => {
    render(<SessionCard {...BASE_PROPS} windowCount={1} onRestore={vi.fn()} />)
    expect(screen.getByText(/1 window\b/i)).toBeInTheDocument()
    expect(screen.queryByText(/1 windows/i)).not.toBeInTheDocument()
  })

  it('pluralizes "tab" correctly for 1 tab', () => {
    render(<SessionCard {...BASE_PROPS} tabCount={1} onRestore={vi.fn()} />)
    expect(screen.getByText(/1 tab\b/i)).toBeInTheDocument()
    expect(screen.queryByText(/1 tabs/i)).not.toBeInTheDocument()
  })

  it('displays full datetime including time (not just date)', () => {
    render(<SessionCard {...BASE_PROPS} onRestore={vi.fn()} />)
    // Must show time component — e.g. "3:45 PM" or "15:45"
    const card = screen.getByText(/july/i)
    expect(card.textContent).toMatch(/\d{1,2}:\d{2}/i)
  })

  it('clicking Restore calls onRestore with the session id', async () => {
    const user = userEvent.setup()
    const onRestore = vi.fn()
    render(<SessionCard {...BASE_PROPS} onRestore={onRestore} />)
    await user.click(screen.getByRole('button', { name: /restore/i }))
    expect(onRestore).toHaveBeenCalledOnce()
    expect(onRestore).toHaveBeenCalledWith('sess-1')
  })

  it('is 0-safe — renders "0 windows" without crashing', () => {
    render(<SessionCard {...BASE_PROPS} windowCount={0} tabCount={0} onRestore={vi.fn()} />)
    expect(screen.getByText(/0 windows/i)).toBeInTheDocument()
    expect(screen.getByText(/0 tabs/i)).toBeInTheDocument()
  })

  it('renders "0 windows" safely when windowCount is undefined (missing field)', () => {
    // ponytail: edge case — sessions saved before windowCount was tracked may omit the field
    const props = { ...BASE_PROPS, windowCount: undefined as unknown as number }
    expect(() => render(<SessionCard {...props} onRestore={vi.fn()} />)).not.toThrow()
    expect(screen.getByText(/0 windows/i)).toBeInTheDocument()
  })
})
