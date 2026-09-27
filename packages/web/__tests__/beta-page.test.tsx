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

  it('links the bug report button to a prefilled GitHub Discussions Q&A post', () => {
    render(<BetaPage />)
    const bugLink = screen.getByRole('link', { name: /report a bug on github/i })
    const href = bugLink.getAttribute('href') ?? ''
    expect(href).toMatch(/^https:\/\/github\.com\/lbragile\/TabMerger\/discussions\/new\?/)
    expect(href).toMatch(/category=q-a/)
    expect(decodeURIComponent(href.replace(/\+/g, '%20'))).toMatch(/Steps to reproduce/)
    expect(bugLink).toHaveAttribute('target', '_blank')
    expect(bugLink).toHaveAttribute('rel', 'noreferrer')
  })

  it('links the idea button to a prefilled GitHub Discussions Ideas post', () => {
    render(<BetaPage />)
    const ideaLink = screen.getByRole('link', { name: /share an idea on github/i })
    const href = ideaLink.getAttribute('href') ?? ''
    expect(href).toMatch(/^https:\/\/github\.com\/lbragile\/TabMerger\/discussions\/new\?/)
    expect(href).toMatch(/category=ideas/)
  })

  it('shows the plain GitHub Discussions link so testers can browse existing reports', () => {
    render(<BetaPage />)
    const discussionsLink = screen.getByRole('link', { name: /github\.com\/lbragile\/TabMerger\/discussions/i })
    expect(discussionsLink).toHaveAttribute('href', 'https://github.com/lbragile/TabMerger/discussions')
  })

  it('offers the contact form as a fallback for testers without a GitHub account', () => {
    render(<BetaPage />)
    const fallbackLinks = screen.getAllByRole('link', { name: /no github account\? use the contact form/i })
    expect(fallbackLinks.length).toBeGreaterThanOrEqual(2)
    const hrefs = fallbackLinks.map((l) => l.getAttribute('href'))
    expect(hrefs).toContain('/contact?topic=beta')
    expect(hrefs).toContain('/contact?topic=feedback')
  })

  it('warns that GitHub Discussions are public', () => {
    render(<BetaPage />)
    expect(document.body.textContent).toMatch(/discussions are public/i)
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
    const pre = Array.from(document.querySelectorAll('pre')).find((el) =>
      (el.textContent ?? '').includes('Steps to reproduce:')
    )
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

  it('renders test steps as ordered lists', () => {
    render(<BetaPage />)
    const orderedLists = document.querySelectorAll('#what-to-test ol')
    expect(orderedLists.length).toBeGreaterThan(0)
    // Every test-item steps list should have at least one <li>
    const firstList = orderedLists[0]
    expect(firstList.querySelectorAll('li').length).toBeGreaterThan(0)
  })

  it('renders at least one screenshot with meaningful alt text', () => {
    render(<BetaPage />)
    const images = Array.from(document.querySelectorAll('#what-to-test img'))
    expect(images.length).toBeGreaterThan(0)
    const withAlt = images.filter((img) => (img.getAttribute('alt') ?? '').trim().length > 0)
    expect(withAlt.length).toBeGreaterThan(0)
  })

  it('shows the "Not enabled" hover-preview example matching the real component copy', () => {
    render(<BetaPage />)
    expect(document.body.textContent).toMatch(/Not enabled/)
    expect(document.body.textContent).toMatch(/Page images are off\./)
    expect(document.body.textContent).toMatch(/Turn on in Settings\./)
  })

  it('shows the "Save to TabMerger" right-click menu example', () => {
    render(<BetaPage />)
    expect(document.body.textContent).toMatch(/Save to TabMerger/)
  })
})
