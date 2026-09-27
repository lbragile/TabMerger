import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import BetaPage from '@/app/(marketing)/beta/page'

describe('BetaPage', () => {
  it('renders the hero with a Join the beta button pointing to the tester Google Group', () => {
    render(<BetaPage />)
    expect(screen.getByRole('heading', { name: /help us test tabmerger/i })).toBeInTheDocument()
    const joinLink = screen.getByRole('link', { name: /join the beta/i })
    expect(joinLink).toHaveAttribute('href', 'https://groups.google.com/g/tabmerger-beta-testers')
    expect(joinLink).toHaveAttribute('target', '_blank')
    expect(joinLink).toHaveAttribute('rel', 'noreferrer')
  })

  it('links bug reports to the contact form with the beta topic preselected', () => {
    render(<BetaPage />)
    const bugLink = screen.getByRole('link', { name: /open a beta bug report/i })
    expect(bugLink).toHaveAttribute('href', '/contact?topic=beta')
  })

  it('links feedback to the contact form with the feedback topic preselected', () => {
    render(<BetaPage />)
    const feedbackLink = screen.getByRole('link', { name: /share feedback and ideas/i })
    expect(feedbackLink).toHaveAttribute('href', '/contact?topic=feedback')
  })

  it('renders the join/install, what-to-test, report-bugs, and FAQ sections', () => {
    render(<BetaPage />)
    expect(document.getElementById('join')).toBeInTheDocument()
    expect(document.getElementById('what-to-test')).toBeInTheDocument()
    expect(document.getElementById('report-bugs')).toBeInTheDocument()
    expect(document.getElementById('faq')).toBeInTheDocument()
  })

  it('renders a copyable bug report template with all required fields', () => {
    render(<BetaPage />)
    const pre = document.querySelector('pre')
    expect(pre).toBeInTheDocument()
    expect(pre?.textContent).toMatch(/Summary:/)
    expect(pre?.textContent).toMatch(/Steps to reproduce:/)
    expect(pre?.textContent).toMatch(/Expected:/)
    expect(pre?.textContent).toMatch(/Actual:/)
    expect(pre?.textContent).toMatch(/Beta version/)
    expect(pre?.textContent).toMatch(/Browser and OS:/)
    expect(pre?.textContent).toMatch(/Signed in:/)
    expect(pre?.textContent).toMatch(/Screenshots or screen recording:/)
  })

  it('does not list AI features as testable', () => {
    render(<BetaPage />)
    expect(document.body.textContent).not.toMatch(/auto-group/i)
    expect(document.body.textContent).toMatch(/hidden \("coming soon"\)/i)
  })

  it('tells testers not to try billing/upgrading from the beta', () => {
    render(<BetaPage />)
    expect(document.body.textContent).toMatch(/billing isn't part of this beta/i)
  })

  it('answers the "Item not found" FAQ', () => {
    render(<BetaPage />)
    expect(screen.getByRole('heading', { name: /item not found/i })).toBeInTheDocument()
  })
})
