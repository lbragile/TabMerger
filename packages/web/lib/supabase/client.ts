import { createBrowserClient } from '@supabase/ssr'

/**
 * True when real Supabase credentials were supplied. False in any build/environment missing
 * `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — callers that need to
 * distinguish "not configured" from a genuine auth failure can check this before calling out.
 */
export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
)

// ponytail: createBrowserClient(undefined!, ...) throws synchronously ("Your project's URL and
// API key are required") — same bug class as lib/stripe.ts and the extension's supabase.ts
// (commit d45989c). Every 'use client' page/component that calls createClient() at render time
// (auth/sign-in, auth/sign-up, auth/reset-password, auth/forgot-password, the Navbar, etc.) gets
// statically prerendered by `next build` for its initial HTML unless marked dynamic, so a missing
// env var crashed the build one route at a time (each fix just exposed the next one) instead of
// only disabling auth. `.invalid` is an RFC 2606-reserved TLD that can never resolve — the client
// constructs but any real request against it fails fast via a normal network error that callers'
// existing try/catch or `{ error }` handling already deals with.
const FALLBACK_URL = 'https://supabase-not-configured.invalid'
const FALLBACK_KEY = 'not-configured'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || FALLBACK_KEY
  )
}
