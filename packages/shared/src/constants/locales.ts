/**
 * The languages TabMerger ships, as BCP 47 tags. The web app (next-intl routing) reads them from
 * here; the extension can too. Add a locale here only once its catalog is complete: every entry is
 * a public, indexable language (sitemap, hreflang, language switcher).
 */
export const SUPPORTED_LOCALES = ['en', 'de', 'es', 'fr', 'it', 'ru', 'ko', 'tr', 'id', 'pl', 'vi', 'hi', 'ja', 'pt-BR', 'zh-CN', 'ar', 'he', 'fa'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** The language served when nothing else matches, and the one whose URLs carry no prefix. */
export const DEFAULT_LOCALE: SupportedLocale = 'en';

/** Narrows an untrusted value (a URL segment, a cookie) to a shipped locale. */
export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Languages written right to left: Arabic, Hebrew and Persian. The web app sets `<html dir="rtl">`
 * for these; both language pickers mark them so a reader can tell the layout will mirror. A
 * `string[]` so a tag can be listed before its catalog ships (it only takes effect once routable).
 */
export const RTL_LOCALES: readonly string[] = ['ar', 'he', 'fa'];

/** Whether a locale tag (`he`, `ar-EG`, …) is written right to left; matches on the base language. */
export function isRtlLocale(locale: string): boolean {
  return RTL_LOCALES.includes(locale) || RTL_LOCALES.includes(locale.split('-')[0].toLowerCase());
}

/**
 * Each shipped language's name in its own language, for language pickers (the web app's switcher,
 * the extension's Settings). Never translated: a reader finds their language by its own name.
 */
export const LOCALE_NATIVE_NAMES: Readonly<Record<SupportedLocale, string>> = {
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  ja: '日本語',
  it: 'Italiano',
  ru: 'Русский',
  ko: '한국어',
  tr: 'Türkçe',
  id: 'Bahasa Indonesia',
  pl: 'Polski',
  vi: 'Tiếng Việt',
  hi: 'हिन्दी',
  'pt-BR': 'Português (Brasil)',
  'zh-CN': '简体中文',
  ar: 'العربية',
  he: 'עברית',
  fa: 'فارسی',
};
