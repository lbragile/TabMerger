import { NextResponse, type NextRequest } from 'next/server'
import { AI_ERROR_CODES } from '@tabmerger/shared'
import { aiDisabledResponse } from '@/lib/ai-guard'
import { currentMonth } from '@/lib/ai-usage'
import { parseDevUsageBody, readJsonBody } from '@/lib/ai-validation'
import { aiError, authenticateAiRequest, invalidRequest } from '@/lib/ai-route'

/**
 * Dev-only: sets the authenticated user's `ai_usage.credits_used` for the
 * current UTC month to an exact value (in credits, 1 credit = $0.001 of AI
 * cost), so the real reserve/settle path (`ai_reserve_credits`) can be
 * exercised end-to-end (near-cap, reset-to-0).
 *
 * Returns 404 outside `NODE_ENV === 'development'` — same gate as
 * `app/sentry-test/page.tsx` — before any auth work, so the route is not
 * discoverable in production.
 */
export async function POST(request: NextRequest) {
  // AI feature flag kill switch — must stay first, before any auth/DB/Anthropic work.
  const aiDisabled = aiDisabledResponse()
  if (aiDisabled) return aiDisabled

  if (process.env.NODE_ENV !== 'development') {
    return aiError(404, AI_ERROR_CODES.notFound)
  }

  const auth = await authenticateAiRequest(request)
  if (auth instanceof NextResponse) return auth
  const { user, supabase } = auth

  const input = parseDevUsageBody(await readJsonBody(request))
  if (!input.ok) return invalidRequest(input.error)
  const count = input.data

  // user_id comes only from the verified token — never from the request body.
  const month = currentMonth()
  const { error } = await supabase
    .from('ai_usage')
    .upsert({ user_id: user.id, month, credits_used: count }, { onConflict: 'user_id,month' })

  if (error) {
    return aiError(500, AI_ERROR_CODES.failed, { message: 'Failed to set usage' })
  }

  // Reset (count === 0) also clears test credit-pack purchases so the UI shows the
  // plain monthly allowance again — getEffectiveCap() adds this month's purchased
  // credits to `subscriptions.ai_monthly_credits`.
  // A non-zero "set to N" deliberately leaves purchases alone.
  if (count === 0) {
    const { error: purchaseError } = await supabase
      .from('ai_credit_purchases')
      .delete()
      .eq('user_id', user.id)
      .eq('month', month)

    if (purchaseError) {
      return aiError(500, AI_ERROR_CODES.failed, { message: 'Failed to clear credit purchases' })
    }
  }

  return NextResponse.json({ count })
}
