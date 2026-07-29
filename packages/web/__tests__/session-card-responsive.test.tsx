/**
 * Mobile-responsiveness sweep — SessionCard
 *
 * Covers the unplanned fix found during the design-system responsive batch:
 * outer row switches flex-col (mobile) -> flex-row (md+), and the contents
 * side panel swaps its border from top (mobile) to left (md+).
 */
import { render, screen } from '@testing-library/react'
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

describe('SessionCard — responsive layout', () => {
  it('stacks the outer row vertically on mobile and switches to row layout at md+', () => {
    render(<SessionCard {...BASE_PROPS} onRestore={vi.fn()} />)
    const outer = screen.getByText('My Session').closest('div.border')
    expect(outer).toHaveClass('flex', 'flex-col', 'md:flex-row')
  })

  it('swaps the contents panel border from top (mobile) to left (md+) and goes full-width on mobile', () => {
    render(<SessionCard {...BASE_PROPS} onRestore={vi.fn()} />)
    const contentsPanel = screen.getByText('Contents').closest('div')
    expect(contentsPanel).toHaveClass('w-full', 'md:w-[280px]', 'border-t-2', 'md:border-t-0', 'md:border-l-2')
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
