import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { aiDisabledResponse } from '@/lib/ai-guard'
import { suggestSessions, type Tab } from '@/lib/ai'
import { checkAndIncrementAIUsage, CREDIT_COSTS } from '@/lib/ai-usage'

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

  const { allowed, remaining } = await checkAndIncrementAIUsage(supabase, user.id, CREDIT_COSTS.suggestSessions)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Pro AI subscription required or monthly limit reached' },
      { status: remaining === 0 ? 429 : 403 }
    )
  }

  const body = await request.json()
  const groups: { id: string; name: string; tabs: Tab[] }[] = body.groups

  if (!Array.isArray(groups) || groups.length === 0) {
    return NextResponse.json({ error: 'groups array required' }, { status: 400 })
  }

  try {
    const { message, staleGroupIds } = await suggestSessions(groups)
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
