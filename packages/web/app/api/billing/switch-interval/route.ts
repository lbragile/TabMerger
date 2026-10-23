import { NextResponse, type NextRequest } from 'next/server'
import { isBillingInterval, startPlanSwitch } from '@/lib/planSwitch'

/**
 * Moves the signed-in user's paid plan to the other billing interval (monthly ↔ yearly) by
 * returning a Billing Portal URL that opens on Stripe's "confirm plan change" page. Only the
 * interval can change here: the target is the same tier, and for Pro AI the same AI option, the
 * user already pays for, so this can't be used to reach a different (or unreleased) plan. The
 * subscription row is written by the webhook once Stripe confirms, never by this route.
 *
 * Body: `{ interval: 'monthly' | 'yearly' }`. Responds `{ url }`, or 400 (bad body / no billing
 * account), 401, 403 (no paid plan), 409 (already on that interval, or a switch is already
 * scheduled; `error` is shown to the user), 503 (price not configured). The work is shared with
 * `/api/billing/switch-plan` (startPlanSwitch() in lib/planSwitch.ts).
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { interval?: unknown } | null
  const interval = body?.interval
  if (!isBillingInterval(interval)) {
    return NextResponse.json({ error: 'interval must be "monthly" or "yearly"' }, { status: 400 })
  }
  return startPlanSwitch({ interval })
}
