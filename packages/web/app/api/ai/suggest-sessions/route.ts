import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { aiDisabledResponse } from '@/lib/ai-guard'
import { suggestSessions } from '@/lib/ai'
import { checkAndIncrementAIUsage, CREDIT_COSTS } from '@/lib/ai-usage'
import { parseSuggestSessionsBody, readJsonBody } from '@/lib/ai-validation'

/**
 * Recommends a saved-session name and description based on the current tab groups.
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
  const input = parseSuggestSessionsBody(await readJsonBody(request))
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 })
  }

  const { allowed, remaining } = await checkAndIncrementAIUsage(supabase, user.id, CREDIT_COSTS.suggestSessions)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Pro AI subscription required or monthly limit reached' },
      { status: remaining === 0 ? 429 : 403 }
    )
  }

  try {
    const { message, staleGroupIds } = await suggestSessions(input.data)
    // `suggestion` is a deprecated alias for `message`, kept so the currently-shipped
    // extension banner (AIGroupSuggestion) keeps working against a newer server.
    return NextResponse.json({ message, staleGroupIds, suggestion: message }, {
      headers: { 'X-AI-Requests-Remaining': String(remaining) },
    })
  } catch (err) {
    console.error('AI suggest-sessions error:', err)
    return NextResponse.json(
      { error: 'Failed to suggest sessions' },
      { status: 500 }
    )
  }
}
