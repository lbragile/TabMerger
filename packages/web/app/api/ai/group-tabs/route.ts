import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { aiDisabledResponse } from '@/lib/ai-guard'
import { groupTabs } from '@/lib/ai'
import { checkAndIncrementAIUsage, CREDIT_COSTS } from '@/lib/ai-usage'
import { parseGroupTabsBody, readJsonBody } from '@/lib/ai-validation'

/**
 * Groups an array of tabs into labelled clusters using the AI model.
 * Validates the caller's Supabase JWT from the Authorization header — the extension uses Bearer tokens
 * because it runs on a different origin and cannot share cookies with the web app.
 * Enforces Pro AI entitlement via checkAndIncrementAIUsage before calling the model.
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

  // Service role needed to validate an arbitrary JWT; anon client can only inspect its own session cookie
  const supabase = await createServiceRoleClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token)

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Validated before the usage check, so a rejected body never spends a credit.
  const input = parseGroupTabsBody(await readJsonBody(request))
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 })
  }

  const { allowed, remaining } = await checkAndIncrementAIUsage(supabase, user.id, CREDIT_COSTS.groupTabs)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Pro AI subscription required or monthly limit reached' },
      { status: remaining === 0 ? 429 : 403 }
    )
  }

  try {
    const groups = await groupTabs(input.data)
    return NextResponse.json({ groups }, {
      headers: { 'X-AI-Requests-Remaining': String(remaining) },
    })
  } catch (err) {
    console.error('AI group-tabs error:', err)
    return NextResponse.json(
      { error: 'Failed to group tabs' },
      { status: 500 }
    )
  }
}
