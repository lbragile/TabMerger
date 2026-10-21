/**
 * The header language picker (`LanguageMenu`, loaded through `LanguageSwitcher`): its accessible
 * name, the menu of native language names, and what choosing one does. Switching is a full page
 * load (`location.replace`) of the same path, query and hash under the new locale's prefix, after
 * writing the `NEXT_LOCALE` cookie: the root layout owns `<html lang>` and the client messages and
 * a client-side navigation would never re-render it. The router must never be used, on mount or
 * on selection.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SUPPORTED_LOCALES } from '@tabmerger/shared'
import { LOCALE_NATIVE_NAMES, type AppLocale } from '@/i18n/locales'
import { loadMessages } from '@/i18n/messages'

// The real locale-aware navigation (the global setup swaps in a plain stand-in), so the computed
// URL carries the real prefix.
vi.unmock('@/i18n/navigation')

const { router, nav, locales } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn() },
  nav: { pathname: '/pricing' },
  locales: { only: null as string[] | null },
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
  useRouter: () => router,
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}))

// Lets one test pretend only one language is public.
vi.mock('@/i18n/locales', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/locales')>()
  return {
    ...actual,
    get PUBLIC_LOCALES() {
      return locales.only ?? actual.PUBLIC_LOCALES
    },
  }
})

import { LanguageMenu } from '@/components/layout/LanguageMenu'
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher'

const realLocation = window.location
const replace = vi.fn()

function setLocation(url: string) {
  const { pathname, search, hash } = new URL(url, 'http://localhost')
  delete (window as { location?: unknown }).location
  ;(window as unknown as { location: unknown }).location = { pathname, search, hash, href: url, replace }
}

function clearLocaleCookie() {
  document.cookie = 'NEXT_LOCALE=; path=/; max-age=0'
}

async function renderIn(locale: AppLocale, ui: ReactNode) {
  const messages = await loadMessages(locale)
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {ui}
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  clearLocaleCookie()
  nav.pathname = '/pricing'
  locales.only = null
  setLocation('/pricing')
})

afterEach(() => {
  ;(window as unknown as { location: Location }).location = realLocation
  clearLocaleCookie()
})

describe('LanguageMenu trigger', () => {
  it('shows the icon and the current code, named with the language in the page language', async () => {
    nav.pathname = '/de/pricing'
    await renderIn('de', <LanguageMenu />)
    const trigger = screen.getByRole('button', { name: 'Sprache: Deutsch (DE)' })
    expect(trigger).toHaveTextContent('DE')
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows the language name in the mobile-panel row', async () => {
    await renderIn('ja', <LanguageMenu variant="row" />)
    const row = screen.getByRole('button', { name: '言語：日本語（JA）' })
    expect(row).toHaveTextContent('言語')
    expect(within(row).getByText('日本語')).toHaveAttribute('lang', 'ja')
  })

  it('never navigates or touches the router on render', async () => {
    await renderIn('en', <LanguageMenu />)
    expect(replace).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
    expect(router.push).not.toHaveBeenCalled()
    expect(document.cookie).not.toMatch(/NEXT_LOCALE/)
  })
})

describe('LanguageMenu menu', () => {
  it('lists the fifteen public languages by their own names, each in its own lang, the current one checked', async () => {
    const user = userEvent.setup()
    await renderIn('fr', <LanguageMenu />)
    await user.click(screen.getByRole('button', { name: 'Langue : Français (FR)' }))

    const items = screen.getAllByRole('menuitemradio')
    expect(items).toHaveLength(15)
    expect(items.map((item) => item.textContent)).toEqual(SUPPORTED_LOCALES.map((code) => LOCALE_NATIVE_NAMES[code]))
    expect(items.map((item) => item.getAttribute('lang'))).toEqual([...SUPPORTED_LOCALES])
    expect(items.filter((item) => item.getAttribute('aria-checked') === 'true').map((i) => i.textContent)).toEqual(['Français'])
  })

  it('reloads the same page under the chosen prefix, keeping the query and hash, and saves the cookie', async () => {
    const user = userEvent.setup()
    setLocation('/pricing?x=1#faq')
    await renderIn('en', <LanguageMenu />)
    await user.click(screen.getByRole('button', { name: 'Language: English (EN)' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Deutsch' }))

    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith('/de/pricing?x=1#faq')
    expect(document.cookie).toMatch(/(^|; )NEXT_LOCALE=de(;|$)/)
    expect(router.replace).not.toHaveBeenCalled()
    expect(router.push).not.toHaveBeenCalled()
  })

  it('saves the choice for a year, site-wide, with the attributes next-intl uses', async () => {
    // jsdom's document.cookie getter hides attributes, so read what was written.
    const cookieSet = vi.spyOn(document, 'cookie', 'set')
    const user = userEvent.setup()
    setLocation('/pricing')
    await renderIn('en', <LanguageMenu />)
    await user.click(screen.getByRole('button', { name: 'Language: English (EN)' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Deutsch' }))

    expect(cookieSet).toHaveBeenCalledTimes(1)
    const written = cookieSet.mock.calls[0][0]
    expect(written).toMatch(/^NEXT_LOCALE=de;/)
    expect(written).toMatch(/; max-age=31536000(;|$)/i)
    expect(written).toMatch(/; path=\/(;|$)/i)
    expect(written).toMatch(/; SameSite=lax(;|$)/i)
    cookieSet.mockRestore()
  })

  it('switching back to English drops the prefix and stores "en", so unprefixed URLs stay English', async () => {
    const user = userEvent.setup()
    nav.pathname = '/de/pricing'
    setLocation('/de/pricing')
    document.cookie = 'NEXT_LOCALE=de; path=/'
    await renderIn('de', <LanguageMenu />)
    await user.click(screen.getByRole('button', { name: 'Sprache: Deutsch (DE)' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'English' }))

    expect(replace).toHaveBeenCalledWith('/pricing')
    expect(document.cookie).toMatch(/(^|; )NEXT_LOCALE=en(;|$)/)
  })

  it('maps the home page to the bare prefix', async () => {
    const user = userEvent.setup()
    nav.pathname = '/'
    setLocation('/')
    await renderIn('en', <LanguageMenu />)
    await user.click(screen.getByRole('button', { name: 'Language: English (EN)' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Português (Brasil)' }))

    expect(replace).toHaveBeenCalledWith('/pt-BR')
  })

  it('does nothing when the current language is chosen again', async () => {
    const user = userEvent.setup()
    await renderIn('en', <LanguageMenu />)
    await user.click(screen.getByRole('button', { name: 'Language: English (EN)' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'English' }))

    expect(replace).not.toHaveBeenCalled()
    expect(document.cookie).not.toMatch(/NEXT_LOCALE/)
  })

  it('works from the keyboard: Enter opens on the first language, arrows move, Enter picks', async () => {
    const user = userEvent.setup()
    await renderIn('en', <LanguageMenu />)
    screen.getByRole('button', { name: 'Language: English (EN)' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('menuitemradio', { name: 'English' })).toHaveFocus()
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('menuitemradio', { name: 'Español' })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(replace).toHaveBeenCalledWith('/es/pricing')
  })

  it('calls onSwitch before leaving the page (the mobile panel closes)', async () => {
    const user = userEvent.setup()
    const order: string[] = []
    const onSwitch = vi.fn(() => order.push('onSwitch'))
    replace.mockImplementationOnce(() => order.push('replace'))
    await renderIn('en', <LanguageMenu variant="row" onSwitch={onSwitch} />)
    await user.click(screen.getByRole('button', { name: 'Language: English (EN)' }))
    await user.click(screen.getByRole('menuitemradio', { name: '简体中文' }))

    expect(order).toEqual(['onSwitch', 'replace'])
    expect(replace).toHaveBeenCalledWith('/zh-CN/pricing')
  })
})

describe('LanguageSwitcher', () => {
  it('loads the menu', async () => {
    await renderIn('en', <LanguageSwitcher />)
    expect(await screen.findByRole('button', { name: 'Language: English (EN)' })).toBeInTheDocument()
  })

  it('renders nothing while fewer than two languages are public', async () => {
    locales.only = ['en']
    const { container } = await renderIn('en', <LanguageSwitcher />)
    expect(container).toBeEmptyDOMElement()
  })
})
