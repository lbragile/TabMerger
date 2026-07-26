import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { DemoSection } from '@/components/marketing/DemoSection'

describe('DemoSection', () => {
  it('renders the sidebar with all seed groups', () => {
    render(<DemoSection />)
    expect(screen.getByText('Now Open')).toBeInTheDocument()
    expect(screen.getByText('Work')).toBeInTheDocument()
    expect(screen.getByText('Research')).toBeInTheDocument()
    expect(screen.getByText('Shopping')).toBeInTheDocument()
  })

  it('defaults to the "Work" group as active and shows its windows', () => {
    render(<DemoSection />)
    expect(screen.getByText('GitHub — Pull Requests')).toBeInTheDocument()
  })

  it('switches active group on sidebar click', () => {
    render(<DemoSection />)
    fireEvent.click(screen.getByText('Research'))
    expect(screen.getByText('MDN — CSS Grid Guide')).toBeInTheDocument()
  })

  it('adds a new group when the add-group button is clicked', () => {
    render(<DemoSection />)
    const groupCountBefore = screen.getAllByRole('button', { name: /add group/i })
    fireEvent.click(screen.getByTitle('Add group'))
    expect(screen.getByDisplayValue(/new group/i)).toBeInTheDocument() // new group auto-enters rename, matching real popup's handleNewGroup
  })

  it('deletes a tab when its close button is clicked', () => {
    render(<DemoSection />)
    const row = screen.getByText('GitHub — Pull Requests').closest('div.group')!
    fireEvent.click(within(row as HTMLElement).getByTitle('Close tab'))
    expect(screen.queryByText('GitHub — Pull Requests')).not.toBeInTheDocument()
  })

  it('renders the real DemoHeader instead of macOS window chrome', () => {
    const { container } = render(<DemoSection />)
    expect(container.querySelector('.bg-red-400')).not.toBeInTheDocument()
  })
})
