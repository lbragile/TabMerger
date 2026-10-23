import { NextResponse, type NextRequest } from 'next/server'
import { aiDisabledResponse } from '@/lib/ai-guard'
import { runAiTask, nameGroupTask } from '@/lib/ai'
import { parseNameGroupBody, readJsonBody } from '@/lib/ai-validation'
import { aiErrorResponse, aiJson, authenticateAiRequest, invalidRequest, resolveAiContext } from '@/lib/ai-route'

/**
 * Suggests a 2-4 word display name for a tab group from its tab titles and URLs.
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
  const input = parseNameGroupBody(body)
  if (!input.ok) return invalidRequest(input.error)

  const ctx = await resolveAiContext(request, auth, body, 'nameGroup')
  if (ctx instanceof NextResponse) return ctx

  try {
    const { result, remaining } = await runAiTask(nameGroupTask(input.data), ctx)
    return aiJson({ name: result }, remaining)
  } catch (err) {
    return aiErrorResponse(err, 'name-group')
  }
}
