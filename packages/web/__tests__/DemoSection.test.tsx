import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import { DemoSection } from '@/components/marketing/DemoSection'

describe('DemoSection', () => {
  it('renders all four group buttons in the sidebar', () => {
    render(<DemoSection />)
    // getByRole is the top-priority query — buttons are interactive elements
    expect(screen.getByRole('button', { name: /Work/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Research/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Shopping/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Entertainment/i })).toBeInTheDocument()
  })

  it('shows Work tabs by default', () => {
    render(<DemoSection />)
    // getByText for non-interactive content inside the tab list
    expect(screen.getByText('Linear — Project Board')).toBeInTheDocument()
    expect(screen.getByText('GitHub — Pull Requests')).toBeInTheDocument()
  })

  it('switches tab list when a group button is clicked', async () => {
    const user = userEvent.setup()
    render(<DemoSection />)

    await user.click(screen.getByRole('button', { name: /Research/i }))

    expect(screen.getByText('MDN — CSS Grid Guide')).toBeInTheDocument()
    expect(screen.queryByText('Linear — Project Board')).not.toBeInTheDocument()
  })

  it('dims non-matching tabs via the search input (global search mode)', async () => {
    // Non-matching tabs stay in the DOM but get opacity:0.3 — the component uses
    // global search (shows all groups) and dims rather than hides mismatches.
    const user = userEvent.setup()
    render(<DemoSection />)

    // getByRole — <input type="text"> has implicit role="textbox"
    await user.type(screen.getByRole('textbox'), 'git')

    // Matching tab row is at full opacity (no explicit opacity or opacity:1)
    const matchRow = screen.getByText('GitHub — Pull Requests').closest('div')
    expect(matchRow?.style.opacity).not.toBe('0.3')

    // Non-matching tab row is dimmed
    const dimmedRow = screen.getByText('Linear — Project Board').closest('div')
    expect(dimmedRow?.style.opacity).toBe('0.3')
  })

  it('restores full opacity when search is cleared', async () => {
    const user = userEvent.setup()
    render(<DemoSection />)

    const searchInput = screen.getByRole('textbox')
    await user.type(searchInput, 'git')
    await user.clear(searchInput)

    // After clear, no global search — active group tabs are at full opacity
    const linearRow = screen.getByText('Linear — Project Board').closest('div')
    expect(linearRow?.style.opacity).not.toBe('0.3')
  })

  it('dims all tabs when search matches nothing', async () => {
    const user = userEvent.setup()
    render(<DemoSection />)

    await user.type(screen.getByRole('textbox'), 'zzznomatch')

    // All tab rows should be dimmed — no empty-state element, tabs are never removed
    const linearRow = screen.getByText('Linear — Project Board').closest('div')
    expect(linearRow?.style.opacity).toBe('0.3')
  })

  it('clears search when switching groups', async () => {
    const user = userEvent.setup()
    render(<DemoSection />)

    const searchInput = screen.getByRole('textbox')
    await user.type(searchInput, 'linear')
    await user.click(screen.getByRole('button', { name: /Research/i }))

    expect(searchInput).toHaveValue('')
  })
})
