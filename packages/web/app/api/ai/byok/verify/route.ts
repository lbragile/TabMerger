import { NextResponse, type NextRequest } from 'next/server'
import { AI_ERROR_CODES, resolveAiModel } from '@tabmerger/shared'
import { aiDisabledResponse } from '@/lib/ai-guard'
import { anthropicClient, mapAnthropicError } from '@/lib/ai'
import { modelChoiceOf, readJsonBody } from '@/lib/ai-validation'
import { aiError, aiErrorResponse, authenticateAiRequest, byokKeyOf, requireProAi } from '@/lib/ai-route'

/**
 * Checks a BYOK user's Anthropic key before the extension saves it.
 *
 * Requires an entitled Pro AI subscription on the BYOK option (403 `ai_plan_required`
 * otherwise) and a well-formed key in `X-Anthropic-Key` (400 `byok_key_missing`). The check is
 * a free `count_tokens` call on the key, against the model in the optional body field `model`
 * (default: the cheapest), so a key that cannot reach that model is reported too.
 *
 * Returns `{ ok: true }`, or a `byok_*` / `ai_*` error code: `byok_key_invalid` (400),
 * `byok_billing` (402), `byok_rate_limited` (503), `ai_model_invalid` (400), `ai_overloaded`
 * (503). The key is used for this one request and never logged or stored.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // AI feature flag kill switch — must stay first, before any auth/DB/Anthropic work.
  const aiDisabled = aiDisabledResponse()
  if (aiDisabled) return aiDisabled

  const auth = await authenticateAiRequest(request)
  if (auth instanceof NextResponse) return auth

  const sub = await requireProAi(auth.supabase, auth.user.id)
  if (sub instanceof NextResponse) return sub
  if (sub.aiMode !== 'byok') return aiError(403, AI_ERROR_CODES.planRequired)

  const key = byokKeyOf(request)
  if (!key) return aiError(400, AI_ERROR_CODES.byokKeyMissing)

  const model = resolveAiModel(modelChoiceOf(await readJsonBody(request)), 'nameGroup')
  if (!model) return aiError(400, AI_ERROR_CODES.modelInvalid)

  try {
    await anthropicClient('byok', key).messages.countTokens({
      model,
      messages: [{ role: 'user', content: 'ping' }],
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return aiErrorResponse(mapAnthropicError(err, 'byok'), 'byok-verify')
  }
}
