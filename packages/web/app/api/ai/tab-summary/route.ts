import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { aiDisabledResponse } from '@/lib/ai-guard'
import { summarizeTab } from '@/lib/ai'
import { checkAndIncrementAIUsage, CREDIT_COSTS } from '@/lib/ai-usage'
import { parseTabSummaryBody, readJsonBody } from '@/lib/ai-validation'

/**
 * Generates a one-sentence summary of a single tab for the hover preview tooltip.
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
  // Accepts `{ url, title }` (what the extension sends) or `{ tab: { id, title, url } }`.
  const input = parseTabSummaryBody(await readJsonBody(request))
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 })
  }

  const { allowed, remaining } = await checkAndIncrementAIUsage(supabase, user.id, CREDIT_COSTS.tabSummary)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Pro AI subscription required or monthly limit reached' },
      { status: remaining === 0 ? 429 : 403 }
    )
  }

  try {
    const summary = await summarizeTab(input.data)
    return NextResponse.json({ summary }, {
      headers: { 'X-AI-Requests-Remaining': String(remaining) },
    })
  } catch (err) {
    console.error('AI tab-summary error:', err)
    return NextResponse.json(
      { error: 'Failed to summarize tab' },
      { status: 500 }
    )
  }
}
