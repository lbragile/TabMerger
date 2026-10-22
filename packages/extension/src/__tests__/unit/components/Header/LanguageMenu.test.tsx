import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LOCALE_NATIVE_NAMES, SUPPORTED_LOCALES } from '@tabmerger/shared'
import { TooltipProvider } from '@/components/ui/tooltip'
import { LanguageMenu } from '@/components/Header/LanguageMenu'
import { i18n } from '@/lib/i18n'
import { LOCALE_PREFERENCE_LOCAL_STORAGE_KEY, LOCALE_PREFERENCE_STORAGE_KEY } from '@/lib/localePreference'

/** An option by the language's own name (its accessible name goes on: ", German, Right-to-left"). */
const native = (name: string) => new RegExp(`^${name}(,|$)`)


type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void
const listeners = new Set<Listener>()
const store = new Map<string, unknown>()
const SEARCH = 'Search languages by name or code'

function renderMenu() {
  return render(
    <TooltipProvider>
      <LanguageMenu />
    </TooltipProvider>
  )
}

/** Opens the menu and returns the focused search box. */
async function open(user: ReturnType<typeof userEvent.setup>, name = 'Language (EN)', searchName = SEARCH) {
  await user.click(screen.getByRole('button', { name }))
  const search = await screen.findByRole('combobox', { name: searchName })
  await waitFor(() => expect(search).toHaveFocus())
  return search
}

const optionNames = () => screen.getAllByRole('option').map((o) => o.querySelector('[data-native]')?.textContent)
const activeOption = (search: HTMLElement) =>
  document.getElementById(search.getAttribute('aria-activedescendant') ?? '')?.querySelector('[data-native]')

beforeEach(() => {
  localStorage.clear()
  store.clear()
  listeners.clear()
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v)
        }),
        remove: vi.fn(async (key: string) => void store.delete(key)),
      },
      onChanged: { addListener: (l: Listener) => listeners.add(l), removeListener: (l: Listener) => listeners.delete(l) },
    },
  })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  localStorage.clear()
  await i18n.changeLanguage('en')
  document.documentElement.dir = 'ltr'
  document.documentElement.lang = 'en'
})

describe('LanguageMenu', () => {
  it('shows the language in use as a short code, named for assistive technology', () => {
    renderMenu()
    const button = screen.getByRole('button', { name: 'Language (EN)' })
    expect(button).toHaveTextContent('EN')
    expect(button).toHaveAttribute('data-testid', 'header-language')
  })

  it('opens on a focused search box over Browser default and every language, the stored choice checked', async () => {
    const user = userEvent.setup()
    renderMenu()
    const search = await open(user)
    expect(search).toHaveAttribute('placeholder', 'Search languages (e.g. German, de)')
    expect(optionNames()).toEqual(['Browser default', ...SUPPORTED_LOCALES.map((l) => LOCALE_NATIVE_NAMES[l])])
    expect(screen.getByRole('option', { name: native('Browser default') })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: native('日本語') }).querySelector('[data-native]')).toHaveAttribute('lang', 'ja')
    // the checked choice is highlighted (the list scrolls itself to it: geometry, checked in the browser)
    expect(activeOption(search)).toHaveTextContent('Browser default')
  })

  it('typing narrows the list without closing it; Browser default always stays first', async () => {
    const user = userEvent.setup()
    renderMenu()
    const search = await open(user)
    await user.type(search, 'fran')
    expect(optionNames()).toEqual(['Browser default', 'Français'])
    // by code and by alias too (filterLocales)
    await user.clear(search)
    await user.type(search, 'iw')
    expect(optionNames()).toEqual(['Browser default', 'עברית'])
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(search).toHaveFocus()
  })

  it('says so when nothing matches', async () => {
    const user = userEvent.setup()
    renderMenu()
    const search = await open(user)
    await user.type(search, 'klingon')
    expect(optionNames()).toEqual(['Browser default'])
    expect(screen.getByRole('status')).toHaveTextContent('No languages found')
  })

  it('Enter picks the first match: applies it at once, stores it in both places, closes and returns focus', async () => {
    const user = userEvent.setup()
    renderMenu()
    const search = await open(user)
    await user.type(search, 'fr')
    expect(activeOption(search)).toHaveTextContent('Français')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(i18n.language).toBe('fr'))
    expect(localStorage.getItem(LOCALE_PREFERENCE_LOCAL_STORAGE_KEY)).toBe('fr')
    expect(store.get(LOCALE_PREFERENCE_STORAGE_KEY)).toBe('fr')
    expect(document.documentElement.lang).toBe('fr')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    const button = await screen.findByRole('button', { name: 'Langue (FR)' })
    await waitFor(() => expect(button).toHaveFocus())
  })

  it('ArrowDown and ArrowUp move the highlight; a click picks; back to the browser language', async () => {
    const user = userEvent.setup()
    renderMenu()
    const search = await open(user)
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}')
    expect(activeOption(search)).toHaveTextContent('English')
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(activeOption(search)).toHaveTextContent('Browser default') // stops at the top
    await user.click(screen.getByRole('option', { name: native('Deutsch') }))
    await waitFor(() => expect(i18n.language).toBe('de'))

    await open(user, 'Sprache (DE)', 'Sprachen nach Name oder Code suchen')
    expect(screen.getByRole('option', { name: native('Deutsch') })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('option', { name: native('Browser-Standard') }))
    await waitFor(() => expect(i18n.language).toBe('en'))
    expect(localStorage.getItem(LOCALE_PREFERENCE_LOCAL_STORAGE_KEY)).toBeNull()
    expect(store.has(LOCALE_PREFERENCE_STORAGE_KEY)).toBe(false)
  })

  it('Escape closes it without a change and returns focus to the button', async () => {
    const user = userEvent.setup()
    renderMenu()
    await open(user)
    await user.keyboard('fr{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(i18n.language).toBe('en')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Language (EN)' })).toHaveFocus())
  })

  it('picking Hebrew turns the UI right to left (typed "heb")', async () => {
    const user = userEvent.setup()
    renderMenu()
    const search = await open(user)
    await user.type(search, 'heb')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(i18n.language).toBe('he'))
    expect(document.documentElement.dir).toBe('rtl')
    expect(document.documentElement.lang).toBe('he')
  })

  it('follows a choice saved on another extension page', async () => {
    const user = userEvent.setup()
    renderMenu()
    act(() => listeners.forEach((l) => l({ [LOCALE_PREFERENCE_STORAGE_KEY]: { newValue: 'de' } }, 'local')))
    await open(user)
    expect(screen.getByRole('option', { name: native('Deutsch') })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('LanguageMenu — right-to-left mark', () => {
  it('marks exactly Arabic, Hebrew and Persian, with the accessible text', async () => {
    const user = userEvent.setup()
    renderMenu()
    await open(user)
    const marked = screen
      .getAllByRole('option')
      .filter((o) => o.querySelector('[data-rtl-mark]'))
      .map((o) => o.querySelector('[data-native]')?.getAttribute('lang'))
    expect(marked).toEqual(['ar', 'he', 'fa'])
    expect(screen.getByRole('option', { name: 'فارسی, Persian, Right-to-left' })).toBeInTheDocument()
    // not on the closed button
    expect(screen.getByTestId('header-language').querySelector('[data-rtl-mark]')).toBeNull()
  })
})
