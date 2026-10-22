/**
 * LanguagePicker: the search box + list shared by the header's language menu and Settings. The
 * hosts (and their storage) are covered in Header/LanguageMenu.test.tsx and
 * Modal/Settings.test.tsx; this covers the panel on its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguagePicker } from '@/components/LanguagePicker'
import { i18n } from '@/lib/i18n'
import { catalogs } from '@/locales'
import { SUPPORTED_LOCALES, filterLocales, localeNameIn, type SupportedLocale } from '@tabmerger/shared'

/** An option by the language's own name (its accessible name goes on: ", German, Right-to-left"). */
const native = (name: string) => new RegExp(`^${name}(,|$)`)


const SEARCH = 'Search languages by name or code'
const names = () => screen.getAllByRole('option').map((o) => o.querySelector('[data-native]')?.textContent)
const active = () => {
  const id = screen.getByRole('combobox').getAttribute('aria-activedescendant')
  return id ? document.getElementById(id)?.querySelector('[data-native]')?.textContent : null
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(async () => {
  cleanup()
  document.documentElement.dir = ''
  await act(async () => {
    await i18n.changeLanguage('en')
  })
})

describe('LanguagePicker', () => {
  it('starts on the current choice, checked', () => {
    render(<LanguagePicker value="fr" onPick={vi.fn()} />)
    expect(active()).toBe('Français')
    expect(screen.getByRole('option', { name: native('Français') })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: native('English') })).toHaveAttribute('aria-selected', 'false')
  })

  it('filters with the UI language too: "Englisch" finds English in the German UI', async () => {
    await act(async () => {
      await i18n.changeLanguage('de')
    })
    render(<LanguagePicker value="auto" onPick={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Englisch' } })
    expect(names()).toEqual(['Browser-Standard', 'English'])
  })

  it('a code or an old alias finds the language (de, iw, farsi)', () => {
    render(<LanguagePicker value="auto" onPick={vi.fn()} />)
    const search = screen.getByRole('combobox', { name: SEARCH })
    fireEvent.change(search, { target: { value: 'de' } })
    expect(names()).toContain('Deutsch')
    fireEvent.change(search, { target: { value: 'farsi' } })
    expect(names()).toEqual(['Browser default', 'فارسی'])
  })

  it('Enter picks the highlighted option; with nothing typed that is the current choice', () => {
    const onPick = vi.fn()
    render(<LanguagePicker value="ja" onPick={onPick} />)
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('ja')
  })

  it('Enter with no match picks Browser default (the only option left)', () => {
    const onPick = vi.fn()
    render(<LanguagePicker value="ja" onPick={onPick} />)
    const search = screen.getByRole('combobox')
    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(screen.getByRole('status')).toHaveTextContent('No languages found')
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('auto')
  })

  it('in a right-to-left UI: the search box takes the typed text’s direction, Up/Down still move, Left/Right do not', () => {
    document.documentElement.dir = 'rtl'
    render(<LanguagePicker value="auto" onPick={vi.fn()} />)
    const search = screen.getByRole('combobox')
    // empty, it follows the UI (so the placeholder reads right to left)
    expect(search).not.toHaveAttribute('dir')
    fireEvent.change(search, { target: { value: 'English' } })
    expect(search).toHaveAttribute('dir', 'auto')
    fireEvent.change(search, { target: { value: '' } })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(active()).toBe('English')
    fireEvent.keyDown(search, { key: 'ArrowLeft' })
    fireEvent.keyDown(search, { key: 'ArrowRight' })
    expect(active()).toBe('English')
    // each language is marked with its own `lang`, so it is shaped and read in its script
    expect(screen.getByRole('option', { name: native('עברית') }).querySelector('[data-native]')).toHaveAttribute('lang', 'he')
  })
})

describe('LanguagePicker — right-to-left mark', () => {
  const marked = () =>
    screen
      .getAllByRole('option')
      .filter((o) => o.querySelector('[data-rtl-mark]'))
      .map((o) => o.querySelector('[data-native]')?.getAttribute('lang'))

  it('marks exactly the right-to-left languages, never Browser default', () => {
    render(<LanguagePicker value="auto" onPick={vi.fn()} />)
    expect(marked()).toEqual(['ar', 'he', 'fa'])
    expect(screen.getByRole('option', { name: native('Browser default') }).querySelector('[data-rtl-mark]')).toBeNull()
  })

  it('names the mark: a tooltip, and "native, UI-language name, Right-to-left" for screen readers', () => {
    render(<LanguagePicker value="auto" onPick={vi.fn()} />)
    const hebrew = screen.getByRole('option', { name: 'עברית, Hebrew, Right-to-left' })
    expect(hebrew.querySelector('[data-rtl-mark]')).toHaveAttribute('title', 'Right-to-left')
    expect(hebrew.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('option', { name: 'Deutsch, German' })).toBeInTheDocument()
  })

  it('in the Hebrew UI, Hebrew has no second name and the label is in Hebrew', async () => {
    await act(async () => {
      await i18n.changeLanguage('he')
    })
    render(<LanguagePicker value="auto" onPick={vi.fn()} />)
    expect(screen.getByRole('option', { name: 'עברית, מימין לשמאל' })).toBeInTheDocument()
  })
})

describe('LanguagePicker — the placeholder example finds its language', () => {
  it('"German" and "Deutsch" find German in the English UI; "גרמנית" in the Hebrew UI', async () => {
    render(<LanguagePicker value="auto" onPick={vi.fn()} />)
    const search = screen.getByRole('combobox')
    for (const word of ['German', 'Deutsch', 'de']) {
      fireEvent.change(search, { target: { value: word } })
      expect(names()).toContain('Deutsch')
    }
    cleanup()
    await act(async () => {
      await i18n.changeLanguage('he')
    })
    render(<LanguagePicker value="auto" onPick={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'גרמנית' } })
    expect(names()).toContain('Deutsch')
  })

  // Every catalog's example is "<name in the UI language>, <code>" of German (French in the German
  // UI, where German is the UI's own language), the same strings as the website's switcher: each
  // part must be something the search matches, so the example never promises a search that finds
  // nothing.
  it.each(Object.keys(catalogs))('%s: every part of the example is searchable', (lng) => {
    const target: SupportedLocale = lng === 'de' ? 'fr' : 'de'
    const placeholder = (catalogs as unknown as Record<string, { settings: { general: { languageSearchPlaceholder: string } } }>)[lng].settings.general.languageSearchPlaceholder
    const text = placeholder.replace(/[⁦-⁩]/g, '').toLocaleLowerCase()
    const uiName = localeNameIn(target, lng) ?? ''
    expect(uiName, lng).not.toBe('')
    for (const part of [uiName, target]) {
      expect(text, `${lng} placeholder names "${part}"`).toContain(part.toLocaleLowerCase())
      expect(filterLocales(part, SUPPORTED_LOCALES, lng), `${lng}: "${part}"`).toContain(target)
    }
  })
})
