'use client'

import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Languages, PilcrowLeft } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { filterLocales, isRtlLocale as isRtl, localeNameIn } from '@tabmerger/shared'
import { getPathname, usePathname } from '@/i18n/navigation'
import { LOCALE_NATIVE_NAMES, PUBLIC_LOCALES, isAppLocale, localeDirection, type AppLocale } from '@/i18n/locales'
import { localeCookieString } from '@/i18n/negotiate'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useDirection } from '@/components/DirectionProvider'

/**
 * The trigger is a header button: the languages icon and the current language's code ("EN"),
 * at every width (on phones too, beside the theme toggle). With the code hidden it is the same
 * 2.25rem bordered square as the theme toggle.
 */
export interface LanguageMenuProps {
  className?: string
  /** Classes for the trigger's code, e.g. `hidden lg:inline` to show only the icon below lg. */
  codeClassName?: string
}

/** "EN", "DE", "PT" (for pt-BR), "ZH" (for zh-CN): the language part of a locale, upper-cased. */
export function localeCode(locale: string): string {
  return locale.split('-')[0].toUpperCase()
}

/**
 * Loads the current page in `next`: same path, query string and hash, locale prefix swapped
 * (`/pricing` -> `/de/pricing`, `/de/pricing` -> `/pricing` for English).
 *
 * A full page load, not a client-side `router.replace`: `<html lang dir>` and the
 * `NextIntlClientProvider` (locale and client messages) belong to the root layout, which a
 * client-side navigation never re-renders, so after a soft switch the document kept `lang="en"`
 * and every Client Component kept its English strings and formatting.
 *
 * The `NEXT_LOCALE` cookie is written first, with the attributes the routing config gives
 * next-intl (one year, path `/`, SameSite Lax): with locale detection on, an unprefixed English
 * URL would otherwise be redirected back to the old language's prefix by the proxy.
 */
export function switchLocale(next: AppLocale, pathname: string): void {
  document.cookie = localeCookieString(next)
  const { search, hash } = window.location
  window.location.replace(`${getPathname({ href: pathname, locale: next })}${search}${hash}`)
}

/** A key that types a character: not a shortcut, not Space (which picks the focused language). */
function isTypingKey(event: KeyboardEvent): boolean {
  return event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey
}

/**
 * The language picker: a menu listing each language by its own name (no flags: a flag is a
 * country, not a language), the current one checked. Use it through `LanguageSwitcher`, which
 * loads this module (and Radix's menu code) on demand.
 *
 * The list scrolls under a search field, which has focus when the menu opens. The field matches
 * native, English and page-language names, codes and old aliases (`filterLocales` in
 * `@tabmerger/shared`: "heb", "farsi", "iw", "deutsch"). Keys typed in it stay in it: they never
 * reach Radix's menu typeahead. ArrowDown moves into the list (ArrowUp from the first language
 * comes back), Enter picks the first match, Escape closes. A letter typed while a language has
 * focus goes back to the field. On open, the current language (checked) is scrolled into view.
 *
 * Still a Radix DropdownMenu with `menuitemradio` items: the field is a menu's extra child, a
 * common compromise that keeps the menu's roving focus, check marks and dismissal.
 */
export function LanguageMenu({ className, codeClassName }: LanguageMenuProps) {
  const locale = useLocale()
  const pathname = usePathname()
  const t = useTranslations('languageSwitcher')
  const code = localeCode(locale)
  const language = isAppLocale(locale) ? LOCALE_NATIVE_NAMES[locale] : locale
  // Contains the visible text ("EN" / the language name), so a voice-control user can say it.
  const name = t('trigger', { language, code })
  const [query, setQuery] = useState('')
  const matches = useMemo(() => filterLocales(query, PUBLIC_LOCALES, locale), [query, locale])
  // Each language's name in the page's language: the muted second name on its row.
  const secondaryNames = useMemo(
    () => Object.fromEntries(PUBLIC_LOCALES.map((option) => [option, localeNameIn(option, locale)])),
    [locale]
  )
  const pageDir = useDirection()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // On open the search field takes focus as it mounts (a ref runs during the commit, before the
  // menu's focus scope looks for something to focus, and that scope leaves focus where it is when
  // it is already inside the menu). Stable callbacks: they run once per mount, never on a re-render
  // that would pull focus back from a language.
  const attachInput = useCallback((el: HTMLInputElement | null) => {
    inputRef.current = el
    el?.focus()
  }, [])
  // The current language, checked, scrolled into view on open. Not at mount: the list only gets
  // its capped height once Radix has placed the menu (the max-height uses the available height
  // Radix measures), and until then there is nothing to scroll. So the list's size is watched,
  // and each time it changes the checked row is brought into view, until the visitor scrolls or
  // types: after that a size change (the list growing back when the search is cleared) must not
  // jump the scroll. Focus stays in the search field; `scrollIntoView` doesn't move it.
  const revealObserver = useRef<ResizeObserver | null>(null)
  const stopRevealing = useCallback(() => {
    revealObserver.current?.disconnect()
    revealObserver.current = null
  }, [])
  const attachList = useCallback(
    (el: HTMLDivElement | null) => {
      listRef.current = el
      stopRevealing()
      if (!el) return
      const reveal = () =>
        el.querySelector<HTMLElement>('[data-state="checked"]')?.scrollIntoView?.({ block: 'nearest' })
      reveal()
      if (typeof ResizeObserver === 'undefined') return
      revealObserver.current = new ResizeObserver(reveal)
      revealObserver.current.observe(el)
    },
    [stopRevealing]
  )

  function choose(next: string) {
    // Only a listed locale is ever navigated to.
    if (!isAppLocale(next) || next === locale) return
    switchLocale(next, pathname)
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      listRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      if (matches[0]) choose(matches[0])
    } else if (event.key !== 'Escape' && event.key !== 'Tab') {
      // Letters, Space, Backspace, Home/End edit the field. Radix's menu would otherwise read a
      // letter as typeahead (moving focus to a language) and Space as picking one.
      event.stopPropagation()
    }
  }

  /** A letter typed while a language (or the menu itself) has focus goes to the search field. */
  function onContentKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target === inputRef.current || !isTypingKey(event)) return
    // Not prevented: with focus moved during keydown, the browser types the letter into the field.
    event.stopPropagation()
    inputRef.current?.focus()
  }

  return (
    <DropdownMenu
      onOpenChange={(next) => {
        if (!next) setQuery('')
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={name}
          // h-9, rounded-md and border-border2 like the theme toggle beside it; icon-only (code
          // hidden) it is the same 2.25rem square.
          className={cn(
            'h-9 gap-1.5 border-border2 px-[0.5625rem] text-text2 hover:bg-surface2 hover:text-foreground',
            className
          )}
        >
          <Languages aria-hidden="true" className="size-4 shrink-0" />
          <span className={cn('text-[0.8125rem] font-medium', codeClassName)}>
            {code}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        // Kept 1rem from the screen's edges (Radix moves it back in), and no taller or wider than
        // the room Radix measured beside the trigger or the viewport less that margin: on a phone
        // (320px up) or a short window the list scrolls inside the menu instead of running off
        // the screen. 19rem fits the longest placeholder ("Rechercher par code de langue (ex. de, he)").
        collisionPadding={16}
        className="flex w-[min(19rem,var(--radix-dropdown-menu-content-available-width))] max-w-[calc(100vw-2rem)] max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] flex-col"
        onKeyDownCapture={onContentKeyDownCapture}
      >
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{t('label')}</DropdownMenuLabel>
        <div className="px-1 pb-1">
          <input
            ref={attachInput}
            type="search"
            // The page's direction while empty, so the placeholder reads in it; what is typed
            // then keeps its own ("heb" runs left to right on a Hebrew page).
            dir={query ? 'auto' : pageDir}
            value={query}
            onChange={(event) => {
              stopRevealing()
              setQuery(event.target.value)
            }}
            onKeyDown={onSearchKeyDown}
            aria-label={t('searchLabel')}
            placeholder={t('searchPlaceholder')}
            autoComplete="off"
            spellCheck={false}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-[0.8125rem] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <DropdownMenuSeparator />
        {/* Only the list scrolls: the label and the search stay put above it. A thin scrollbar in
            the theme's muted colour (light and dark), not the platform's default one. */}
        <div
          ref={attachList}
          // The visitor's own scrolling (wheel, touch, scrollbar, arrow keys) ends the reveal above.
          onWheel={stopRevealing}
          onTouchStart={stopRevealing}
          onPointerDown={stopRevealing}
          onKeyDown={stopRevealing}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin] [scrollbar-color:hsl(var(--muted-foreground)/0.35)_transparent]"
        >
          {matches.length === 0 ? (
            <p role="status" className="px-2 py-1.5 text-[0.8125rem] text-muted-foreground">
              {t('noResults')}
            </p>
          ) : (
            <DropdownMenuRadioGroup value={locale} onValueChange={choose}>
              {matches.map((option, index) => (
                <DropdownMenuRadioItem
                  key={option}
                  value={option}
                  lang={option}
                  // Compact rows, the check mark in a fixed 1.75rem start column (the primitive's
                  // `inset-s-2` indicator) so every name starts at the same place.
                  className="gap-3 py-1 ps-7 pe-2 text-[0.8125rem]"
                  onKeyDown={
                    index === 0
                      ? (event) => {
                          // Up from the first language: back to the search field.
                          if (event.key !== 'ArrowUp') return
                          event.preventDefault()
                          inputRef.current?.focus()
                        }
                      : undefined
                  }
                >
                  {/* Each native name in its own direction, isolated from the menu's: "Português
                      (Brasil)" keeps its closing parenthesis in a Hebrew menu. The row (padding,
                      check mark) follows the page. */}
                  <span dir={localeDirection(option)} className="min-w-0 truncate">
                    {LOCALE_NATIVE_NAMES[option]}
                  </span>
                  {/* The end of the row, in the page's language (`lang` undoes the row's): the name
                      in that language, muted, then a fixed slot that holds the right-to-left mark
                      or nothing, so the names line up either way. A screen reader hears
                      "עברית, Hebrew, right-to-left": the commas are sr-only. */}
                  <span lang={locale} className="ms-auto flex shrink-0 items-center gap-2 text-muted-foreground">
                    {secondaryNames[option] && (
                      <>
                        {/* The space is its own node: a trailing space inside the sr-only span is
                            dropped from the accessible name ("Deutsch,German"). A flex container
                            doesn't lay out whitespace, so it adds no gap. */}
                        <span className="sr-only">,</span>{' '}
                        <span className="text-[0.75rem]">{secondaryNames[option]}</span>
                      </>
                    )}
                    <span className="flex w-3.5 justify-center" title={isRtl(option) ? t('rightToLeft') : undefined}>
                      {isRtl(option) && (
                        <>
                          <PilcrowLeft aria-hidden="true" className="size-3.5" data-testid="rtl-indicator" />
                          <span className="sr-only">, {t('rightToLeft')}</span>
                        </>
                      )}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
