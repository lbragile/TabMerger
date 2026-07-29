import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ChangelogPage from '@/app/(marketing)/changelog/page'

describe('ChangelogPage', () => {
  it('renders anchor ids derived from version numbers', () => {
    render(<ChangelogPage />)
    expect(document.getElementById('v2-1-0')).toBeInTheDocument()
    expect(document.getElementById('v2-0-1')).toBeInTheDocument()
    expect(document.getElementById('v2-0-0')).toBeInTheDocument()
  })

  it('renders heading links pointing to the matching anchor id', () => {
    render(<ChangelogPage />)
    const link = screen.getByRole('link', { name: 'v2.1.0' })
    expect(link).toHaveAttribute('href', '#v2-1-0')
  })

  it('shows the "Major release" badge only for vX.0.0 entries', () => {
    render(<ChangelogPage />)
    expect(screen.getAllByText('Major release')).toHaveLength(1)
    const majorEntry = document.getElementById('v2-0-0')
    expect(majorEntry).not.toBeNull()
    expect(majorEntry?.className).toContain('bg-surface2')

    const minorEntry = document.getElementById('v2-1-0')
    expect(minorEntry?.className).not.toContain('bg-surface2')
    const patchEntry = document.getElementById('v2-0-1')
    expect(patchEntry?.className).not.toContain('bg-surface2')
  })

  it('renders change-type badges with correct text content', () => {
    render(<ChangelogPage />)
    expect(screen.getAllByText('New').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Improved').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Fixed').length).toBeGreaterThan(0)
  })
})
