import {
  DEFAULT_LOCALE,
  LOCALE_NATIVE_NAMES as PUBLIC_LOCALE_NATIVE_NAMES,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '@tabmerger/shared'

/**
 * Locale lists for the web app. Pure data, no next-intl imports, so the proxy, metadata helpers,
 * the sitemap and tests can all read it.
 *
 * - `PUBLIC_LOCALES`: the shipped languages (`SUPPORTED_LOCALES` in `@tabmerger/shared`). These
 *   are the only ones in hreflang, the sitemap and the language switcher.
 * - `PSEUDO_LOCALE`: an accented, padded copy of English for layout stress tests. Routable only
 *   in development and tests (`next dev`, Vitest), never in a production build (`next build`
 *   sets NODE_ENV to "production", so it is not even in the locale list there).
 */
export const PUBLIC_LOCALES = SUPPORTED_LOCALES

export { DEFAULT_LOCALE }

export const PSEUDO_LOCALE = 'en-XA'

export const PSEUDO_LOCALE_ENABLED = process.env.NODE_ENV !== 'production'

export type AppLocale = SupportedLocale | typeof PSEUDO_LOCALE

/** Every routable locale on this build. */
export const LOCALES: readonly AppLocale[] = PSEUDO_LOCALE_ENABLED
  ? [...PUBLIC_LOCALES, PSEUDO_LOCALE]
  : PUBLIC_LOCALES

/**
 * Each locale's name in its own language, for the language switcher. The shipped ones come from
 * `@tabmerger/shared` (the extension's Settings lists the same names); the pseudo-locale is web-only.
 */
export const LOCALE_NATIVE_NAMES: Record<AppLocale, string> = {
  ...PUBLIC_LOCALE_NATIVE_NAMES,
  [PSEUDO_LOCALE]: 'Ëñğļîšĥ (pseudo)',
}

/** Open Graph `og:locale` values (language_TERRITORY). */
export const OG_LOCALES: Record<AppLocale, string> = {
  en: 'en_US',
  de: 'de_DE',
  es: 'es_419',
  fr: 'fr_FR',
  ja: 'ja_JP',
  'pt-BR': 'pt_BR',
  'zh-CN': 'zh_CN',
  [PSEUDO_LOCALE]: 'en_XA',
}

/**
 * Languages written right to left. None ships today; add e.g. 'ar', 'he', 'fa', 'ur' here when
 * one does (see docs/I18N.md for the layout work that needs).
 */
export const RTL_LOCALES: readonly string[] = []

export function localeDirection(locale: string): 'ltr' | 'rtl' {
  return RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr'
}

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/**
 * A path as the given locale serves it: unprefixed for the default locale (`localePrefix:
 * 'as-needed'`), `/<locale>/…` otherwise. `path` is an app path starting with "/".
 */
export function localizedPath(locale: string, path: string): string {
  if (locale === DEFAULT_LOCALE) return path
  return path === '/' ? `/${locale}` : `/${locale}${path}`
}

/**
 * hreflang alternates for a path: one entry per public locale plus `x-default` (the default
 * locale's URL). Only `en` today, so this is `{ en: path, 'x-default': path }`.
 */
export function languageAlternates(path: string): Record<string, string> {
  const languages: Record<string, string> = {}
  for (const locale of PUBLIC_LOCALES) languages[locale] = localizedPath(locale, path)
  languages['x-default'] = localizedPath(DEFAULT_LOCALE, path)
  return languages
}
