import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * True when real Supabase credentials were supplied. False in any build/environment missing
 * `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — mirrors
 * `lib/supabase/client.ts`'s `isSupabaseConfigured` for the server-side (RSC/route-handler) client.
 */
export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
)

// ponytail: same bug class as lib/supabase/client.ts (commit de838ee) —
// createServerClient(undefined!, ...) throws synchronously ("Your project's URL and Key are
// required to create a Supabase client!"). Unlike the browser client, every caller here runs on
// EVERY request, not just a prerendered one: Navbar (components/layout/Navbar.tsx) is a Server
// Component in the shared marketing layout and calls createClient() unconditionally, so a missing
// env var 500'd every single page, not just one build step. `.invalid` is an RFC 2606-reserved TLD
// that can never resolve — the client constructs, but any real request against it fails via a
// normal network error. auth-js wraps every such call in try/catch (GoTrueClient._getUser /
// lib/fetch.ts's _handleRequest), so `auth.getUser()` degrades to `{ data: { user: null }, error }`
// instead of throwing — every caller in this codebase already treats `!user` as signed-out (see
// Navbar, app/(app)/layout.tsx's redirect, and the `if (!user) return ...`/401 checks in the API
// routes under app/api/), so this degrades to "signed out", not an auth bypass.
const FALLBACK_URL = 'https://supabase-not-configured.invalid'
const FALLBACK_KEY = 'not-configured'

/**
 * Creates a Supabase client that reads/writes the user's session cookie, respecting RLS.
 * Must be async because Next.js 15 made cookies() return a Promise — skipping await returns a stale object.
 * Use in Server Components and API routes where the request user's identity should be enforced.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || FALLBACK_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll called from a Server Component — cookies cannot be set here.
          }
        },
      },
      auth: {
        // ponytail: no middleware.ts exists to persist a refreshed session, and setAll above
        // already discards every cookie write from a Server Component — so an auto-refresh
        // here can never succeed. Left enabled, GoTrue still attempts (and logs) a refresh
        // against any stale/invalid refresh-token cookie on every request, e.g. the public
        // /share/[slug] page via the Navbar server component. Disabling it is a no-op for
        // working sessions and removes the pointless failed-refresh noise for everyone else.
        autoRefreshToken: false,
      },
    }
  )
}

/**
 * Creates a Supabase client using the service role key, bypassing RLS entirely.
 * Required when there is no authenticated user (e.g. Stripe webhooks) or when validating
 * an arbitrary JWT (e.g. AI routes called by the extension). Never expose to client components.
 */
export async function createServiceRoleClient() {
  const { createClient } = await import('@supabase/supabase-js')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || FALLBACK_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
