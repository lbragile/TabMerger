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

/**
 * Old `*.vercel.app` hosts → their canonical custom-domain origin.
 *
 * The site moved to its own domain, but the old hosts stay up for good: extension
 * builds already in users' hands call their APIs. Public pages on an old host 308
 * to the same path on the new one (keeps links, bookmarks and search results
 * converging on one host).
 *
 * Fixed map, deliberately: no env var and nothing request-derived picks the
 * target, so a spoofed `Host` header can at most trigger a redirect to one of
 * these two origins. Only exact host names match — per-deployment
 * `tabmerger-<hash>-….vercel.app` hosts, localhost and `*.tabmerger.com` never
 * redirect.
 */
export const LEGACY_HOST_REDIRECTS: Readonly<Record<string, string>> = {
  'tabmerger.vercel.app': 'https://tabmerger.com',
  'tabmerger-preview.vercel.app': 'https://preview.tabmerger.com',
}

/**
 * Public, signed-out pages that move to the new host — matched exactly.
 *
 * Every route here renders the same for everyone and needs no session, so serving
 * it from the new host loses nothing. Image metadata routes (`/opengraph-image.png`,
 * `/twitter-image.png`, icons) and `favicon.ico` aren't listed: the matcher below
 * never runs the proxy for them.
 */
export const LEGACY_REDIRECT_EXACT_PATHS: ReadonlySet<string> = new Set([
  '/',
  '/pricing',
  '/features',
  '/faq',
  '/beta',
  '/changelog',
  '/contact',
  '/privacy',
  '/terms',
  '/uninstalled',
  '/llms.txt',
  '/robots.txt',
  '/sitemap.xml',
])

/** Public sections that move with everything under them (`/share/<slug>`, `/share/demo`). */
export const LEGACY_REDIRECT_PATH_PREFIXES: readonly string[] = ['/share']

/** True for `prefix` itself and anything under `prefix/`, never `prefixfoo`. */
function isUnderPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/**
 * The path to redirect to when `pathname` is a listed public page, else null.
 *
 * One trailing slash is dropped before matching (`/pricing/` → `/pricing`), and the
 * target uses the dropped form: the site serves slash-less URLs (no `trailingSlash`
 * in next.config.ts), so this saves the new host a second redirect. Matching is
 * case-sensitive, like the routes themselves.
 */
function legacyRedirectPath(pathname: string): string | null {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  if (LEGACY_REDIRECT_EXACT_PATHS.has(path)) return path
  return LEGACY_REDIRECT_PATH_PREFIXES.some((prefix) => isUnderPath(path, prefix)) ? path : null
}

/**
 * The canonical URL to 308 this request to, or null to serve it here.
 *
 * An allow-list, so it fails closed: only the public pages above move, and a new
 * route stays on the old host until someone adds it. Everything signed-in stays
 * where it is for now — `/dashboard`, `/account`, `/auth/*` and `/api/*`. Older
 * extension builds start magic-link sign-in at `<old host>/api/auth/callback`, so
 * the session cookie is set on the old host and the callback lands on that host's
 * `/dashboard`. Moving those pages would show those users a signed-out page, and
 * signing in again would end up on the old host the same way. A later change moves
 * the rest once most users run builds that sign in on the new domain.
 *
 * Also never redirected, for their own reasons:
 * - `/api/*` — a CORS preflight (OPTIONS) can't follow a redirect, and the PKCE
 *   callback must finish on the host whose cookie holds the verifier.
 * - `/firefox-beta/*` — Firefox's beta update check wants a direct response (the
 *   matcher already skips it).
 * - `/sentry-test` — a diagnostic page that belongs to the deployment it's on.
 *
 * Only the path and query are carried over, onto the fixed origin. They're set
 * via the `pathname`/`search` setters rather than `new URL(path, base)`: a path
 * like `//evil.com/x` parses as protocol-relative and would replace the origin.
 * The browser re-applies the `#fragment` itself.
 */
export function legacyHostRedirect(request: NextRequest): URL | null {
  const { pathname, search } = request.nextUrl
  const path = legacyRedirectPath(pathname)
  if (path === null) return null

  const rawHost = request.headers.get('host') ?? request.nextUrl.hostname
  // Strip the port (`host:443`); IPv6 literals never match the map anyway.
  const host = rawHost.trim().toLowerCase().replace(/:\d*$/, '')
  if (!Object.hasOwn(LEGACY_HOST_REDIRECTS, host)) return null

  const origin = new URL(LEGACY_HOST_REDIRECTS[host]).origin
  const target = new URL(origin)
  target.pathname = path
  target.search = search
  // Belt and braces: the setters can't move the origin, but never redirect off it.
  return target.origin === origin ? target : null
}

export async function proxy(request: NextRequest) {
  // First, before CORS and the Supabase client: an old host's public page has nothing to do here.
  const legacyTarget = legacyHostRedirect(request)
  if (legacyTarget) return NextResponse.redirect(legacyTarget, 308)

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
    // /firefox-beta/* is rewritten straight to the Vercel Blob store (next.config.ts) serving
    // the self-distributed Firefox beta .xpi/updates.json — it's public, unauthenticated, and
    // not one of the app's routes, so it should skip the Supabase session refresh entirely
    // rather than pay that cost (and risk of ever redirecting it) on every install/update check.
    '/((?!_next/static|_next/image|favicon.ico|firefox-beta/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
