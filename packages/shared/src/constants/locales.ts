/**
 * The languages TabMerger ships, as BCP 47 tags. The web app (next-intl routing) reads them from
 * here; the extension can too. Add a locale here only once its catalog is complete: every entry is
 * a public, indexable language (sitemap, hreflang, language switcher).
 */
export const SUPPORTED_LOCALES = ['en', 'de', 'es', 'fr', 'ja', 'pt-BR', 'zh-CN'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** The language served when nothing else matches, and the one whose URLs carry no prefix. */
export const DEFAULT_LOCALE: SupportedLocale = 'en';

/** Narrows an untrusted value (a URL segment, a cookie) to a shipped locale. */
export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
