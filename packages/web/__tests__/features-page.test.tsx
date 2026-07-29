import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import FeaturesPage from '@/app/(marketing)/features/page'

describe('FeaturesPage', () => {
  it('wraps the Pro AI section cards in a styled surface2 container', () => {
    render(<FeaturesPage />)

    const aiHeading = screen.getByRole('heading', { name: 'AI-powered organization' })
    const aiSection = aiHeading.closest('div')?.parentElement as HTMLElement
    const wrapper = aiSection.querySelector('.bg-surface2')
    expect(wrapper).not.toBeNull()
    expect(wrapper?.className).toMatch(/rounded-2xl/)
    expect(wrapper?.className).toMatch(/border border-border/)
    expect(wrapper?.className).toMatch(/p-8/)
  })

  it('does not wrap the Core and Pro sections in the surface2 container', () => {
    render(<FeaturesPage />)

    const coreHeading = screen.getByRole('heading', { name: 'Powerful tab management' })
    const coreSection = coreHeading.closest('div')?.parentElement as HTMLElement
    expect(coreSection.querySelector('.bg-surface2')).toBeNull()

    const proHeading = screen.getByRole('heading', { name: 'Sync & sessions' })
    const proSection = proHeading.closest('div')?.parentElement as HTMLElement
    expect(proSection.querySelector('.bg-surface2')).toBeNull()
  })

  it('restarts row numbering at "01" for each of the three tier sections', () => {
    render(<FeaturesPage />)

    const coreFirst = screen.getByText('Named & color-coded groups')
    const proFirst = screen.getByText('Cloud sync')
    const aiFirst = screen.getByText('Auto-grouping')

    expect(coreFirst.closest('div.grid')?.textContent).toContain('01')
    expect(proFirst.closest('div.grid')?.textContent).toContain('01')
    expect(aiFirst.closest('div.grid')?.textContent).toContain('01')

    const coreSecond = screen.getByText('Full-text search')
    expect(coreSecond.closest('div.grid')?.textContent).toContain('02')
  })
})
