/**
 * SessionCard layout — single-column card (replaces the old flex-row +
 * fixed-width side panel, which overflowed at 3-column grid density).
 * Contents are now a collapsible section instead of a side panel, so the
 * card no longer needs a responsive row/column swap.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SessionCard } from '@/components/dashboard/SessionCard'

const BASE_PROPS = {
  id: 'sess-1',
  name: 'My Session',
  groupCount: 1,
  windowCount: 1,
  tabCount: 2,
  createdAt: '2026-07-18T15:45:00.000Z',
  groups: [
    {
      name: 'Group A',
      windows: [{ tabs: [{ url: 'https://example.com', title: 'Example' }] }],
    },
  ],
}

describe('SessionCard — layout', () => {
  it('is a single-column card that can shrink to its grid track (min-w-0, no fixed-width panel)', () => {
    render(<SessionCard {...BASE_PROPS} onRestore={vi.fn()} />)
    const outer = screen.getByText('My Session').closest('div.border')
    expect(outer).toHaveClass('min-w-0')
    expect(outer).not.toHaveClass('flex-row')
  })

  it('hides contents behind a "Show contents" toggle and reveals them on click', () => {
    render(<SessionCard {...BASE_PROPS} onRestore={vi.fn()} />)
    expect(screen.queryByText('Group A')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(/Show contents/i))
    expect(screen.getByText('Group A')).toBeInTheDocument()
    fireEvent.click(screen.getByText(/Hide contents/i))
    expect(screen.queryByText('Group A')).not.toBeInTheDocument()
  })

  it('renders the count badges with the new bg-surface3 rounded-md styling', () => {
    render(<SessionCard {...BASE_PROPS} onRestore={vi.fn()} />)
    const groupBadge = screen.getByText('1 group')
    const windowBadge = screen.getByText('1 window')
    const tabBadge = screen.getByText('2 tabs')
    for (const badge of [groupBadge, windowBadge, tabBadge]) {
      expect(badge).toHaveClass('bg-surface3', 'rounded-md')
    }
  })
})
