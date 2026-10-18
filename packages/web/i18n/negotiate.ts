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
 * The supported locale for one language range: an exact match (case-insensitive), else the first
 * locale with the same primary language (`pt` or `pt-PT` → `pt-BR`, `zh-TW` → `zh-CN`).
 */
function matchRange(range: string, locales: readonly string[]): string | undefined {
  const lower = range.toLowerCase()
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
  if (cookieLocale && locales.includes(cookieLocale)) return cookieLocale
  for (const range of parseAcceptLanguage(acceptLanguage)) {
    const match = matchRange(range, locales)
    if (match) return match
  }
  return defaultLocale
}
