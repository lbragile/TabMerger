import { NextResponse, type NextRequest } from 'next/server'
import { AI_ERROR_CODES, resolveAiModel } from '@tabmerger/shared'
import { aiDisabledResponse, aiModeDisabledResponse } from '@/lib/ai-guard'
import { anthropicClient, mapAnthropicError, mapOwnKeyProviderError } from '@/lib/ai'
import { verifyOpenAiOrGoogleKey } from '@/lib/ai-providers'
import { modelChoiceOf, readJsonBody } from '@/lib/ai-validation'
import {
  aiError,
  aiErrorResponse,
  authenticateAiRequest,
  byokKeyErrorResponse,
  byokKeyOf,
  requireProAi,
} from '@/lib/ai-route'

/**
 * Checks an own-key subscriber's API key before the extension saves it.
 *
 * Requires an entitled Pro AI subscription on the own-key option (403 `ai_plan_required`
 * otherwise) with that option live (503 `ai_disabled`), and a key in `X-AI-Key`: none → 400
 * `byok_key_missing`; not an Anthropic, OpenAI or Google key → 400 `byok_key_invalid`. The
 * provider is read from the key's shape.
 *
 * The check costs nothing: Anthropic `count_tokens`, OpenAI and Google a models GET. It runs
 * against the model in the optional body field `model` (default: that provider's cheapest), so
 * a key that cannot reach that model is reported too; a model of another provider → 400
 * `ai_model_invalid`.
 *
 * Returns `{ ok: true, provider }`, or a code: `byok_key_invalid` (400), `byok_billing` (402),
 * `byok_rate_limited` (503), `ai_model_invalid` (400), `ai_overloaded` (503). The key is used
 * for this one request and never logged or stored.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // AI feature flag kill switch — must stay first, before any auth/DB/provider work.
  const aiDisabled = aiDisabledResponse()
  if (aiDisabled) return aiDisabled

  const auth = await authenticateAiRequest(request)
  if (auth instanceof NextResponse) return auth

  const sub = await requireProAi(auth.supabase, auth.user.id)
  if (sub instanceof NextResponse) return sub
  if (sub.aiMode !== 'byok') return aiError(403, AI_ERROR_CODES.planRequired)
  const off = aiModeDisabledResponse('byok')
  if (off) return off

  const found = byokKeyOf(request)
  if (found.status !== 'ok') return byokKeyErrorResponse(found)

  const model = resolveAiModel(modelChoiceOf(await readJsonBody(request)), 'nameGroup', found.provider)
  if (!model) return aiError(400, AI_ERROR_CODES.modelInvalid)

  try {
    if (found.provider === 'anthropic') {
      try {
        await anthropicClient('byok', found.key).messages.countTokens({
          model,
          messages: [{ role: 'user', content: 'ping' }],
        })
      } catch (err) {
        throw mapAnthropicError(err, 'byok')
      }
    } else {
      try {
        await verifyOpenAiOrGoogleKey(found.provider, found.key, model)
      } catch (err) {
        throw mapOwnKeyProviderError(err)
      }
    }
    return NextResponse.json({ ok: true, provider: found.provider })
  } catch (err) {
    return aiErrorResponse(err, 'byok-verify')
  }
}
