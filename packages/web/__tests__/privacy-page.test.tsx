import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PrivacyPage from '@/app/(marketing)/privacy/page'

const SECTION_IDS = [
  'what-we-collect',
  'page-previews',
  'how-stored',
  'third-party',
  'retention',
  'your-rights',
  'cookies',
  'children',
  'changes',
  'contact',
]

describe('PrivacyPage', () => {
  it('renders all 10 sections with matching ids', () => {
    render(<PrivacyPage />)
    SECTION_IDS.forEach((id) => {
      const el = document.getElementById(id)
      expect(el).toBeInTheDocument()
      expect(el?.tagName.toLowerCase()).toBe('section')
    })
  })

  it('renders a sticky, lg-only TOC nav with links matching every section id', () => {
    render(<PrivacyPage />)
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

  it('uses the bg-accent callout header style', () => {
    render(<PrivacyPage />)
    const heading = screen.getByRole('heading', { name: 'Privacy, in plain English' })
    const header = heading.closest('div')
    expect(header?.className).toContain('bg-accent')
  })

  it('renders the Page previews section explaining the opt-in preview service', () => {
    render(<PrivacyPage />)
    const section = document.getElementById('page-previews')
    expect(section).toBeInTheDocument()
    expect(section?.textContent).toMatch(/off by default/i)
    expect(section?.textContent).toMatch(/preview service/i)
  })

  it('never claims tab data "never leaves your device"', () => {
    render(<PrivacyPage />)
    expect(document.body.textContent).not.toMatch(/never leaves your device/i)
  })

  it('lists Vercel as a third-party processor with its privacy policy link', () => {
    render(<PrivacyPage />)
    const link = screen.getByRole('link', { name: 'Vercel' })
    expect(link).toHaveAttribute('href', 'https://vercel.com/legal/privacy-policy')
  })
})
