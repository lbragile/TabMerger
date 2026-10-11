import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { aiDisabledResponse } from '@/lib/ai-guard'
import { nameGroup } from '@/lib/ai'
import { checkAndIncrementAIUsage, CREDIT_COSTS } from '@/lib/ai-usage'
import { parseNameGroupBody, readJsonBody } from '@/lib/ai-validation'

/**
 * Suggests a display name for a tab group based on its tab titles/URLs.
 * Called by the extension via Bearer-token auth. Requires Pro AI entitlement;
 * responds with 429 when the monthly request quota is exhausted, 403 if not subscribed.
 */
export async function POST(request: NextRequest) {
  // AI feature flag kill switch — must stay first, before any auth/DB/Anthropic work.
  const aiDisabled = aiDisabledResponse()
  if (aiDisabled) return aiDisabled

  const authHeader = request.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')

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

  // Validated before the usage check, so a rejected body never spends a credit.
  const input = parseNameGroupBody(await readJsonBody(request))
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 })
  }

  const { allowed, remaining } = await checkAndIncrementAIUsage(supabase, user.id, CREDIT_COSTS.nameGroup)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Pro AI subscription required or monthly limit reached' },
      { status: remaining === 0 ? 429 : 403 }
    )
  }

  try {
    const name = await nameGroup(input.data)
    return NextResponse.json({ name }, {
      headers: { 'X-AI-Requests-Remaining': String(remaining) },
    })
  } catch (err) {
    console.error('AI name-group error:', err)
    return NextResponse.json(
      { error: 'Failed to name group' },
      { status: 500 }
    )
  }
}
