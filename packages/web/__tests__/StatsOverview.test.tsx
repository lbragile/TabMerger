import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { StatsOverview } from '@/components/dashboard/StatsOverview'

describe('StatsOverview 5-card expansion', () => {
  it('renders 4 cards when aiUsage is undefined (no AI calls card)', () => {
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
    expect(screen.queryByText('AI calls this month')).not.toBeInTheDocument()
  })

  it('renders 5 cards including "AI calls this month" when aiUsage is provided', () => {
    render(
      <StatsOverview
        tabCount={42}
        groupCount={3}
        sessionCount={2}
        memberSince="2024-01-01"
        aiUsage={{ used: 7, limit: 50 }}
      />
    )
    expect(screen.getByText('AI calls this month')).toBeInTheDocument()
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
