import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Creates a Supabase client that reads/writes the user's session cookie, respecting RLS.
 * Must be async because Next.js 15 made cookies() return a Promise — skipping await returns a stale object.
 * Use in Server Components and API routes where the request user's identity should be enforced.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
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
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
