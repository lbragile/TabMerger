import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import de from '@/messages/de'
import { CookieConsentBanner, WIDE_VIEWPORT_QUERY } from '@/components/consent/CookieConsentBanner'
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

// The banner waits for a scroll on the home page only; every test is on another page unless it
// sets `nav.pathname = '/'` (the shared mock always answers '/').
const nav = vi.hoisted(() => ({ pathname: '/pricing' }))
vi.mock('@/i18n/navigation', async () => ({
  ...(await import('./helpers/intl')).createNavigationMock((await import('next/link')).default),
  usePathname: () => nav.pathname,
}))

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
const chip = () => screen.queryByRole('button', { name: 'Cookie choices' })

/**
 * jsdom has no `matchMedia`, which the banner reads as the wide layout. This stands in for it:
 * `wide` answers the banner's breakpoint query, and `resize()` flips it like a rotated phone.
 */
function mockViewport(wide: boolean) {
  const listeners = new Set<() => void>()
  const query = { matches: wide }
  vi.stubGlobal(
    'matchMedia',
    vi.fn((media: string) => ({
      get matches() {
        return media === WIDE_VIEWPORT_QUERY ? query.matches : false
      },
      media,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }))
  )
  return {
    resize(nextWide: boolean) {
      query.matches = nextWide
      act(() => listeners.forEach((listener) => listener()))
    },
  }
}

/** Puts the page at `y` pixels down (jsdom's viewport is 768px tall) and fires a scroll event. */
function scrollTo(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true })
  act(() => {
    window.dispatchEvent(new Event('scroll'))
  })
}

/** The banner plus both analytics loaders, as the root layout mounts them. */
function renderWithAnalytics() {
  return render(
    <>
      <CookieConsentBanner />
      <ConsentedGoogleAnalytics gaId={GA_ID} />
      <PostHogProvider />
    </>
  )
}

/** Lets the on-demand `import('posthog-js')` settle, so "PostHog was not started" means something. */
const settle = () =>
  act(async () => {
    await import('posthog-js')
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

/** Sets `navigator.globalPrivacyControl` for one test (undone in afterEach). */
function setGpc(value: boolean | undefined) {
  if (value === undefined) delete (navigator as unknown as Record<string, unknown>).globalPrivacyControl
  else Object.defineProperty(navigator, 'globalPrivacyControl', { value, configurable: true })
}

const setRegion = (region: 'optin' | 'optout') => {
  document.cookie = `tm_consent_region=${region}; Path=/`
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
  vi.unstubAllGlobals()
  nav.pathname = '/pricing'
  setGpc(undefined)
  delete (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`]
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true })
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

  it('is a card fixed to the bottom-left corner, away from the toasts (bottom-right), so it shifts no content', () => {
    mockViewport(true)
    render(<CookieConsentBanner />)
    const corner = banner()!.parentElement!
    expect(corner.className.split(/\s+/)).toContain('fixed')
    expect(corner.className).toContain('sm:ltr:left-[max(1.5rem,env(safe-area-inset-left))]')
    expect(corner.className).toContain('sm:bottom-[max(1.5rem,env(safe-area-inset-bottom))]')
    expect(corner.className).toContain('sm:ltr:right-auto')
    // Right to left the card takes the bottom-right corner, and the toasts move to the left.
    expect(corner.className).toContain('sm:rtl:right-[max(1.5rem,env(safe-area-inset-right))]')
    expect(corner.className).toContain('sm:rtl:left-auto')
    expect(corner.className).not.toMatch(/inset-x-0|right-0/)
    expect(banner()!.className).toContain('max-w-[22rem]')
    // The full card from the start: no chip, nothing to collapse.
    expect(chip()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Hide cookie choices' })).toBeNull()
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

  it('loads no analytics at all before a choice (opt-in), then Accept loads GA and starts PostHog with recording', async () => {
    renderWithAnalytics()
    await settle()
    expect(document.getElementById(GTAG_SCRIPT_ID)).toBeNull()
    expect(window.gtag).toBeUndefined()
    expect(posthog.init).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Accept' }))

    expect(document.cookie).toContain('tm_consent=granted')
    expect(banner()).toBeNull()
    expect(document.getElementById(GTAG_SCRIPT_ID)).toBeInTheDocument()
    expect(consentCommands().at(-1)).toEqual(['consent', 'update', { analytics_storage: 'granted' }])
    await waitFor(() =>
      expect(posthog.init).toHaveBeenCalledWith(
        'phc_test_key',
        expect.objectContaining({ persistence: 'localStorage+cookie', disable_session_recording: false })
      )
    )
  })

  it('Reject stores the choice, hides the banner and still loads nothing', async () => {
    renderWithAnalytics()
    await settle()
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await settle()

    expect(document.cookie).toContain('tm_consent=denied')
    expect(banner()).toBeNull()
    expect(document.getElementById(GTAG_SCRIPT_ID)).toBeNull()
    expect(posthog.init).not.toHaveBeenCalled()
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

describe('CookieConsentBanner on a phone', () => {
  beforeEach(() => {
    mockViewport(false)
  })

  it('starts as a "Cookie choices" chip with no Accept or Reject to nudge with', () => {
    render(<CookieConsentBanner />)
    const toggle = chip()!
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    // The chip controls the (hidden) card.
    const card = document.getElementById(toggle.getAttribute('aria-controls')!)!
    expect(card).toHaveAttribute('aria-label', 'Cookie consent')
    expect(card).not.toBeVisible()
    // The chip is the only control on offer, and it holds only its label.
    expect(screen.getAllByRole('button')).toEqual([toggle])
    expect(toggle).toHaveTextContent(/^Cookie choices$/)
    expect(screen.queryByRole('link', { name: 'Cookie details' })).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  it('expands to the card on tap, with focus in it, then collapses back to the chip with focus on it', async () => {
    const user = userEvent.setup()
    render(<CookieConsentBanner />)
    await user.click(chip()!)

    const region = banner()!
    expect(chip()).toBeNull()
    expect(document.activeElement).toBe(region)
    const accept = within(region).getByRole('button', { name: 'Accept' })
    const reject = within(region).getByRole('button', { name: 'Reject' })
    expect(accept.className).toBe(reject.className)
    expect(within(region).getByRole('link', { name: 'Cookie details' })).toBeInTheDocument()

    await user.click(within(region).getByRole('button', { name: 'Hide cookie choices' }))
    expect(banner()).toBeNull()
    expect(document.activeElement).toBe(chip())
    // Opening and closing it is not a choice.
    expect(document.cookie).not.toContain('tm_consent')
  })

  it('collapses on Escape', async () => {
    const user = userEvent.setup()
    render(<CookieConsentBanner />)
    await user.click(chip()!)
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Hide cookie choices' }))
    await user.keyboard('{Escape}')
    expect(banner()).toBeNull()
    expect(document.activeElement).toBe(chip())
    expect(document.cookie).not.toContain('tm_consent')
  })

  it('stores a choice made in the expanded card', async () => {
    const user = userEvent.setup()
    render(<CookieConsentBanner />)
    await user.click(chip()!)
    await user.click(screen.getByRole('button', { name: 'Accept' }))
    expect(document.cookie).toContain('tm_consent=granted')
    expect(banner()).toBeNull()
    expect(chip()).toBeNull()
  })

  it('switches between chip and card when the viewport crosses the breakpoint', () => {
    const viewport = mockViewport(false)
    render(<CookieConsentBanner />)
    expect(chip()).toBeInTheDocument()
    viewport.resize(true)
    expect(chip()).toBeNull()
    expect(banner()).toBeInTheDocument()
    // Escape does nothing in the wide card: there is nothing to collapse to.
    fireEvent.keyDown(banner()!, { key: 'Escape' })
    expect(banner()).toBeInTheDocument()
    viewport.resize(false)
    expect(chip()).toBeInTheDocument()
  })

  it('"Cookie settings" opens it expanded; collapsing closes it with the stored choice unchanged', async () => {
    document.cookie = 'tm_consent=granted; Path=/'
    const user = userEvent.setup()
    render(
      <>
        <Footer />
        <CookieConsentBanner />
      </>
    )
    const settings = screen.getByRole('button', { name: 'Cookie settings' })
    await user.click(settings)
    const region = banner()!
    expect(chip()).toBeNull()
    expect(document.activeElement).toBe(region)
    expect(within(region).getByRole('button', { name: 'Reject' })).toBeInTheDocument()

    await user.click(within(region).getByRole('button', { name: 'Hide cookie choices' }))
    expect(banner()).toBeNull()
    expect(chip()).toBeNull()
    expect(document.cookie).toContain('tm_consent=granted')
    expect(document.activeElement).toBe(settings)
  })

  it('"Cookie settings" before any choice opens it expanded, and collapsing leaves the chip', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Footer />
        <CookieConsentBanner />
      </>
    )
    await user.click(screen.getByRole('button', { name: 'Cookie settings' }))
    expect(banner()).toBeInTheDocument()
    expect(chip()).toBeNull()
    await user.keyboard('{Escape}')
    expect(document.activeElement).toBe(chip())
    expect(document.cookie).not.toContain('tm_consent')
  })

  it('names the chip in German', () => {
    render(<CookieConsentBanner />, {
      wrapper: ({ children }) => (
        <NextIntlClientProvider locale="de" messages={de}>
          {children}
        </NextIntlClientProvider>
      ),
    })
    expect(screen.getByRole('button', { name: 'Cookie-Auswahl' })).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('CookieConsentBanner on the home page', () => {
  beforeEach(() => {
    nav.pathname = '/'
  })

  it('waits until the visitor scrolls past most of the first screen, and scrolling is never a choice', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    render(<CookieConsentBanner />)
    expect(banner()).toBeNull()

    scrollTo(0.5 * window.innerHeight)
    expect(banner()).toBeNull()

    scrollTo(0.9 * window.innerHeight)
    expect(banner()).toBeInTheDocument()
    expect(document.cookie).not.toContain('tm_consent')
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function))

    // Back at the top it stays: it was revealed, not answered.
    scrollTo(0)
    expect(banner()).toBeInTheDocument()
    remove.mockRestore()
  })

  it('listens passively', () => {
    const add = vi.spyOn(window, 'addEventListener')
    render(<CookieConsentBanner />)
    expect(add).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true })
    add.mockRestore()
  })

  it('shows at once when the page loads already scrolled down', () => {
    Object.defineProperty(window, 'scrollY', { value: 2 * window.innerHeight, configurable: true, writable: true })
    render(<CookieConsentBanner />)
    expect(banner()).toBeInTheDocument()
  })

  it('on a phone, scrolling reveals only the chip', () => {
    mockViewport(false)
    render(<CookieConsentBanner />)
    expect(chip()).toBeNull()
    scrollTo(window.innerHeight)
    expect(chip()).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(document.cookie).not.toContain('tm_consent')
  })

  it('"Cookie settings" opens it at once, before any scroll', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Footer />
        <CookieConsentBanner />
      </>
    )
    expect(banner()).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Cookie settings' }))
    expect(document.activeElement).toBe(banner())
  })

  it('does not gate other pages', () => {
    nav.pathname = '/features'
    render(<CookieConsentBanner />)
    expect(banner()).toBeInTheDocument()
  })
})

describe('CookieConsentBanner by region and Global Privacy Control', () => {
  it('asks first in an opt-in region, with the ask-first message', () => {
    setRegion('optin')
    render(<CookieConsentBanner />)
    expect(banner()).toHaveTextContent(/They're set only if you accept/)
  })

  it('shows nothing unasked in an opt-out region, where analytics run straight away', async () => {
    setRegion('optout')
    renderWithAnalytics()
    expect(banner()).toBeNull()
    expect(chip()).toBeNull()
    expect(document.getElementById(GTAG_SCRIPT_ID)).toBeInTheDocument()
    expect(consentCommands().at(-1)).toEqual(['consent', 'update', { analytics_storage: 'granted' }])
    await waitFor(() =>
      expect(posthog.init).toHaveBeenCalledWith(
        'phc_test_key',
        expect.objectContaining({ persistence: 'localStorage+cookie', disable_session_recording: false })
      )
    )
    // No click was needed: the cookie choice itself is still unset.
    expect(document.cookie).not.toMatch(/(^|; )tm_consent=/)
  })

  it('in an opt-out region, "Cookie settings" says analytics are on, and Reject turns them off at once', async () => {
    setRegion('optout')
    render(
      <>
        <Footer />
        <CookieConsentBanner />
        <ConsentedGoogleAnalytics gaId={GA_ID} />
        <PostHogProvider />
      </>
    )
    await waitFor(() => expect(posthog.init).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', { name: 'Cookie settings' }))
    const region = banner()!
    expect(region).toHaveTextContent(/are on for this site in your region\. Reject turns them off/)
    expect(region).toHaveTextContent(/session recordings/)

    await userEvent.click(within(region).getByRole('button', { name: 'Reject' }))
    expect(banner()).toBeNull()
    expect(document.cookie).toContain('tm_consent=denied')
    expect(consentCommands().at(-1)).toEqual(['consent', 'update', { analytics_storage: 'denied' }])
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`]).toBe(true)
    expect(posthog.stopSessionRecording).toHaveBeenCalled()
    expect(posthog.opt_out_capturing).toHaveBeenCalled()
  })

  it.each(['optin', 'optout'] as const)('with Global Privacy Control (%s region) shows nothing and loads nothing unasked', async (r) => {
    setRegion(r)
    setGpc(true)
    renderWithAnalytics()
    await settle()
    expect(banner()).toBeNull()
    expect(chip()).toBeNull()
    expect(document.getElementById(GTAG_SCRIPT_ID)).toBeNull()
    expect(posthog.init).not.toHaveBeenCalled()
  })

  it('with Global Privacy Control, "Cookie settings" explains why analytics are off, and Accept turns them on', async () => {
    setRegion('optout')
    setGpc(true)
    render(
      <>
        <Footer />
        <CookieConsentBanner />
        <ConsentedGoogleAnalytics gaId={GA_ID} />
      </>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cookie settings' }))
    const region = banner()!
    expect(region).toHaveTextContent(/Global Privacy Control signal, so analytics .* are off\. Accept turns them on/)
    await userEvent.click(within(region).getByRole('button', { name: 'Accept' }))
    expect(document.cookie).toContain('tm_consent=granted')
    expect(document.getElementById(GTAG_SCRIPT_ID)).toBeInTheDocument()
  })

  it('reopened after a stored choice, it shows the ask-first message whatever the region', async () => {
    setRegion('optout')
    document.cookie = 'tm_consent=denied; Path=/'
    render(
      <>
        <Footer />
        <CookieConsentBanner />
      </>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cookie settings' }))
    expect(banner()).toHaveTextContent(/They're set only if you accept/)
  })

  it('shows the opt-out and GPC messages in German', async () => {
    setRegion('optout')
    render(
      <NextIntlClientProvider locale="de" messages={de}>
        <Footer />
        <CookieConsentBanner />
      </NextIntlClientProvider>
    )
    await userEvent.click(screen.getByRole('button', { name: de.footer.cookieSettings }))
    expect(screen.getByRole('region', { name: de.consent.label })).toHaveTextContent(de.consent.messageOn)
    act(() => resetConsentStateForTests())
    setGpc(true)
    await userEvent.click(screen.getByRole('button', { name: de.footer.cookieSettings }))
    expect(screen.getByRole('region', { name: de.consent.label })).toHaveTextContent(de.consent.messageGpc)
  })
})
