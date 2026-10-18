import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { isAppLocale, LOCALES } from '@/i18n/locales'

interface LocaleLayoutProps {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

/** Every routable locale (`en`, plus the pseudo-locale in development and tests). */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }))
}

/**
 * The translated site (marketing pages, dashboard, account). The proxy rewrites an unprefixed
 * path to the default locale (`/pricing` is served as `/en/pricing`), so `locale` always comes from
 * the URL and is untrusted: anything that isn't a routable locale is a 404. The `<html>` document
 * itself is the root layout's, which reads the same locale.
 */
export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params
  if (!isAppLocale(locale)) notFound()
  setRequestLocale(locale)
  return children
}
