import { useLocale } from 'next-intl'
import { DEFAULT_LOCALE, isAppLocale } from '@/i18n/locales'
import { pageBreadcrumbJsonLd } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'

interface PageBreadcrumbJsonLdProps {
  /** The page's path without a locale prefix ("/pricing"). */
  path: string
  /** The page's short name in the request's language, as the navbar or footer labels it. */
  name: string
  /** English-only pages (Privacy, Terms): the trail uses the English URLs, like their canonical. */
  englishOnly?: boolean
}

/**
 * BreadcrumbList structured data (TabMerger › page) for a top-level page, in the request's locale.
 * Sync, so it fits inside sync and async pages alike.
 */
export function PageBreadcrumbJsonLd({ path, name, englishOnly }: PageBreadcrumbJsonLdProps) {
  const requested = useLocale()
  const locale = isAppLocale(requested) ? requested : DEFAULT_LOCALE
  return <JsonLd data={pageBreadcrumbJsonLd({ path, name, locale, englishOnly })} />
}
