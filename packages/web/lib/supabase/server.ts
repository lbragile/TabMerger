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
