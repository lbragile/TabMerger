import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import { LanguageMenu } from '@/components/Header/LanguageMenu'
import { i18n } from '@/lib/i18n'
import { LOCALE_PREFERENCE_LOCAL_STORAGE_KEY, LOCALE_PREFERENCE_STORAGE_KEY } from '@/lib/localePreference'

type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void
const listeners = new Set<Listener>()
const store = new Map<string, unknown>()

function renderMenu() {
  return render(
    <TooltipProvider>
      <LanguageMenu />
    </TooltipProvider>
  )
}

beforeEach(() => {
  localStorage.clear()
  store.clear()
  listeners.clear()
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
})

describe('LanguageMenu', () => {
  it('shows the language in use as a short code, named for assistive technology', () => {
    renderMenu()
    const button = screen.getByRole('button', { name: 'Language (EN)' })
    expect(button).toHaveTextContent('EN')
  })

  it('lists Browser default first and checks the stored choice', async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: 'Language (EN)' }))
    const items = await screen.findAllByRole('menuitemradio')
    expect(items.map((i) => i.textContent)).toEqual([
      'Browser default', 'English', 'Deutsch', 'Español', 'Français', 'Italiano', 'Русский', '한국어', 'Türkçe', 'Bahasa Indonesia', 'Polski', 'Tiếng Việt', 'हिन्दी', '日本語', 'Português (Brasil)', '简体中文',
    ])
    expect(screen.getByRole('menuitemradio', { name: 'Browser default' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: '日本語' })).toHaveAttribute('lang', 'ja')
  })

  it('applies a pick at once, stores it in both places and updates <html lang>', async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: 'Language (EN)' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Français' }))
    await waitFor(() => expect(i18n.language).toBe('fr'))
    expect(localStorage.getItem(LOCALE_PREFERENCE_LOCAL_STORAGE_KEY)).toBe('fr')
    expect(store.get(LOCALE_PREFERENCE_STORAGE_KEY)).toBe('fr')
    expect(document.documentElement.lang).toBe('fr')
    expect(await screen.findByRole('button', { name: 'Langue (FR)' })).toBeInTheDocument()

    // and back to the browser's language (jsdom: en-US)
    await user.click(screen.getByRole('button', { name: 'Langue (FR)' }))
    expect(screen.getByRole('menuitemradio', { name: 'Français' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('menuitemradio', { name: 'Langue du navigateur' }))
    await waitFor(() => expect(i18n.language).toBe('en'))
    expect(localStorage.getItem(LOCALE_PREFERENCE_LOCAL_STORAGE_KEY)).toBeNull()
    expect(store.has(LOCALE_PREFERENCE_STORAGE_KEY)).toBe(false)
  })

  it('follows a choice saved on another extension page', async () => {
    const user = userEvent.setup()
    renderMenu()
    act(() => listeners.forEach((l) => l({ [LOCALE_PREFERENCE_STORAGE_KEY]: { newValue: 'de' } }, 'local')))
    await user.click(screen.getByRole('button', { name: 'Language (EN)' }))
    expect(await screen.findByRole('menuitemradio', { name: 'Deutsch' })).toHaveAttribute('aria-checked', 'true')
  })
})
