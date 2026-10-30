import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import PrivacyPage from '@/app/[locale]/(marketing)/privacy/page'
import { SUPPORT_EMAIL } from '@/lib/supportInbox'
import { isCookieSettingsOpen, resetConsentStateForTests } from '@/lib/consent'
import userEvent from '@testing-library/user-event'

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

  // The extension names the own-key provider "Gemini", so the policy shows that name next to the
  // company (Google) that receives the request.
  it('names Gemini, with Google as the company, wherever an own key can go to Google', () => {
    render(<PrivacyPage />)
    expect(document.body.textContent).toContain('the provider that issued your key: Anthropic, OpenAI or Google (Gemini).')
    const table = document.getElementById('third-party')?.textContent ?? ''
    expect(table).toContain('Google AI (Gemini API)')
    expect(table).toContain('who use their own Gemini API key')
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
    expect(document.getElementById('cookie-choice')?.textContent).toMatch(/tm_consent.*granted or denied.*lasts one year/)
  })

  describe('cookie consent', () => {
    afterEach(() => resetConsentStateForTests())

    it('says which regions are asked first, and that nothing loads there before Accept', () => {
      render(<PrivacyPage />)
      const askFirst = document.getElementById('consent-ask-first')?.textContent ?? ''
      expect(askFirst).toMatch(/European Economic Area \(the EU, Norway, Iceland and Liechtenstein\), the United Kingdom/)
      expect(askFirst).toMatch(/Switzerland and Quebec, and whenever we can.t tell where you are/)
      expect(askFirst).toMatch(/nothing is loaded before you answer: Google Analytics and PostHog don.t run, set no cookies and record nothing until you press Accept/)
      expect(askFirst).toMatch(/Accept and Reject are equal choices/)
    })

    it('says analytics are on by default elsewhere, with Reject in Cookie settings', () => {
      render(<PrivacyPage />)
      const elsewhere = document.getElementById('consent-on-by-default')?.textContent ?? ''
      expect(elsewhere).toMatch(/On by default everywhere else\. No banner appears/)
      expect(elsewhere).toMatch(/including session replay/)
      expect(elsewhere).toMatch(/Reject in Cookie settings/)
    })

    it('says Global Privacy Control counts as a Reject everywhere until an explicit Accept', () => {
      render(<PrivacyPage />)
      const gpc = document.getElementById('consent-gpc')?.textContent ?? ''
      expect(gpc).toMatch(/Global Privacy Control signal, we treat it as a Reject wherever you are/)
      expect(gpc).toMatch(/only if you press Accept in Cookie settings yourself/)
    })

    it('says what Reject does straight away, and what the cookie entries hold', () => {
      render(<PrivacyPage />)
      const consent = document.getElementById('cookie-consent')?.textContent ?? ''
      expect(consent).toMatch(/after Reject, Google Analytics stops sending, PostHog stops capturing and recording/)
      expect(consent).toMatch(/the analytics cookies set earlier are deleted/)
      expect(document.getElementById('cookie-analytics')?.textContent).toMatch(/only while analytics are on for you/)
      expect(document.getElementById('cookie-choice')?.textContent).toMatch(/set only when you press Accept or Reject/)
      // The old "basic measurements before you choose" behaviour is gone.
      expect(document.body.textContent).not.toMatch(/basic measurements/)
      expect(document.body.textContent).not.toMatch(/temporary identifier kept only in the open page/)
    })

    it('lists the strictly necessary, day-long tm_consent_region cookie', () => {
      render(<PrivacyPage />)
      const region = document.getElementById('cookie-region')?.textContent ?? ''
      expect(region).toMatch(/tm_consent_region/)
      expect(region).toMatch(/strictly necessary, holds only optin \(ask first\) or optout \(on by default\), never your country or IP address, and lasts one day/)
    })

    it('describes session replay plainly: what it records, masking, private pages, when it runs and how to stop it', () => {
      render(<PrivacyPage />)
      const replay = document.getElementById('session-replay')?.textContent ?? ''
      expect(replay).toMatch(/your clicks, scrolling and mouse movements/)
      expect(replay).toMatch(/Everything you type into a form field, such as an email address or a password, is masked in your browser/)
      expect(replay).toMatch(/Your dashboard and the tabs on a shared link.s page are left out of recordings/)
      expect(replay).toMatch(/\(its decryption key\) is removed from the addresses PostHog receives/)
      expect(replay).toMatch(/never before you accept in the regions above, never after you reject, and never while your browser sends Global Privacy Control/)
      expect(replay).toMatch(/press Reject in Cookie settings; it stops straight away/)
      expect(document.querySelector('#what-we-collect a[href="#session-replay"]')).toBeInTheDocument()
    })

    it('keeps the processor table in line with the region split', () => {
      render(<PrivacyPage />)
      const table = document.getElementById('third-party')?.textContent ?? ''
      expect(table).toMatch(/Google Analytics.*Asks first in the EEA, the UK, Switzerland and Quebec; on by default elsewhere until you reject/)
      expect(table).toMatch(/PostHog.*session replay on the website, with every form input masked/)
      expect(table).not.toMatch(/only if you accept them/)
    })

    it('still says we cannot read synced group or tab data', () => {
      render(<PrivacyPage />)
      expect(document.getElementById('what-we-collect')?.textContent).toMatch(/we cannot read your stored or synced group or tab data/)
    })

    it('explains how to change the choice, with a working Cookie settings button', async () => {
      render(<PrivacyPage />)
      const consent = document.getElementById('cookie-consent') as HTMLElement
      expect(consent.textContent).toMatch(/Cookie settings at the bottom of every page/)
      expect(isCookieSettingsOpen()).toBe(false)
      await userEvent.click(within(consent).getByRole('button', { name: 'Cookie settings' }))
      expect(isCookieSettingsOpen()).toBe(true)
    })
  })

  it('shows the date of the latest revision', () => {
    render(<PrivacyPage />)
    expect(screen.getByText('Last updated: October 29, 2026')).toBeInTheDocument()
  })

  it('discloses the AI abuse limits: per account and IP, IP never stored as is, deleted within days', () => {
    render(<PrivacyPage />)
    const collect = document.getElementById('what-we-collect')?.textContent ?? ''
    expect(collect).toMatch(/Abuse limits\. .*from each account and from each IP address/)
    expect(collect).toMatch(/We never store your IP address itself: we keep only a one-way code made from it with a secret key/)
    expect(collect).toMatch(/deleted automatically within about three days/)
    expect(document.getElementById('retention')?.textContent).toMatch(/AI request counts used for abuse limits .* are deleted automatically within about three days/)
  })

  it('discloses the extension usage events: install, update, daily, random install id, Firefox opt-in', () => {
    render(<PrivacyPage />)
    const text = document.body.textContent ?? ''
    expect(text).toMatch(/when it is installed or updated, about once a day while it stays installed/)
    expect(text).toMatch(/version and browser, whether it is the regular or the beta release, and simple counts or labels/)
    expect(text).toMatch(/random install identifier/)
    expect(text).toMatch(/On Firefox, nothing is sent unless you allowed/)
  })
})
