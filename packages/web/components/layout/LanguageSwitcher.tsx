'use client'

import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from '@/i18n/navigation'
import { LOCALE_NATIVE_NAMES, PUBLIC_LOCALES, isAppLocale } from '@/i18n/locales'
import { cn } from '@/lib/utils'

/**
 * Picks the site's language. Each option is the language's own name (no flags: a flag is a
 * country, not a language). Switching keeps the current page (`/pricing` -> `/es/pricing`) and
 * next-intl stores the choice in its locale cookie.
 *
 * Renders nothing while only one language is public, so it adds nothing to today's layout.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const t = useTranslations('languageSwitcher')

  if (PUBLIC_LOCALES.length < 2) return null

  return (
    <label className={cn('flex items-center justify-center gap-2 text-sm text-muted-foreground', className)}>
      <span>{t('label')}</span>
      <select
        value={locale}
        onChange={(event) => {
          const next = event.target.value
          // Only a listed locale is ever navigated to.
          if (!isAppLocale(next) || next === locale) return
          router.replace(`${pathname}${window.location.search}${window.location.hash}`, { locale: next })
        }}
        className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
      >
        {PUBLIC_LOCALES.map((code) => (
          <option key={code} value={code} lang={code}>
            {LOCALE_NATIVE_NAMES[code]}
          </option>
        ))}
      </select>
    </label>
  )
}
