'use client'

import { Languages } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { getPathname, usePathname } from '@/i18n/navigation'
import { LOCALE_NATIVE_NAMES, PUBLIC_LOCALES, isAppLocale, type AppLocale } from '@/i18n/locales'
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

export interface LanguageMenuProps {
  /**
   * `compact` (default): a header button showing the languages icon and the current language's
   * code ("EN"). `row`: a full-width row for the mobile menu panel, with the current language's name.
   */
  variant?: 'compact' | 'row'
  className?: string
  /** Classes for the compact trigger's code, e.g. `hidden lg:inline` to show only the icon below lg. */
  codeClassName?: string
  /** Called just before the page is reloaded in the chosen language (the mobile panel closes itself). */
  onSwitch?: () => void
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

/**
 * The language picker: a menu listing each language by its own name (no flags: a flag is a
 * country, not a language), the current one checked. Use it through `LanguageSwitcher`, which
 * loads this module (and Radix's menu code) on demand.
 */
export function LanguageMenu({ variant = 'compact', className, codeClassName, onSwitch }: LanguageMenuProps) {
  const locale = useLocale()
  const pathname = usePathname()
  const t = useTranslations('languageSwitcher')
  const code = localeCode(locale)
  const language = isAppLocale(locale) ? LOCALE_NATIVE_NAMES[locale] : locale
  // Contains the visible text ("EN" / the language name), so a voice-control user can say it.
  const name = t('trigger', { language, code })

  function choose(next: string) {
    // Only a listed locale is ever navigated to.
    if (!isAppLocale(next) || next === locale) return
    onSwitch?.()
    switchLocale(next, pathname)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === 'row' ? (
          <button
            type="button"
            aria-label={name}
            className={cn(
              'flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-[0.875rem] text-text2 transition-colors hover:bg-surface2 hover:text-foreground',
              className
            )}
          >
            <Languages aria-hidden="true" className="size-4 shrink-0" />
            {t('label')}
            <span lang={locale} className="ml-auto text-[0.8125rem]">
              {language}
            </span>
          </button>
        ) : (
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
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={variant === 'row' ? 'start' : 'end'} className="min-w-[11rem]">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{t('label')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={locale} onValueChange={choose}>
          {PUBLIC_LOCALES.map((option) => (
            <DropdownMenuRadioItem key={option} value={option} lang={option}>
              {LOCALE_NATIVE_NAMES[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
