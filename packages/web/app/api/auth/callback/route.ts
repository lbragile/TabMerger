import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { safeRedirectPath } from '@/lib/utils'

/**
 * PKCE auth callback — exchanges the one-time code Supabase sends to this URL for a session cookie.
 * Called by Supabase after email sign-up or OAuth. Redirects to `next` param (default: /dashboard)
 * on success, or back to sign-in with an error flag on failure.
 * Uses x-forwarded-host in production to construct the correct redirect behind a proxy/Vercel.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // Only a path on this site is used as the destination; anything else lands on the default.
  const next = safeRedirectPath(searchParams.get('next'))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      const forwardedHost = request.headers.get('x-forwarded-host')
      const isLocalEnv = process.env.NODE_ENV === 'development'

      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`)
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`)
      } else {
        return NextResponse.redirect(`${origin}${next}`)
      }
    }
  }

  return NextResponse.redirect(`${origin}/auth/sign-in?error=auth_callback_failed`)
}
