import {
  DEFAULT_LOCALE,
  LOCALE_NATIVE_NAMES as PUBLIC_LOCALE_NATIVE_NAMES,
  RTL_LOCALES,
  SUPPORTED_LOCALES,
  isRtlLocale,
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
  it: 'it_IT',
  ru: 'ru_RU',
  ko: 'ko_KR',
  tr: 'tr_TR',
  id: 'id_ID',
  pl: 'pl_PL',
  vi: 'vi_VN',
  hi: 'hi_IN',
  'pt-BR': 'pt_BR',
  'zh-CN': 'zh_CN',
  ar: 'ar_AR',
  he: 'he_IL',
  fa: 'fa_IR',
  [PSEUDO_LOCALE]: 'en_XA',
}

/**
 * Languages written right to left (Arabic, Hebrew, Persian): `RTL_LOCALES` in `@tabmerger/shared`,
 * the one list the web app and the extension share. The root layout sets `<html dir="rtl">` for
 * these, which flips every logical utility (`ms-`, `ps-`, `inset-s-`, `text-start`, …), Radix
 * primitives (DirectionProvider) and picks the script's font (lib/fonts.ts). See docs/I18N.md,
 * "Right-to-left".
 */
export { RTL_LOCALES }

/** `rtl` for a right-to-left language (or a regional tag of one), else `ltr`. */
export function localeDirection(locale: string): 'ltr' | 'rtl' {
  return isRtlLocale(locale) ? 'rtl' : 'ltr'
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
