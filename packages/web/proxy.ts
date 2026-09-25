import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

/**
 * CORS for the browser extension's calls into /api/*.
 *
 * The extension calls ten API routes (analytics, the AI routes, the billing
 * portal). Every one except og-preview sends a JSON body or a `Bearer` token,
 * which makes the browser send an OPTIONS preflight first — and no route had
 * an OPTIONS handler or CORS headers, so all of them were blocked. Handled here,
 * once, rather than per route.
 *
 * Allowed by SCHEME, not by extension ID, deliberately:
 * - Firefox assigns each install a random `moz-extension://<uuid>`, so there is
 *   no stable Firefox ID to list.
 * - An unpacked Chrome dev build's ID is derived from its install path and
 *   differs per machine.
 *
 * That is safe because no credentials are allowed (no
 * Access-Control-Allow-Credentials), so a request from another extension carries
 * none of this site's cookies. Authenticated routes are gated by the Bearer token
 * the caller must already hold; CORS was never the access control for them. And
 * ordinary websites are not allowed — only extension origins.
 */
const EXTENSION_ORIGIN = /^(chrome-extension|moz-extension):\/\/[a-z0-9-]+$/i

export function extensionCorsHeaders(request: NextRequest): Record<string, string> | null {
  if (!request.nextUrl.pathname.startsWith('/api/')) return null
  const origin = request.headers.get('origin')
  if (!origin || !EXTENSION_ORIGIN.test(origin)) return null
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    // `*` would NOT cover Authorization — it must be named explicitly.
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    // The allowed origin is reflected per request, so caches must key on it.
    Vary: 'Origin',
  }
}

function withCors<T extends NextResponse>(response: T, cors: Record<string, string> | null): T {
  if (cors) for (const [k, v] of Object.entries(cors)) response.headers.set(k, v)
  return response
}

export async function proxy(request: NextRequest) {
  const cors = extensionCorsHeaders(request)
  // Answer the preflight directly: it carries no auth, and route handlers only
  // export POST/GET, so letting it through would 405.
  if (cors && request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: cors })
  }

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
    return withCors(NextResponse.next(), cors)
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

  // Headers set on the proxy's response are merged into the route's response,
  // which is what the browser checks against the preflight it already passed.
  return withCors(supabaseResponse, cors)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
