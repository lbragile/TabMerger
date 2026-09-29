import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { StatsOverview } from '@/components/dashboard/StatsOverview'

describe('StatsOverview 5-card expansion', () => {
  it('renders 4 cards when aiUsage is undefined (no AI credits card)', () => {
    render(
      <StatsOverview
        tabCount={42}
        groupCount={3}
        sessionCount={2}
        memberSince="2024-01-01"
      />
    )
    expect(screen.getByText('Tabs saved')).toBeInTheDocument()
    expect(screen.getByText('Groups synced')).toBeInTheDocument()
    expect(screen.getByText('Sessions stored')).toBeInTheDocument()
    expect(screen.getByText('Memory reclaimed')).toBeInTheDocument()
    expect(screen.queryByText('AI credits this month')).not.toBeInTheDocument()
  })

  it('renders 5 cards including "AI credits this month" when aiUsage is provided', () => {
    render(
      <StatsOverview
        tabCount={42}
        groupCount={3}
        sessionCount={2}
        memberSince="2024-01-01"
        aiUsage={{ used: 7, limit: 50 }}
      />
    )
    expect(screen.getByText('AI credits this month')).toBeInTheDocument()
    expect(screen.getByText('7/50')).toBeInTheDocument()
  })

  it('formats the "Tabs saved" value as the raw tabCount', () => {
    render(
      <StatsOverview tabCount={42} groupCount={3} sessionCount={2} memberSince="2024-01-01" />
    )
    // "Tabs saved" card value should reflect the tabCount prop
    const card = screen.getByText('Tabs saved').closest('div')?.parentElement
    expect(card?.textContent).toContain('42')
  })

  it('formats "Memory reclaimed" as a heuristic estimate string (e.g. contains MB or GB)', () => {
    // 500 tabs at an assumed ~4.2MB/tab heuristic should land comfortably in GB territory
    render(
      <StatsOverview tabCount={500} groupCount={3} sessionCount={2} memberSince="2024-01-01" />
    )
    const card = screen.getByText('Memory reclaimed').closest('div')?.parentElement
    expect(card?.textContent).toMatch(/\d+(\.\d+)?\s?(MB|GB)/)
  })
})

describe('StatsOverview — showSyncStats=false (free accounts)', () => {
  it('hides every sync-dependent stat and keeps only Member Since', () => {
    render(
      <StatsOverview
        tabCount={0}
        groupCount={0}
        sessionCount={0}
        memberSince="2024-01-01"
        showSyncStats={false}
      />
    )
    expect(screen.queryByText('Tabs saved')).not.toBeInTheDocument()
    expect(screen.queryByText('Groups synced')).not.toBeInTheDocument()
    expect(screen.queryByText('Sessions stored')).not.toBeInTheDocument()
    expect(screen.queryByText('Memory reclaimed')).not.toBeInTheDocument()
    expect(screen.getByText('Member Since')).toBeInTheDocument()
  })

  it('still shows AI usage alongside Member Since when provided (AI gating is independent)', () => {
    render(
      <StatsOverview
        tabCount={0}
        groupCount={0}
        sessionCount={0}
        memberSince="2024-01-01"
        showSyncStats={false}
        aiUsage={{ used: 1, limit: 10 }}
      />
    )
    expect(screen.getByText('Member Since')).toBeInTheDocument()
    expect(screen.getByText('AI credits this month')).toBeInTheDocument()
  })

  it('defaults showSyncStats to true when the prop is omitted (existing Pro behavior)', () => {
    render(
      <StatsOverview tabCount={5} groupCount={1} sessionCount={1} memberSince="2024-01-01" />
    )
    expect(screen.getByText('Tabs saved')).toBeInTheDocument()
  })
})
