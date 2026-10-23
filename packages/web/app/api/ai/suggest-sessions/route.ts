import { NextResponse, type NextRequest } from 'next/server'
import { aiDisabledResponse } from '@/lib/ai-guard'
import { runAiTask, suggestSessionsTask } from '@/lib/ai'
import { parseSuggestSessionsBody, readJsonBody } from '@/lib/ai-validation'
import { aiErrorResponse, aiJson, authenticateAiRequest, invalidRequest, resolveAiContext } from '@/lib/ai-route'

/**
 * Suggests how to consolidate saved groups, naming the groups the suggestion is about.
 * Called by the extension with its Supabase JWT as a Bearer token. Requires an entitled Pro AI
 * subscription; managed calls are metered in credits (the balance comes back in
 * `X-AI-Credits-Remaining`); own-key calls send the key in `X-AI-Key` and go to that key's
 * provider, unmetered. Optional body field `model`: `'auto'` or a model id of that provider. Request flow: see `lib/ai-route.ts`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // AI feature flag kill switch — must stay first, before any auth/DB/Anthropic work.
  const aiDisabled = aiDisabledResponse()
  if (aiDisabled) return aiDisabled

  const auth = await authenticateAiRequest(request)
  if (auth instanceof NextResponse) return auth

  // Validated before the plan check and any reservation, so a rejected body never costs anything.
  const body = await readJsonBody(request)
  const input = parseSuggestSessionsBody(body)
  if (!input.ok) return invalidRequest(input.error)

  const ctx = await resolveAiContext(request, auth, body, 'suggestSessions')
  if (ctx instanceof NextResponse) return ctx

  try {
    const { result, remaining } = await runAiTask(suggestSessionsTask(input.data), ctx)
    // `suggestion` is a deprecated alias for `message`, kept so the currently-shipped
    // extension banner (AIGroupSuggestion) keeps working against a newer server.
    return aiJson({ ...result, suggestion: result.message }, remaining)
  } catch (err) {
    return aiErrorResponse(err, 'suggest-sessions')
  }
}
