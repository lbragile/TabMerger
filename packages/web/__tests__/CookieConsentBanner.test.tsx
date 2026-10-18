import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import de from '@/messages/de'
import { CookieConsentBanner } from '@/components/consent/CookieConsentBanner'
import { ConsentedGoogleAnalytics } from '@/components/consent/ConsentedGoogleAnalytics'
import { PostHogProvider } from '@/components/posthog-provider'
import { Footer } from '@/components/layout/Footer'
import { GTAG_SCRIPT_ID } from '@/lib/analytics'
import { resetConsentStateForTests } from '@/lib/consent'

const posthog = vi.hoisted(() => {
  const fake = {
    __loaded: false,
    init: vi.fn(() => {
      fake.__loaded = true
    }),
    register: vi.fn(),
    set_config: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    has_opted_out_capturing: vi.fn(() => false),
    startSessionRecording: vi.fn(),
    stopSessionRecording: vi.fn(),
  }
  return fake
})
vi.mock('posthog-js', () => ({ default: posthog }))

const GA_ID = 'G-TEST12345'

function clearCookies() {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`
  }
}

/** The consent commands queued for gtag.js. */
function consentCommands(): unknown[][] {
  return (window.dataLayer ?? [])
    .map((entry) => Array.from(entry as ArrayLike<unknown>))
    .filter((command) => command[0] === 'consent')
}

const banner = () => screen.queryByRole('region', { name: 'Cookie consent' })

/** The banner plus both analytics loaders, as the root layout mounts them. */
async function renderWithAnalytics() {
  const result = render(
    <>
      <CookieConsentBanner />
      <ConsentedGoogleAnalytics gaId={GA_ID} />
      <PostHogProvider />
    </>
  )
  await waitFor(() => expect(posthog.init).toHaveBeenCalled())
  return result
}

beforeEach(() => {
  posthog.__loaded = false
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test_key')
  delete window.gtag
  delete window.dataLayer
  document.getElementById(GTAG_SCRIPT_ID)?.remove()
})

afterEach(() => {
  clearCookies()
  resetConsentStateForTests()
  vi.unstubAllEnvs()
})

describe('CookieConsentBanner', () => {
  it('asks a visitor who has not chosen yet, without taking focus', () => {
    render(<CookieConsentBanner />)
    const region = banner()!
    expect(region).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Accept' })).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Reject' })).toBeInTheDocument()
    expect(within(region).getByRole('link', { name: 'Cookie details' })).toHaveAttribute('href', '/privacy#cookies')
    expect(document.activeElement).toBe(document.body)
  })

  it('gives Accept and Reject exactly the same look', () => {
    render(<CookieConsentBanner />)
    expect(screen.getByRole('button', { name: 'Accept' }).className).toBe(screen.getByRole('button', { name: 'Reject' }).className)
  })

  it('is fixed to the bottom of the viewport, so it shifts no content', () => {
    render(<CookieConsentBanner />)
    expect(banner()!.className).toMatch(/\bfixed\b/)
    expect(banner()!.className).toMatch(/\bbottom-0\b/)
  })

  it.each(['granted', 'denied'])('stays hidden once the visitor has chosen (%s)', (value) => {
    document.cookie = `tm_consent=${value}; Path=/`
    render(<CookieConsentBanner />)
    expect(banner()).toBeNull()
  })

  it.each(['yes', 'GRANTED', 'granted%20', '%E0%A4%A', '1'])('asks again when the stored value is invalid (%s)', (value) => {
    document.cookie = `tm_consent=${value}; Path=/`
    render(<CookieConsentBanner />)
    expect(banner()).toBeInTheDocument()
  })

  it('Accept stores the choice, hides the banner and turns on GA cookies and PostHog persistence + recording', async () => {
    await renderWithAnalytics()
    expect(posthog.init).toHaveBeenCalledWith('phc_test_key', expect.objectContaining({ persistence: 'memory', disable_session_recording: true }))
    expect(consentCommands()).toHaveLength(1) // the denied default only

    await userEvent.click(screen.getByRole('button', { name: 'Accept' }))

    expect(document.cookie).toContain('tm_consent=granted')
    expect(banner()).toBeNull()
    expect(consentCommands().at(-1)).toEqual(['consent', 'update', { analytics_storage: 'granted' }])
    expect(posthog.set_config).toHaveBeenCalledWith({ persistence: 'localStorage+cookie', disable_persistence: false })
    expect(posthog.startSessionRecording).toHaveBeenCalled()
  })

  it('Reject stores the choice, hides the banner, denies GA cookies and stops PostHog', async () => {
    await renderWithAnalytics()
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }))

    expect(document.cookie).toContain('tm_consent=denied')
    expect(banner()).toBeNull()
    expect(consentCommands().at(-1)).toEqual(['consent', 'update', { analytics_storage: 'denied' }])
    expect(posthog.opt_out_capturing).toHaveBeenCalled()
    expect(posthog.stopSessionRecording).toHaveBeenCalled()
    expect(posthog.startSessionRecording).not.toHaveBeenCalled()
  })

  it('"Cookie settings" in the footer reopens it, moves focus in, and a new choice takes effect at once', async () => {
    document.cookie = 'tm_consent=granted; Path=/'
    render(
      <>
        <Footer />
        <CookieConsentBanner />
        <ConsentedGoogleAnalytics gaId={GA_ID} />
      </>
    )
    expect(banner()).toBeNull()
    // A stored Accept is applied before GA's config.
    expect(consentCommands().at(-1)).toEqual(['consent', 'update', { analytics_storage: 'granted' }])

    const settings = screen.getByRole('button', { name: 'Cookie settings' })
    await userEvent.click(settings)
    const region = banner()!
    expect(region).toBeInTheDocument()
    expect(document.activeElement).toBe(region)

    await userEvent.click(within(region).getByRole('button', { name: 'Reject' }))
    expect(banner()).toBeNull()
    expect(document.cookie).toContain('tm_consent=denied')
    expect(consentCommands().at(-1)).toEqual(['consent', 'update', { analytics_storage: 'denied' }])
    // Focus goes back to where the visitor was.
    expect(document.activeElement).toBe(settings)
  })

  it('works with the keyboard alone', async () => {
    render(<CookieConsentBanner />)
    const user = userEvent.setup()
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Cookie details' }))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Accept' }))
    await user.tab()
    await user.keyboard('{Enter}')
    expect(document.cookie).toContain('tm_consent=denied')
    expect(banner()).toBeNull()
  })

  it('renders in German', () => {
    render(<CookieConsentBanner />, {
      wrapper: ({ children }) => (
        <NextIntlClientProvider locale="de" messages={de}>
          {children}
        </NextIntlClientProvider>
      ),
    })
    const region = screen.getByRole('region', { name: 'Cookie-Einwilligung' })
    expect(within(region).getByRole('button', { name: 'Akzeptieren' })).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Ablehnen' })).toBeInTheDocument()
    expect(within(region).getByRole('link', { name: 'Details zu Cookies' })).toHaveAttribute('href', '/privacy#cookies')
    expect(region.textContent).toContain('Sie werden nur gesetzt, wenn du zustimmst')
  })

  it('names "Cookie settings" in the footer in German too', () => {
    render(<Footer />, {
      wrapper: ({ children }) => (
        <NextIntlClientProvider locale="de" messages={de}>
          {children}
        </NextIntlClientProvider>
      ),
    })
    expect(screen.getByRole('button', { name: 'Cookie-Einstellungen' })).toBeInTheDocument()
  })
})
