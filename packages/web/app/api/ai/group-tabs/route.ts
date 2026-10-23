import { NextResponse, type NextRequest } from 'next/server'
import { aiDisabledResponse } from '@/lib/ai-guard'
import { runAiTask, groupTabsTask } from '@/lib/ai'
import { parseGroupTabsBody, readJsonBody } from '@/lib/ai-validation'
import { aiErrorResponse, aiJson, authenticateAiRequest, invalidRequest, resolveAiContext } from '@/lib/ai-route'

/**
 * Groups the caller's tabs into 2-6 named, coloured clusters.
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
  const input = parseGroupTabsBody(body)
  if (!input.ok) return invalidRequest(input.error)

  const ctx = await resolveAiContext(request, auth, body, 'groupTabs')
  if (ctx instanceof NextResponse) return ctx

  try {
    const { result, remaining } = await runAiTask(groupTabsTask(input.data), ctx)
    return aiJson({ groups: result }, remaining)
  } catch (err) {
    return aiErrorResponse(err, 'group-tabs')
  }
}
