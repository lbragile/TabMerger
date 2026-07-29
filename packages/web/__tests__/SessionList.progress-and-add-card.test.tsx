import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { SessionList } from '@/components/dashboard/SessionList'
import { SessionCard } from '@/components/dashboard/SessionCard'

const groups = [
  { name: 'Work', color: 'rgba(255,0,0,1)', windows: [{ tabs: [{ url: 'https://a.com' }, { url: 'https://b.com' }] }] },
  { name: 'Personal', color: 'rgba(0,0,255,1)', windows: [{ tabs: [{ url: 'https://c.com' }] }] },
]

describe('SessionCard colored progress-bar strip', () => {
  it('renders one segment per group, proportional in width to that group\'s tab share', () => {
    const { container } = render(
      <SessionCard
        id="s1"
        name="My Session"
        groups={groups}
        groupCount={2}
        windowCount={2}
        tabCount={3}
        createdAt={new Date().toISOString()}
      />
    )

    const segments = container.querySelectorAll('[data-testid="progress-segment"]')
    expect(segments).toHaveLength(2)

    // Work has 2/3 tabs -> ~66.67% width, Personal has 1/3 -> ~33.33%
    const workSegment = segments[0] as HTMLElement
    expect(workSegment.style.width).toMatch(/^66\.6\d*%$|^66\.67%$/)
    expect(workSegment.style.background).toContain('rgb(255, 0, 0)')
  })
})

describe('SessionList trailing "+" card', () => {
  it('renders a "Save current tabs as a session" card after populated sessions', () => {
    render(
      <SessionList
        sessions={[
          { id: 's1', name: 'Session 1', groups: [], created_at: new Date().toISOString() },
        ]}
        isPro={true}
      />
    )
    expect(screen.getByText(/Save current tabs as a session/i)).toBeInTheDocument()
    expect(screen.getByText(/Needs the extension/i)).toBeInTheDocument()
  })

  it('still renders the trailing "+" card when there are zero sessions', () => {
    render(<SessionList sessions={[]} isPro={true} />)
    expect(screen.getByText(/Save current tabs as a session/i)).toBeInTheDocument()
  })
})
