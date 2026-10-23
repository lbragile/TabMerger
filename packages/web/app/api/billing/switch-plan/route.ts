import { NextResponse, type NextRequest } from 'next/server'
import { parsePlanSwitchBody, startPlanSwitch } from '@/lib/planSwitch'

/**
 * Moves the signed-in user's paid plan to another option of the same tier through the Billing
 * Portal's "confirm plan change" page: the billing interval, and for Pro AI the AI option
 * (TabMerger's key `managed` ↔ the customer's own key `byok`). The tier itself never changes here.
 * The webhook records the new price, AI option and credit allowance once Stripe confirms.
 *
 * Body: `{ interval?: 'monthly' | 'yearly', aiMode?: 'managed' | 'byok' }`, at least one; a field
 * left out keeps the current value. Responds `{ url }`, or 400 (bad body / no billing account),
 * 401, 403 (no paid plan, or `aiMode` for Pro), 409 (already on that price, or a change is
 * already scheduled; `error` is shown to the user), 503 (`ai_disabled` while AI is off and
 * `aiMode` is sent, or the price is not configured), 500.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const target = parsePlanSwitchBody(body)
  if ('error' in target) {
    return NextResponse.json({ error: target.error }, { status: 400 })
  }
  return startPlanSwitch(target)
}
