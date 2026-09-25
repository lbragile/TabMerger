import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(date))
}

export function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount)
}

/**
 * Validates a candidate base URL string: must parse as an absolute http(s) URL with no
 * embedded whitespace or stray quote characters (both symptoms of a misconfigured env var —
 * e.g. a value copy-pasted with surrounding quotes, or a placeholder like "<APP_URL>").
 * Returns the parsed URL with any trailing slash stripped, or null if invalid.
 */
function validateBaseUrl(candidate: string | undefined): string | null {
  if (!candidate) return null
  const trimmed = candidate.trim()
  if (trimmed !== candidate) return null // embedded/surrounding whitespace
  if (/["'\s]/.test(trimmed)) return null // stray quotes or internal whitespace

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  // A base URL is an origin, nothing more. Reject userinfo (`https://evil@host`) and any
  // path/query/fragment rather than silently dropping them: `https://app.com/foo?x=1` would
  // otherwise yield `https://app.com/foo?x=1/pricing`, and a stray path is itself a sign the
  // variable was mis-pasted.
  if (parsed.username || parsed.password) return null
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) return null

  return parsed.origin
}

/**
 * Resolves the base URL for Stripe redirect targets (checkout success/cancel, billing portal
 * return): NEXT_PUBLIC_APP_URL, validated, set per Vercel environment — the real domain in
 * Production, the fixed alias https://tabmerger-preview.vercel.app in Preview (CI points it at
 * each new preview deploy, see .github/workflows/deploy-web.yml), localhost in local dev.
 *
 * Deliberately does NOT read VERCEL_URL. It used to, back when previews had only a hashed
 * per-deployment host; with a fixed preview alias it's no longer needed, and the hashed host
 * was the wrong target anyway — it carries none of the alias's session cookies.
 *
 * Also deliberately does NOT read the incoming request's Host / x-forwarded-host /
 * nextUrl.origin — those are attacker-controllable on some proxies and would open a
 * host-header/open-redirect surface on a Stripe redirect target.
 *
 * Throws when the variable is missing or invalid: never silently fall back to localhost in a
 * deployed environment, and never hand Stripe an invalid success_url/cancel_url/return_url.
 */
function resolveBaseUrl(): string {
  const validated = validateBaseUrl(process.env.NEXT_PUBLIC_APP_URL)
  if (validated) return validated

  throw new Error(
    'absoluteUrl: could not resolve a base URL. Set NEXT_PUBLIC_APP_URL to a valid absolute ' +
      'http(s) URL (e.g. https://tabmerger.app, https://tabmerger-preview.vercel.app for ' +
      'previews, or http://localhost:3000 for local dev).'
  )
}

export function absoluteUrl(path: string): string {
  return `${resolveBaseUrl()}${path}`
}
