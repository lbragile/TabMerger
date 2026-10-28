import { NextResponse, type NextRequest } from 'next/server'
import { FORBIDDEN_ORIGIN_ERROR } from '@/lib/checkoutErrors'
import { rateLimitedResponse, takeRateLimit, type RateLimitBucket } from '@/lib/rateLimit'

/**
 * Guards shared by the billing POST routes that act on Stripe: checkout (plans and credit packs),
 * plan and interval switch, keep current plan, cancel subscription, and the Billing Portal session.
 */

/**
 * Per-user limit across all billing routes together: generous for a person clicking through
 * pricing and account pages, low enough that a script can't run up Stripe API calls (Stripe's
 * rate limit is per account, so one user's flood would slow everyone's checkout).
 *
 * Fails open (`onError: 'allow'`): if the limiter's database call fails, the request goes ahead and
 * the failure is logged. Every billing route still authenticates the user, checks ownership at
 * Stripe and creates nothing a click couldn't, so an unlimited minute costs little, while failing
 * closed would stop paying customers from subscribing, cancelling or reaching their invoices
 * whenever the limiter's table is unreachable.
 */
export const BILLING_RATE_LIMIT: RateLimitBucket = {
  name: 'billing',
  limits: [
    { windowSeconds: 60, max: 10 },
    { windowSeconds: 60 * 60, max: 60 },
  ],
  onError: 'allow',
}

/**
 * Counts one billing request for `userId`; returns the 429 `rate_limited` response (with
 * `Retry-After`) to send when the user is over the limit, else null. Call it after authentication
 * and before any Stripe call.
 */
export async function limitBillingRequest(userId: string): Promise<NextResponse | null> {
  const result = await takeRateLimit(BILLING_RATE_LIMIT, userId)
  return result.kind === 'limited' ? rateLimitedResponse(result.retryAfterSeconds) : null
}

/**
 * Rejects a cookie-authenticated POST that didn't come from a page of this same origin, with 403
 * `forbidden_origin`; returns null when it did. The session cookie is SameSite=Lax, which stops
 * other sites but not other subdomains of the same site (a preview deployment on
 * `preview.tabmerger.com` is "same-site" with `tabmerger.com`), so the origin is checked as well:
 *
 * - `Sec-Fetch-Site` (sent by every current browser) must be `same-origin`; `same-site`,
 *   `cross-site` and `none` are refused.
 * - Without it, `Origin` must equal this request's own origin.
 * - With neither, the request is refused: browsers send `Origin` on every cross-origin POST and on
 *   same-origin `fetch` POSTs, so a request with neither header isn't one of our pages.
 *
 * Only for routes authenticated by the session cookie. Not for the Stripe webhook (signed by
 * Stripe), Bearer-token routes the extension calls (a cookie isn't involved, and the extension's
 * origin differs) or GET routes.
 */
export function rejectCrossOriginPost(request: NextRequest): NextResponse | null {
  const site = request.headers.get('sec-fetch-site')
  if (site !== null) return site === 'same-origin' ? null : forbiddenOrigin()
  const origin = request.headers.get('origin')
  if (origin !== null && origin === request.nextUrl.origin) return null
  return forbiddenOrigin()
}

function forbiddenOrigin(): NextResponse {
  return NextResponse.json({ error: FORBIDDEN_ORIGIN_ERROR, code: FORBIDDEN_ORIGIN_ERROR }, { status: 403 })
}
