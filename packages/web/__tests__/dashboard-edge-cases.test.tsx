import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { StatsOverview } from '@/components/dashboard/StatsOverview'
import { GroupGrid } from '@/components/dashboard/GroupGrid'
import { SessionCard } from '@/components/dashboard/SessionCard'
import { SessionList } from '@/components/dashboard/SessionList'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

describe('StatsOverview edge cases', () => {
  it('shows a zero-state "Memory reclaimed" value when tabCount is 0', () => {
    render(
      <StatsOverview tabCount={0} groupCount={0} sessionCount={0} memberSince="2024-01-01" />
    )
    const card = screen.getByText('Memory reclaimed').closest('div')?.parentElement
    expect(card?.textContent).toMatch(/0\s?MB/)
  })

  it('renders the AI usage card correctly when used === limit', () => {
    render(
      <StatsOverview
        tabCount={10}
        groupCount={1}
        sessionCount={1}
        memberSince="2024-01-01"
        aiUsage={{ used: 50, limit: 50 }}
      />
    )
    expect(screen.getByText('50/50')).toBeInTheDocument()
  })
})

describe('GroupGrid sort edge cases', () => {
  it('handles a single group without erroring for every sort option', () => {
    const one = [
      {
        id: 'g1',
        name: 'Solo',
        color: 'rgba(0,0,0,1)',
        windows: [{ tabs: [{ title: 'T', url: 'https://x.com' }] }],
        updated_at: new Date().toISOString(),
      },
    ]
    render(<GroupGrid groups={one} isPro={false} />)
    const sortSelect = screen.getByLabelText(/sort/i)
    fireEvent.change(sortSelect, { target: { value: 'name' } })
    expect(screen.getByText('Solo')).toBeInTheDocument()
    fireEvent.change(sortSelect, { target: { value: 'tabCount' } })
    expect(screen.getByText('Solo')).toBeInTheDocument()
  })

  it('does not throw when sorting groups missing updated_at (falls back to Invalid Date, order stable)', () => {
    const groups = [
      {
        id: 'g1',
        name: 'NoDate',
        color: 'rgba(0,0,0,1)',
        windows: [{ tabs: [] }],
        updated_at: undefined as unknown as string,
      },
      {
        id: 'g2',
        name: 'HasDate',
        color: 'rgba(0,0,0,1)',
        windows: [{ tabs: [] }],
        updated_at: new Date().toISOString(),
      },
    ]
    expect(() => render(<GroupGrid groups={groups} isPro={false} />)).not.toThrow()
    expect(screen.getByText('NoDate')).toBeInTheDocument()
    expect(screen.getByText('HasDate')).toBeInTheDocument()
  })

  it('boundary: does NOT show stale warning just under 30 days old', () => {
    // Note: exactly `Date.now() - 30d` is flaky in practice — isStale() re-evaluates
    // Date.now() at render time, a few ms after this timestamp is computed, so the
    // diff is always slightly > 30d by the time the component renders. Use 29d to
    // assert the non-stale side of the boundary without timing flakiness.
    const groups = [
      {
        id: 'g1',
        name: 'Under30',
        color: 'rgba(0,0,0,1)',
        windows: [{ tabs: [{ title: 'T', url: 'https://x.com' }] }],
        updated_at: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]
    render(<GroupGrid groups={groups} isPro={false} />)
    expect(screen.getByText('Under30')).toBeInTheDocument()
    expect(screen.queryByText(/may be stale/i)).not.toBeInTheDocument()
  })

  it('boundary: shows stale warning at 31 days old', () => {
    const groups = [
      {
        id: 'g1',
        name: 'Over30',
        color: 'rgba(0,0,0,1)',
        windows: [{ tabs: [{ title: 'T', url: 'https://x.com' }] }],
        updated_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]
    render(<GroupGrid groups={groups} isPro={false} />)
    expect(screen.getByText(/may be stale/i)).toBeInTheDocument()
  })
})

describe('SessionCard progress strip edge cases', () => {
  it('renders a single full-width segment when there is only one group', () => {
    const { container } = render(
      <SessionCard
        id="s1"
        name="Solo Session"
        groups={[{ name: 'Only', color: 'rgba(1,2,3,1)', windows: [{ tabs: [{ url: 'https://a.com' }] }] }]}
        groupCount={1}
        windowCount={1}
        tabCount={1}
        createdAt={new Date().toISOString()}
      />
    )
    const segments = container.querySelectorAll('[data-testid="progress-segment"]')
    expect(segments).toHaveLength(1)
    expect((segments[0] as HTMLElement).style.width).toBe('100%')
  })

  it('does not divide by zero / render segments when tabCount is 0', () => {
    const { container } = render(
      <SessionCard
        id="s1"
        name="Empty Session"
        groups={[{ name: 'Empty', color: 'rgba(1,2,3,1)', windows: [{ tabs: [] }] }]}
        groupCount={1}
        windowCount={1}
        tabCount={0}
        createdAt={new Date().toISOString()}
      />
    )
    const segments = container.querySelectorAll('[data-testid="progress-segment"]')
    expect(segments).toHaveLength(0)
  })
})

describe('GroupGrid list view + selection mode (previously uncovered branches)', () => {
  const groups = [
    {
      id: 'g1',
      name: 'Work',
      color: 'rgba(0,180,204,1)',
      windows: [{ tabs: [{ title: 'Tab 1', url: 'https://example.com' }] }],
      updated_at: new Date().toISOString(),
    },
  ]

  it('renders GroupRow when List view is selected', () => {
    render(<GroupGrid groups={groups} isPro={false} />)
    fireEvent.click(screen.getByLabelText('List view'))
    expect(screen.getByText('Work')).toBeInTheDocument()
    expect(screen.getByText(/1w · 1t/)).toBeInTheDocument()
  })

  it('lets a pro user enter selection mode and toggle a card selected', () => {
    render(<GroupGrid groups={groups} isPro={true} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    fireEvent.click(screen.getByLabelText('Select'))
    expect(screen.getByLabelText('Deselect')).toBeInTheDocument()
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })
})

describe('SessionList restore/delete (previously uncovered branches)', () => {
  it('opens a tab per URL when "Restore session" is clicked', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(
      <SessionList
        sessions={[
          {
            id: 's1',
            name: 'Session 1',
            groups: [{ name: 'G', windows: [{ tabs: [{ url: 'https://a.com' }] }] }],
            created_at: new Date().toISOString(),
          },
        ]}
        isPro={true}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Restore session' }))
    expect(openSpy).toHaveBeenCalledWith('https://a.com', '_blank', 'noopener')
    openSpy.mockRestore()
  })

  it('calls the delete API and shows a free-plan upgrade note when not pro', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response)
    render(
      <SessionList
        sessions={[
          { id: 's1', name: 'Session 1', groups: [], created_at: new Date().toISOString() },
        ]}
        isPro={false}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/sessions/s1', { method: 'DELETE' }))
    expect(screen.getByText(/Free plan: up to 3 sessions/i)).toBeInTheDocument()
    fetchSpy.mockRestore()
  })
})
