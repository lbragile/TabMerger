import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentPlan } from '@/lib/currentPlan'

export const dynamic = 'force-dynamic'

/** Never stored by a shared cache: the answer is the signed-in visitor's own plan. */
const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * GET /api/plan[?pendingChange=1]: the signed-in visitor's plan as the plan listings show it
 * (`CurrentPlan` from lib/currentPlan.ts), read from the session cookie. The pricing page and the
 * home page's teaser are rendered ahead of time, the same for everyone, and ask for it in the
 * browser (`useVisitorPlan`), only when the browser holds a session.
 *
 * A guest (or an expired session) gets the guest plan. `pendingChange=1` also reads a plan change
 * already scheduled at Stripe (the pricing page). Display only: every billing route checks the
 * plan again on the server.
 *
 * 200 with the plan; 500 with no body when it can't be read (the page then shows the guest
 * listing, as the home page did when the server-side read failed).
 */
export async function GET(req: NextRequest) {
  const withPendingChange = req.nextUrl.searchParams.get('pendingChange') === '1'
  try {
    const plan = await getCurrentPlan({ withPendingChange })
    return NextResponse.json(plan, { headers: NO_STORE })
  } catch {
    return new NextResponse(null, { status: 500, headers: NO_STORE })
  }
}
