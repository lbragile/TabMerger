import { NextResponse, type NextRequest } from 'next/server'
import { isBillingInterval, startPlanSwitch } from '@/lib/planSwitch'
import { rejectCrossOriginPost } from '@/lib/billingRequestGuard'

/**
 * Moves the signed-in user's paid plan to the other billing interval (monthly ↔ yearly) by
 * returning a Billing Portal URL that opens on Stripe's "confirm plan change" page. Only the
 * interval can change here: the target is the same tier, and for Pro AI the same AI option, the
 * user already pays for, so this can't be used to reach a different (or unreleased) plan. The
 * subscription row is written by the webhook once Stripe confirms, never by this route.
 *
 * Every option, own key included, goes through that page: monthly → yearly is charged there now,
 * prorated, and yearly → monthly is deferred by it to the end of the paid period, with no credit
 * (planChangeTiming() in lib/planChangeTiming.ts). The server never applies a price change itself.
 *
 * Body: `{ interval: 'monthly' | 'yearly' }`. Responds `{ url }`, or 400 (bad body / no billing
 * account), 401, 403 (no paid plan), 409 (already on that interval, a switch is already
 * scheduled, the plan is set to end, or `switch_needs_support`: a monthly → yearly upgrade whose
 * previewed invoice would leave a credit; `error` is shown to the user), 503 (price not configured, or `ai_disabled` when the
 * subscriber's Pro AI option isn't on sale, see aiAvailability()). The work is shared with
 * `/api/billing/switch-plan` (startPlanSwitch() in lib/planSwitch.ts).
 *
 * 403 `forbidden_origin` unless posted from a page of this origin (rejectCrossOriginPost() in
 * lib/billingRequestGuard.ts), checked before the body is read; 429 `rate_limited` past the
 * per-user billing limit (in startPlanSwitch()).
 */
export async function POST(request: NextRequest) {
  const crossOrigin = rejectCrossOriginPost(request)
  if (crossOrigin) return crossOrigin

  const body = (await request.json().catch(() => null)) as { interval?: unknown } | null
  const interval = body?.interval
  if (!isBillingInterval(interval)) {
    return NextResponse.json({ error: 'interval must be "monthly" or "yearly"' }, { status: 400 })
  }
  return startPlanSwitch({ interval })
}
