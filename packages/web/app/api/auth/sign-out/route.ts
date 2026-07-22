import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Signs the current user out by clearing their Supabase session cookie, then redirects to sign-in.
 * Called by the dashboard sign-out button. Uses POST to prevent CSRF via link prefetch.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  await supabase.auth.signOut()

  const origin = new URL(request.url).origin
  return NextResponse.redirect(`${origin}/auth/sign-in`, { status: 302 })
}
