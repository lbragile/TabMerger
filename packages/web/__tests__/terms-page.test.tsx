import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import TermsPage from '@/app/[locale]/(marketing)/terms/page'

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
  it('states when purchased AI credits end, the current way credits reset', () => {
    render(<TermsPage />)
    const text = document.body.textContent ?? ''
    expect(text).toContain(
      "AI credit packs are one-time purchases. You can use purchased credits until your AI credits next reset, which happens when your next billing month starts and its payment has gone through (on annual plans, on the monthly anniversary of your billing date). Unused credits don't carry over."
    )
    expect(text).not.toContain('for use in the month you buy them')
    expect(text).toContain("On an annual plan with more than a month left, that means a full month's credits for each monthly reset left")
    expect(screen.getByText('Last updated: November 1, 2026')).toBeInTheDocument()
  })

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

  it('highlights the first TOC link as active by default (scroll-spy falls back statically in jsdom)', () => {
    render(<TermsPage />)
    const nav = document.querySelector('nav')
    const firstLink = Array.from(nav?.querySelectorAll('a') ?? []).find(
      (a) => a.getAttribute('href') === '#description'
    )
    expect(firstLink?.className).toContain('text-primary')
    expect(firstLink?.className).toContain('font-medium')

    const otherLink = Array.from(nav?.querySelectorAll('a') ?? []).find(
      (a) => a.getAttribute('href') === '#billing'
    )
    expect(otherLink?.className).not.toContain('font-medium')
  })
})
