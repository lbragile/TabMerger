import { NextResponse, type NextRequest } from 'next/server'
import { AI_ERROR_CODES, resolveAiModel } from '@tabmerger/shared'
import { aiDisabledResponse, aiModeDisabledResponse } from '@/lib/ai-guard'
import { AiRouteError, anthropicClient, deadlineOptions, mapAnthropicError, mapOwnKeyProviderError } from '@/lib/ai'
import { aiMockEnabled, mockVerifyKey, withAiMockHeader } from '@/lib/ai-mock'
import { verifyOpenAiOrGoogleKey } from '@/lib/ai-providers'
import {
  AI_BYOK_VERIFY_RATE_LIMIT,
  acquireAiSlot,
  byokKeyFailureGate,
  limitAiByIp,
  limitAiByUser,
  recordByokKeyFailure,
} from '@/lib/ai-request-limits'
import { AI_MAX_BODY_BYTES_SMALL, modelChoiceOf, readJsonBodyWithin } from '@/lib/ai-validation'
import {
  aiDeadline,
  aiError,
  aiErrorResponse,
  aiSlotLeaseSeconds,
  authenticateAiRequest,
  bodyRefused,
  byokKeyErrorResponse,
  byokKeyOf,
  requireProAi,
} from '@/lib/ai-route'

/**
 * Seconds Vercel lets this function run (a literal: Next reads it statically). A key check is
 * one cheap provider call: OpenAI and Google time out after 15 s, and Anthropic's count_tokens
 * gets the time left before the deadline 20 s earlier (`aiDeadline`).
 */
export const maxDuration = 45

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
 *
 * Limits (see `lib/ai-request-limits.ts`): the per-IP limit before auth, then its own per-user
 * bucket (`AI_BYOK_VERIFY_RATE_LIMIT`, much tighter than the model routes', so it can't be used
 * as a key checker), a 4 KB body cap, the own-key failure gate shared with the model routes
 * (`AI_BYOK_KEY_FAILURE_LIMIT`: a rejected or unfunded key counts one failure) and a concurrency
 * slot.
 *
 * Dev AI mock (`AI_MOCK=true` in local development, see `lib/ai-mock.ts`): no provider call; any
 * key that passes the format check is accepted, unless an `AI_MOCK_SCENARIO` error is set.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now()

  // AI feature flag kill switch: must stay first, before any limiter, auth, DB or provider work.
  const aiDisabled = aiDisabledResponse()
  if (aiDisabled) return aiDisabled

  const ipLimited = await limitAiByIp(request)
  if (ipLimited) return ipLimited

  const auth = await authenticateAiRequest(request)
  if (auth instanceof NextResponse) return auth

  const userLimited = await limitAiByUser(AI_BYOK_VERIFY_RATE_LIMIT, auth.user.id, auth.supabase)
  if (userLimited) return userLimited

  const sub = await requireProAi(auth.supabase, auth.user.id)
  if (sub instanceof NextResponse) return sub
  if (sub.aiMode !== 'byok') return aiError(403, AI_ERROR_CODES.planRequired)
  const off = aiModeDisabledResponse('byok')
  if (off) return off

  const found = byokKeyOf(request)
  if (found.status !== 'ok') return byokKeyErrorResponse(found)

  const read = await readJsonBodyWithin(request, AI_MAX_BODY_BYTES_SMALL)
  if (!read.ok) return bodyRefused(read.reason)
  const model = resolveAiModel(modelChoiceOf(read.body), 'nameGroup', found.provider)
  if (!model) return aiError(400, AI_ERROR_CODES.modelInvalid)

  const slot = await acquireAiSlot(auth.supabase, auth.user.id, aiSlotLeaseSeconds(maxDuration))
  if (slot.kind === 'refused') return slot.response

  const mock = aiMockEnabled()
  try {
    // Shared with the model routes: too many rejected or unfunded keys lately, no provider call.
    // Peeked while the slot is held (see `handleAiRoute`); a refusal frees it in `finally`.
    const keyFailures = await byokKeyFailureGate(auth.user.id, auth.supabase)
    if (keyFailures) return keyFailures

    if (found.provider === 'anthropic') {
      try {
        if (mock) await mockVerifyKey('anthropic')
        else {
          await anthropicClient('byok', found.key).messages.countTokens(
            { model, messages: [{ role: 'user', content: 'ping' }] },
            deadlineOptions(aiDeadline(startedAt, maxDuration))
          )
        }
      } catch (err) {
        throw mapAnthropicError(err, 'byok')
      }
    } else {
      try {
        if (mock) await mockVerifyKey(found.provider)
        else await verifyOpenAiOrGoogleKey(found.provider, found.key, model)
      } catch (err) {
        throw mapOwnKeyProviderError(err)
      }
    }
    return withAiMockHeader(NextResponse.json({ ok: true, provider: found.provider }))
  } catch (err) {
    if (err instanceof AiRouteError) await recordByokKeyFailure(err.code, auth.user.id, auth.supabase)
    return aiErrorResponse(err, 'byok-verify')
  } finally {
    await slot.release()
  }
}
