import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import PrivacyPage from '@/app/[locale]/(marketing)/privacy/page'
import { SUPPORT_EMAIL } from '@/lib/supportInbox'

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

  it('names the support address in the Contact section', () => {
    render(<PrivacyPage />)
    const contact = document.getElementById('contact') as HTMLElement
    expect(within(contact).getByRole('link', { name: SUPPORT_EMAIL })).toHaveAttribute('href', `mailto:${SUPPORT_EMAIL}`)
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

  it('discloses the favicon lookup: which service, what is sent and what is not', () => {
    render(<PrivacyPage />)
    const block = document.getElementById('site-icons')
    expect(block).toBeInTheDocument()
    expect(block?.textContent).toMatch(/Google.s favicon service/)
    expect(block?.textContent).toMatch(/that site.s domain/)
    expect(block?.textContent).toMatch(/never the full page address/)
    expect(block?.textContent).toMatch(/never passes through our servers/)
    // linked from the tab data paragraph, repeated in the storage table and listed as a processor
    expect(document.querySelector('#what-we-collect a[href="#site-icons"]')).toBeInTheDocument()
    expect(document.getElementById('how-stored')?.textContent).toMatch(/Google.s favicon service/)
    expect(document.getElementById('third-party')?.textContent).toMatch(/Google favicon service/)
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
  it('discloses the uninstall survey: what opening it sends, what the form sends, and where it goes', () => {
    render(<PrivacyPage />)
    const block = document.getElementById('uninstall-survey')
    expect(block?.textContent).toMatch(/version, which browser it was for, whether it was the regular or the beta release, and whether the extension was allowed to send anonymous usage statistics/)
    expect(block?.textContent).toMatch(/one anonymous "extension removed" count in Google Analytics/)
    expect(block?.textContent).toMatch(/Only if you press send/)
    expect(block?.textContent).toMatch(/emailed to our support inbox through Resend/)
    expect(block?.textContent).toMatch(/never your IP address/)
    expect(screen.getByRole('link', { name: 'Resend' })).toHaveAttribute('href', 'https://resend.com/legal/privacy-policy')
  })

  it('lists every cookie the site sets, including the year-long language cookie', () => {
    render(<PrivacyPage />)
    const cookies = document.getElementById('cookies') as HTMLElement
    expect(cookies.textContent).not.toMatch(/solely for session management/)
    expect(document.getElementById('cookie-sign-in')?.textContent).toMatch(/Supabase Auth/)
    expect(document.getElementById('cookie-language')?.textContent).toMatch(/NEXT_LOCALE.*lasts one year/)
    expect(document.getElementById('cookie-analytics')?.textContent).toMatch(/Google Analytics sets _ga cookies/)
    expect(document.getElementById('cookie-analytics')?.textContent).toMatch(/PostHog/)
  })

  it('shows the date of the latest revision', () => {
    render(<PrivacyPage />)
    expect(screen.getByText('Last updated: October 18, 2026')).toBeInTheDocument()
  })

  it('discloses the extension usage events: install, update, daily, random install id, Firefox opt-in', () => {
    render(<PrivacyPage />)
    const text = document.body.textContent ?? ''
    expect(text).toMatch(/when it is installed or updated, about once a day while it stays installed/)
    expect(text).toMatch(/random install identifier/)
    expect(text).toMatch(/On Firefox, nothing is sent unless you allowed/)
  })
})
