import { NextResponse, type NextRequest } from 'next/server'
import { aiDisabledResponse } from '@/lib/ai-guard'
import { runAiTask, tabSummaryTask } from '@/lib/ai'
import { parseTabSummaryBody, readJsonBody } from '@/lib/ai-validation'
import { aiErrorResponse, aiJson, authenticateAiRequest, invalidRequest, resolveAiContext } from '@/lib/ai-route'

/**
 * Summarizes one tab in 1-2 sentences from its title and URL, for the hover preview.
 * Called by the extension with its Supabase JWT as a Bearer token. Requires an entitled Pro AI
 * subscription; managed calls are metered in credits (the balance comes back in
 * `X-AI-Credits-Remaining`), BYOK calls use the key in `X-Anthropic-Key`. Optional body field
 * `model`: `'auto'` or a model id from `AI_MODEL_IDS`. Request flow: see `lib/ai-route.ts`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // AI feature flag kill switch — must stay first, before any auth/DB/Anthropic work.
  const aiDisabled = aiDisabledResponse()
  if (aiDisabled) return aiDisabled

  const auth = await authenticateAiRequest(request)
  if (auth instanceof NextResponse) return auth

  // Validated before the plan check and any reservation, so a rejected body never costs anything.
  const body = await readJsonBody(request)
  const input = parseTabSummaryBody(body)
  if (!input.ok) return invalidRequest(input.error)

  const ctx = await resolveAiContext(request, auth, body, 'tabSummary')
  if (ctx instanceof NextResponse) return ctx

  try {
    const { result, remaining } = await runAiTask(tabSummaryTask(input.data), ctx)
    return aiJson({ summary: result }, remaining)
  } catch (err) {
    return aiErrorResponse(err, 'tab-summary')
  }
}
