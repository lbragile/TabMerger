import { NextResponse, type NextRequest } from 'next/server'
import { aiDisabledResponse } from '@/lib/ai-guard'
import { describeGroupTask, runAiTask } from '@/lib/ai'
import { parseDescribeGroupBody, readJsonBody } from '@/lib/ai-validation'
import { aiErrorResponse, aiJson, authenticateAiRequest, invalidRequest, resolveAiContext } from '@/lib/ai-route'

/**
 * Describes a saved group in 1-3 plain sentences (at most `AI_MAX_GROUP_DESCRIPTION_LENGTH`
 * characters), which the extension writes into the group's note. Body:
 * `{ groupName, tabs: { title, url }[], model? }` (`AIDescribeGroupRequest`); answer
 * `{ description }` (`AIDescribeGroupResponse`).
 *
 * The group name and tabs come decrypted from the client: group content in Supabase is
 * end-to-end encrypted, so this route never reads it from the database.
 *
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
  const input = parseDescribeGroupBody(body)
  if (!input.ok) return invalidRequest(input.error)

  const ctx = await resolveAiContext(request, auth, body, 'describeGroup')
  if (ctx instanceof NextResponse) return ctx

  try {
    const { result, remaining } = await runAiTask(describeGroupTask(input.data), ctx)
    return aiJson({ description: result }, remaining)
  } catch (err) {
    return aiErrorResponse(err, 'describe-group')
  }
}
