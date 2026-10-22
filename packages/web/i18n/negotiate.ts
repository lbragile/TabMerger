/**
 * Picks a locale for a request that has no `[locale]` segment (`/auth/*`, the root 404 and 500):
 * the `NEXT_LOCALE` cookie next-intl sets when a visitor picks or is sent to a language, then the
 * browser's `Accept-Language`, then the default. The same order next-intl's own detection uses
 * for unprefixed localized URLs, so `/auth/sign-in` speaks the visitor's language without moving
 * to a prefixed URL (Supabase redirect allow-lists, email templates and the extension all point
 * at the unprefixed `/auth/*`).
 *
 * Pure (no Next APIs) so it can be tested directly.
 */

/** Cookie next-intl stores the visitor's locale in. */
export const LOCALE_COOKIE = 'NEXT_LOCALE'

/** How long the language choice is remembered: one year, in seconds. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/**
 * The locale cookie's attributes, shared by next-intl's routing config (the proxy sets the cookie
 * when a visitor lands on another language) and the language switcher's own write. next-intl's
 * default has no max-age, so the choice was lost when the browser closed.
 */
export const LOCALE_COOKIE_ATTRIBUTES = {
  name: LOCALE_COOKIE,
  maxAge: LOCALE_COOKIE_MAX_AGE,
  path: '/',
  sameSite: 'lax',
} as const

/** `document.cookie` value that stores `locale` with {@link LOCALE_COOKIE_ATTRIBUTES}. */
export function localeCookieString(locale: string): string {
  const { name, maxAge, path, sameSite } = LOCALE_COOKIE_ATTRIBUTES
  // Attribute names and values are case-insensitive: `SameSite=lax` is `SameSite=Lax`.
  return `${name}=${locale}; max-age=${maxAge}; path=${path}; SameSite=${sameSite}`
}

/** Longest `Accept-Language` header read; anything after is ignored. */
const MAX_ACCEPT_LANGUAGE_LENGTH = 512

/**
 * Language ranges from an `Accept-Language` header, best first (by `q`, then by order). Ranges
 * with `q=0` or that don't look like a language tag are dropped.
 */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return []
  return header
    .slice(0, MAX_ACCEPT_LANGUAGE_LENGTH)
    .split(',')
    .map((part, index) => {
      const [range, ...params] = part.trim().split(';')
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      const q = qParam ? Number(qParam.slice(2)) : 1
      return { range: range.trim(), q: Number.isFinite(q) ? q : 0, index }
    })
    .filter(({ range, q }) => q > 0 && /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/.test(range))
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map(({ range }) => range)
}

/**
 * A language tag with deprecated aliases replaced by their current form (`Intl.getCanonicalLocales`):
 * old Hebrew `iw` → `he` (Android and older Java send it), `in` → `id`, `ji` → `yi`. Unchanged
 * when the runtime rejects the tag. next-intl's own detection for the localized pages already
 * canonicalizes `Accept-Language` this way (`@formatjs/intl-localematcher`); this keeps the
 * unsegmented routes and the cookie in step. A no-op for a language that isn't in `locales`.
 */
export function canonicalTag(tag: string): string {
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? tag
  } catch {
    return tag
  }
}

/**
 * The supported locale for one language range: an exact match (case-insensitive), else the first
 * locale with the same primary language (`pt` or `pt-PT` → `pt-BR`, `zh-TW` → `zh-CN`). The range
 * is canonicalized first, so `iw-IL` matches `he`.
 */
function matchRange(range: string, locales: readonly string[]): string | undefined {
  const lower = canonicalTag(range).toLowerCase()
  const exact = locales.find((l) => l.toLowerCase() === lower)
  if (exact) return exact
  const base = lower.split('-')[0]
  return locales.find((l) => l.toLowerCase().split('-')[0] === base)
}

export function negotiateLocale(
  cookieLocale: string | undefined,
  acceptLanguage: string | null | undefined,
  locales: readonly string[],
  defaultLocale: string
): string {
  if (cookieLocale) {
    if (locales.includes(cookieLocale)) return cookieLocale
    const canonical = canonicalTag(cookieLocale)
    if (locales.includes(canonical)) return canonical
  }
  for (const range of parseAcceptLanguage(acceptLanguage)) {
    const match = matchRange(range, locales)
    if (match) return match
  }
  return defaultLocale
}
