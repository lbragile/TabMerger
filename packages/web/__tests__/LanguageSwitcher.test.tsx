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
import { DirectionProvider } from '@radix-ui/react-direction'
import { LOCALE_NATIVE_NAMES, localeDirection, type AppLocale } from '@/i18n/locales'
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

/** A language row's native name: the row's text without the muted name in the page's language. */
const nativeName = (item: HTMLElement) => item.querySelector('span[dir]')?.textContent ?? ''

describe('LanguageMenu trigger', () => {
  it('shows the icon and the current code, named with the language in the page language', async () => {
    nav.pathname = '/de/pricing'
    await renderIn('de', <LanguageMenu />)
    const trigger = screen.getByRole('button', { name: 'Sprache: Deutsch (DE)' })
    expect(trigger).toHaveTextContent('DE')
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('names the language in the page language, in Japanese too', async () => {
    await renderIn('ja', <LanguageMenu />)
    expect(screen.getByRole('button', { name: '言語：日本語（JA）' })).toHaveTextContent('JA')
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
  it('lists the eighteen public languages by their own names, each in its own lang, the current one checked', async () => {
    const user = userEvent.setup()
    await renderIn('fr', <LanguageMenu />)
    await user.click(screen.getByRole('button', { name: 'Langue : Français (FR)' }))

    const items = screen.getAllByRole('menuitemradio')
    expect(items).toHaveLength(18)
    expect(items.map(nativeName)).toEqual(SUPPORTED_LOCALES.map((code) => LOCALE_NATIVE_NAMES[code]))
    // Each row also names the language in the page's language, muted, after the native name:
    // "Deutsch, allemand" (the comma is for screen readers). The page's own language has no
    // second name.
    const german = screen.getByRole('menuitemradio', { name: 'Deutsch, allemand' })
    const end = german.querySelector('[lang="fr"]')
    expect(end).toHaveTextContent('allemand')
    expect(end).toHaveClass('text-muted-foreground')
    expect(screen.getByRole('menuitemradio', { name: 'Français' })).toBeInTheDocument()
    expect(items.map((item) => item.getAttribute('lang'))).toEqual([...SUPPORTED_LOCALES])
    expect(items.filter((item) => item.getAttribute('aria-checked') === 'true').map(nativeName)).toEqual(['Français'])
  })

  it('reloads the same page under the chosen prefix, keeping the query and hash, and saves the cookie', async () => {
    const user = userEvent.setup()
    setLocation('/pricing?x=1#faq')
    await renderIn('en', <LanguageMenu />)
    await user.click(screen.getByRole('button', { name: 'Language: English (EN)' }))
    await user.click(screen.getByRole('menuitemradio', { name: /^Deutsch(,|$)/ }))

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
    await user.click(screen.getByRole('menuitemradio', { name: /^Deutsch(,|$)/ }))

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
    await user.click(screen.getByRole('menuitemradio', { name: /^English(,|$)/ }))

    expect(replace).toHaveBeenCalledWith('/pricing')
    expect(document.cookie).toMatch(/(^|; )NEXT_LOCALE=en(;|$)/)
  })

  it('maps the home page to the bare prefix', async () => {
    const user = userEvent.setup()
    nav.pathname = '/'
    setLocation('/')
    await renderIn('en', <LanguageMenu />)
    await user.click(screen.getByRole('button', { name: 'Language: English (EN)' }))
    await user.click(screen.getByRole('menuitemradio', { name: /^Português \(Brasil\)(,|$)/ }))

    expect(replace).toHaveBeenCalledWith('/pt-BR')
  })

  it('does nothing when the current language is chosen again', async () => {
    const user = userEvent.setup()
    await renderIn('en', <LanguageMenu />)
    await user.click(screen.getByRole('button', { name: 'Language: English (EN)' }))
    await user.click(screen.getByRole('menuitemradio', { name: /^English(,|$)/ }))

    expect(replace).not.toHaveBeenCalled()
    expect(document.cookie).not.toMatch(/NEXT_LOCALE/)
  })

  it('works from the keyboard: Enter opens on the search, ArrowDown enters the list, arrows move, Enter picks', async () => {
    const user = userEvent.setup()
    await renderIn('en', <LanguageMenu />)
    screen.getByRole('button', { name: 'Language: English (EN)' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('searchbox', { name: 'Search languages by name or code' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitemradio', { name: /^English(,|$)/ })).toHaveFocus()
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('menuitemradio', { name: /^Español(,|$)/ })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(replace).toHaveBeenCalledWith('/es/pricing')
  })

  it('goes back up to the search from the first language', async () => {
    const user = userEvent.setup()
    await renderIn('en', <LanguageMenu />)
    await user.click(screen.getByRole('button', { name: 'Language: English (EN)' }))
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitemradio', { name: /^English(,|$)/ })).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('searchbox')).toHaveFocus()
  })
})

describe('LanguageMenu search', () => {
  const open = async (locale: AppLocale = 'en', name = 'Language: English (EN)') => {
    const user = userEvent.setup()
    // The root layout gives Radix (and the search field) the locale's direction.
    await renderIn(
      locale,
      <DirectionProvider dir={localeDirection(locale)}>
        <LanguageMenu />
      </DirectionProvider>
    )
    await user.click(screen.getByRole('button', { name }))
    return user
  }
  const listed = () => screen.queryAllByRole('menuitemradio').map(nativeName)

  it('has focus on open, with a placeholder that says it takes names and codes', async () => {
    await open()
    const search = screen.getByRole('searchbox', { name: 'Search languages by name or code' })
    expect(search).toHaveFocus()
    expect(search).toHaveAttribute('placeholder', 'Search languages (e.g. German, de)')
    // Empty, it follows the page; what is typed then keeps its own direction.
    expect(search).toHaveAttribute('dir', 'ltr')
  })

  it('narrows the list by native name, English name, code and old alias', async () => {
    const user = await open()
    await user.keyboard('heb')
    expect(listed()).toEqual(['עברית'])
    await user.clear(screen.getByRole('searchbox'))
    await user.keyboard('deutsch')
    expect(listed()).toEqual(['Deutsch'])
    await user.clear(screen.getByRole('searchbox'))
    await user.keyboard('iw')
    expect(listed()).toEqual(['עברית'])
    await user.clear(screen.getByRole('searchbox'))
    await user.keyboard('farsi')
    expect(listed()).toEqual(['فارسی'])
  })

  it('finds German by each word of the placeholder example', async () => {
    const user = await open()
    // The example's words, and the native name too.
    for (const word of ['German', 'de', 'Deutsch']) {
      await user.clear(screen.getByRole('searchbox'))
      await user.keyboard(word)
      expect(listed(), word).toEqual(['Deutsch'])
    }
  })

  it('finds German by the Hebrew example word on a Hebrew page', async () => {
    const user = await open('he', 'שפה: עברית (HE)')
    await user.keyboard('גרמנית')
    expect(listed()).toEqual(['Deutsch'])
  })

  it('matches names in the page language', async () => {
    const user = await open('de', 'Sprache: Deutsch (DE)')
    await user.keyboard('hebräisch')
    expect(listed()).toEqual(['עברית'])
  })

  it('keeps typed letters in the field: no menu typeahead, the menu stays open', async () => {
    const user = await open()
    await user.keyboard('po')
    const search = screen.getByRole('searchbox')
    expect(search).toHaveValue('po')
    expect(search).toHaveFocus()
    expect(screen.getByRole('menu')).toBeInTheDocument()
    // Space types too, rather than picking a language.
    await user.keyboard(' br')
    expect(search).toHaveValue('po br')
    expect(listed()).toEqual(['Português (Brasil)'])
    expect(replace).not.toHaveBeenCalled()
  })

  it('picks the first match with Enter', async () => {
    const user = await open()
    await user.keyboard('heb{Enter}')
    expect(replace).toHaveBeenCalledWith('/he/pricing')
  })

  it('says so when nothing matches, and Enter then does nothing', async () => {
    const user = await open()
    await user.keyboard('klingon')
    expect(screen.getByRole('status')).toHaveTextContent('No languages found')
    expect(listed()).toEqual([])
    await user.keyboard('{Enter}')
    expect(replace).not.toHaveBeenCalled()
  })

  it('sends a letter typed on a language back to the search field', async () => {
    const user = await open()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitemradio', { name: /^English(,|$)/ })).toHaveFocus()
    await user.keyboard('j')
    expect(screen.getByRole('searchbox')).toHaveFocus()
  })

  it('closes with Escape and starts empty again next time', async () => {
    const user = await open()
    await user.keyboard('heb')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Language: English (EN)' }))
    expect(screen.getByRole('searchbox')).toHaveValue('')
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(18)
  })

  it('right to left: Hebrew copy with the Latin example words isolated, each name in its own direction', async () => {
    const user = await open('he', 'שפה: עברית (HE)')
    const search = screen.getByRole('searchbox')
    // Each Latin run sits in its own first-strong isolate (U+2068 ... U+2069), so the parts keep
    // their order and the parentheses stay where Hebrew puts them.
    expect(search).toHaveAttribute('placeholder', 'חיפוש שפה (למשל גרמנית, \u2068de\u2069)')
    expect(search).toHaveAttribute('dir', 'rtl')
    await user.keyboard('ger')
    expect(search).toHaveAttribute('dir', 'auto')
    const [german] = screen.getAllByRole('menuitemradio')
    expect(german).toHaveTextContent('Deutsch')
    expect(within(german).getByText('Deutsch')).toHaveAttribute('dir', 'ltr')
  })

  it('marks exactly Arabic, Hebrew and Persian as right to left, with a tooltip and spoken text', async () => {
    await open()
    const items = screen.getAllByRole('menuitemradio')
    const marked = items.filter((item) => item.querySelector('[data-testid="rtl-indicator"]'))
    expect(marked.map((item) => item.getAttribute('lang'))).toEqual(['ar', 'he', 'fa'])
    for (const item of marked) {
      const icon = item.querySelector('[data-testid="rtl-indicator"]')!
      expect(icon).toHaveAttribute('aria-hidden', 'true')
      expect(icon.parentElement).toHaveAttribute('title', 'Right-to-left')
    }
    // What a screen reader hears: native name, name in the page language, direction.
    expect(screen.getByRole('menuitemradio', { name: 'עברית, Hebrew, Right-to-left' })).toBeInTheDocument()
    // Every row keeps the same fixed slot, so the names line up with or without the mark.
    const slots = items.map((item) => item.querySelector('.w-3\\.5.justify-center'))
    expect(slots.every(Boolean)).toBe(true)
  })

  it('in Hebrew, the mark is on Hebrew too, named in Hebrew', async () => {
    await open('he', 'שפה: עברית (HE)')
    expect(screen.getByRole('menuitemradio', { name: 'עברית, מימין לשמאל' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /^العربية, ערבית, מימין לשמאל$/ })).toBeInTheDocument()
  })

  it('still finds right-to-left languages by name and code', async () => {
    const user = await open()
    await user.keyboard('arab')
    expect(listed()).toEqual(['العربية'])
    await user.clear(screen.getByRole('searchbox'))
    await user.keyboard('fa')
    expect(listed()).toEqual(['فارسی'])
  })

  it('scrolls the current language into view on open, keeping focus in the search', async () => {
    const scrolled: Element[] = []
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element, arg) {
      expect(arg).toEqual({ block: 'nearest' })
      scrolled.push(this)
    })
    try {
      await open('he', 'שפה: עברית (HE)')
      expect(scrolled.at(-1)).toBe(screen.getByRole('menuitemradio', { name: /^עברית/ }))
      expect(screen.getByRole('searchbox')).toHaveFocus()
    } finally {
      spy.mockRestore()
    }
  })

  it('keeps revealing it while the menu settles, but not after the visitor types', async () => {
    // The list is capped only once Radix has placed the menu: each size change re-reveals the
    // checked row until the visitor acts. A stand-in ResizeObserver plays the size changes.
    const callbacks: ((entries: unknown[]) => void)[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        cb: (entries: unknown[]) => void
        constructor(cb: (entries: unknown[]) => void) {
          this.cb = cb
          callbacks.push(cb)
        }
        observe() {}
        unobserve() {}
        // Only this observer stops: Radix's own observers keep theirs.
        disconnect() {
          const i = callbacks.indexOf(this.cb)
          if (i >= 0) callbacks.splice(i, 1)
        }
      }
    )
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
    try {
      const user = await open('he', 'שפה: עברית (HE)')
      const before = spy.mock.calls.length
      callbacks.forEach((cb) => cb([]))
      expect(spy.mock.calls.length).toBeGreaterThan(before)
      await user.keyboard('x')
      await user.clear(screen.getByRole('searchbox'))
      const afterTyping = spy.mock.calls.length
      callbacks.forEach((cb) => cb([]))
      expect(spy.mock.calls.length).toBe(afterTyping)
    } finally {
      spy.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('caps the menu at the room on screen, with the list scrolling inside it', async () => {
    await open()
    const menu = screen.getByRole('menu')
    expect(menu.className).toContain('max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))]')
    expect(menu.className).toContain('w-[min(19rem,var(--radix-dropdown-menu-content-available-width))]')
    const list = screen.getAllByRole('menuitemradio')[0].closest('.overflow-y-auto')
    expect(list).not.toBeNull()
    expect(list).toHaveClass('min-h-0', 'flex-1')
  })

  it('switches to a regional locale by its full prefix', async () => {
    const user = userEvent.setup()
    await renderIn('en', <LanguageMenu />)
    await user.click(screen.getByRole('button', { name: 'Language: English (EN)' }))
    await user.click(screen.getByRole('menuitemradio', { name: /^简体中文(,|$)/ }))
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
