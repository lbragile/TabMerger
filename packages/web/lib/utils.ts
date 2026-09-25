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
 * Resolves the base URL to use for Stripe redirect targets (checkout success/cancel, billing
 * portal return). Must run server-side, at request time (not build time), because Vercel Preview
 * deployments each get a unique hostname with no stable per-branch alias for CLI/--prebuilt
 * deploys from CI — a single build-time constant is either wrong for every preview or (worse)
 * sends preview checkouts back to production.
 *
 * Deliberately does NOT read the incoming request's Host / x-forwarded-host / nextUrl.origin —
 * those are attacker-controllable on some proxies and would open a host-header/open-redirect
 * surface on a Stripe redirect target. Only Vercel-set environment variables are trusted.
 *
 * Resolution order:
 * 1. VERCEL_ENV === 'preview' && VERCEL_URL set -> https://${VERCEL_URL} (this deployment's own
 *    host, so a preview checkout returns to the same preview it was started from).
 * 2. NEXT_PUBLIC_APP_URL, validated. Note this is inlined at BUILD time (NEXT_PUBLIC_* convention)
 *    so it's correct for local dev / production but can't vary per preview deploy — that's exactly
 *    why step 1 takes priority in preview.
 * 3. https://${VERCEL_URL} if set (production/other Vercel environments as a fallback if
 *    NEXT_PUBLIC_APP_URL is missing/invalid).
 * 4. Throws — never silently fall back to localhost in a deployed environment, and never hand
 *    Stripe an invalid success_url/cancel_url/return_url.
 */
function resolveBaseUrl(): string {
  // VERCEL_ENV / VERCEL_URL are NOT NEXT_PUBLIC_* — they're only readable server-side, and read
  // at runtime rather than inlined at build time, which is exactly what per-deployment resolution needs.
  const vercelEnv = process.env.VERCEL_ENV
  const vercelUrl = process.env.VERCEL_URL

  if (vercelEnv === 'preview' && vercelUrl) {
    return `https://${vercelUrl}`
  }

  const validated = validateBaseUrl(process.env.NEXT_PUBLIC_APP_URL)
  if (validated) return validated

  // NOT in production. There, a missing/invalid NEXT_PUBLIC_APP_URL must fail closed: falling
  // back to the deployment's *.vercel.app host would silently send paying customers back to a
  // URL that may sit behind deployment protection and doesn't carry their session cookies
  // (those belong to the real domain). A hard error on a misconfigured production env is far
  // better than quietly misdirecting billing traffic. (payments-security-reviewer, 2026-09-24)
  if (vercelUrl && vercelEnv !== 'production') {
    return `https://${vercelUrl}`
  }

  throw new Error(
    'absoluteUrl: could not resolve a base URL. Set NEXT_PUBLIC_APP_URL to a valid absolute ' +
      'http(s) URL (e.g. https://tabmerger.app or http://localhost:3000 for local dev), or rely ' +
      'on VERCEL_URL when deployed on Vercel.'
  )
}

export function absoluteUrl(path: string): string {
  return `${resolveBaseUrl()}${path}`
}
