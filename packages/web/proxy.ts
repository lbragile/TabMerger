import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

export async function proxy(request: NextRequest) {
  // ponytail: createServerClient(undefined!, ...) throws synchronously ("supabaseUrl is
  // required") — unlike lib/stripe.ts (module scope, evaluated once per build), this
  // constructs on EVERY request, so a missing env var doesn't fail one build step, it 500s every
  // request through this matcher, including the E2E gate's dev server when repo secrets aren't
  // configured. There's also no safe-placeholder-host trick to reach for here (contrast
  // lib/supabase/server.ts's createClient, still unguarded — see report): the client is used
  // immediately below (auth.getUser()), not stashed for a caller to skip via a configured flag.
  // Fails OPEN (passes the request through unauthenticated) rather than closed: with no working
  // auth backend there is no way to actually authenticate anyone, so blocking every route
  // (including the public marketing pages this matcher also covers) would take the whole site
  // down for a config gap that's already loud elsewhere (missing env vars show up in CI/logs),
  // not a silent security hole in a properly configured deployment.
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('[TabMerger] Supabase env vars missing — proxy running unauthenticated, auth routes not enforced')
    return NextResponse.next()
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh auth token
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Protect app routes
  if (
    (pathname.startsWith('/dashboard') || pathname.startsWith('/account')) &&
    !user
  ) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/auth/sign-in'
    redirectUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(redirectUrl)
  }

  // Redirect authenticated users away from auth pages
  if (
    (pathname.startsWith('/auth/sign-in') ||
      pathname.startsWith('/auth/sign-up')) &&
    user
  ) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/dashboard'
    return NextResponse.redirect(redirectUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
