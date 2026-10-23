import { NextResponse, type NextRequest } from 'next/server'
import { parsePlanSwitchBody, startPlanSwitch } from '@/lib/planSwitch'

/**
 * Moves the signed-in user's paid plan to another price: the plan (Pro ↔ Pro AI), the billing
 * interval, and for Pro AI the AI option (TabMerger's key `managed` ↔ the customer's own AI
 * provider key `byok`). The refund policy decides the timing (startPlanSwitch() in
 * lib/planSwitch.ts): an upgrade applies now with a prorated charge, through Stripe's "confirm
 * plan change" page or directly; a downgrade or shorter interval waits for the end of the paid
 * period and is never refunded or credited. The webhook records the new price, AI option and
 * credit allowance when Stripe changes it.
 *
 * Body: `{ tier?: 'pro' | 'proAi', interval?: 'monthly' | 'yearly', aiMode?: 'managed' | 'byok' }`,
 * at least one; a field left out keeps the current value (Pro → Pro AI defaults to managed).
 * Responds `{ url }` (portal), `{ applied: 'now', url }` or `{ applied: 'end_of_period',
 * effectiveAt, url }`, or 400 (bad body / no billing account), 401, 403 (no paid plan, or
 * `aiMode` for Pro), 409 (already on that price, a change is already scheduled, or the plan is
 * set to end; `error` is shown to the user), 503 (`ai_disabled` when the Pro AI option switched
 * to isn't on sale: managed needs NEXT_PUBLIC_AI_ENABLED, own key either that or
 * NEXT_PUBLIC_AI_BYOK_ENABLED; or the price is not configured), 500.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const target = parsePlanSwitchBody(body)
  if ('error' in target) {
    return NextResponse.json({ error: target.error }, { status: 400 })
  }
  return startPlanSwitch(target)
}
