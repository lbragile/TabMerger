import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import TermsPage from '@/app/(marketing)/terms/page'

const SECTION_IDS = [
  'description',
  'accounts',
  'billing',
  'acceptable-use',
  'ip',
  'privacy',
  'warranties',
  'liability',
  'law',
  'changes',
  'termination',
  'contact',
]

describe('TermsPage', () => {
  it('renders all 12 sections with matching ids', () => {
    render(<TermsPage />)
    SECTION_IDS.forEach((id) => {
      const el = document.getElementById(id)
      expect(el).toBeInTheDocument()
      expect(el?.tagName.toLowerCase()).toBe('section')
    })
  })

  it('renders a sticky, lg-only TOC nav with links matching every section id', () => {
    render(<TermsPage />)
    const nav = document.querySelector('nav')
    expect(nav).toBeInTheDocument()
    expect(nav?.className).toContain('hidden')
    expect(nav?.className).toContain('lg:flex')

    const links = nav?.querySelectorAll('a') ?? []
    expect(links.length).toBe(SECTION_IDS.length)
    const hrefs = Array.from(links).map((a) => a.getAttribute('href'))
    SECTION_IDS.forEach((id) => {
      expect(hrefs).toContain(`#${id}`)
    })
  })

  it('gives the billing section distinguishing classes', () => {
    render(<TermsPage />)
    const billing = document.getElementById('billing')
    expect(billing?.className).toContain('bg-accent')
    expect(billing?.className).toContain('border')
    expect(billing?.className).toContain('border-primary/20')
  })

  it('does not apply the billing distinguishing classes to other sections', () => {
    render(<TermsPage />)
    const accounts = document.getElementById('accounts')
    expect(accounts?.className).not.toContain('bg-accent')
  })

  it('gives the billing TOC link distinguishing text styling not shared by other links', () => {
    render(<TermsPage />)
    const nav = document.querySelector('nav')
    const billingLink = Array.from(nav?.querySelectorAll('a') ?? []).find(
      (a) => a.getAttribute('href') === '#billing'
    )
    expect(billingLink?.className).toContain('text-primary')
    expect(billingLink?.className).toContain('font-medium')

    const otherLink = Array.from(nav?.querySelectorAll('a') ?? []).find(
      (a) => a.getAttribute('href') === '#accounts'
    )
    expect(otherLink?.className).not.toContain('font-medium')
  })
})
