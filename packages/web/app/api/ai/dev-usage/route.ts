import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'

/**
 * Dev-only: sets the authenticated user's `ai_usage.credits_used` for the
 * current UTC month to an exact value, so the real quota path in
 * `checkAndIncrementAIUsage` can be exercised end-to-end (near-cap, reset-to-0).
 *
 * Returns 404 outside `NODE_ENV === 'development'` — same gate as
 * `app/sentry-test/page.tsx` — before any auth work, so the route is not
 * discoverable in production.
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceRoleClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token)

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { count } = await request.json().catch(() => ({ count: undefined }))
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
    return NextResponse.json({ error: 'count must be a non-negative integer' }, { status: 400 })
  }

  // user_id comes only from the verified token — never from the request body.
  const month = new Date().toISOString().slice(0, 7)
  const { error } = await supabase
    .from('ai_usage')
    .upsert({ user_id: user.id, month, credits_used: count }, { onConflict: 'user_id,month' })

  if (error) {
    return NextResponse.json({ error: 'Failed to set usage' }, { status: 500 })
  }

  // Reset (count === 0) also clears test credit-pack purchases so the UI shows
  // /300 again — getEffectiveCap() adds this month's purchased credits to the base cap.
  // A non-zero "set to N" deliberately leaves purchases alone.
  if (count === 0) {
    const { error: purchaseError } = await supabase
      .from('ai_credit_purchases')
      .delete()
      .eq('user_id', user.id)
      .eq('month', month)

    if (purchaseError) {
      return NextResponse.json({ error: 'Failed to clear credit purchases' }, { status: 500 })
    }
  }

  return NextResponse.json({ count })
}
