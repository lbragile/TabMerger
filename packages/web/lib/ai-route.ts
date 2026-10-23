import { NextResponse, type NextRequest } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import {
  AI_BYOK_KEY_HEADER,
  AI_CREDITS_REMAINING_HEADER,
  AI_ERROR_CODES,
  MANAGED_AI_PROVIDER,
  byokKeyProvider,
  resolveAiModel,
  type AiAction,
  type AiErrorCode,
  type AiProvider,
} from '@tabmerger/shared'
import { aiModeDisabledResponse } from '@/lib/ai-guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { AiRouteError, anthropicClient, describeErrorForLog, type AiCallContext } from '@/lib/ai'
import { currentMonth, getAiSubscription, hasProAi, type AiSubscription } from '@/lib/ai-usage'
import { modelChoiceOf } from '@/lib/ai-validation'

/**
 * The request steps every `/api/ai/*` route shares, in the order the spec fixes:
 *
 * 1. AI flag kill switch (`aiDisabledResponse`, called by the route itself, first): 503 when
 *    no AI option is live at all.
 * 2. {@link authenticateAiRequest}: the Supabase JWT from `Authorization: Bearer`.
 * 3. Body validation (the route's `parse*Body` helper), so a bad body never costs anything.
 * 4. {@link resolveAiContext}: plan check (`pro_ai` + entitled status), the caller's own
 *    option gate (managed needs the managed flag, own-key the own-key flag; 503 otherwise),
 *    own-key header and its provider, model allowlist for that provider, and the client and
 *    credit meter for the request.
 * 5. `runAiTask` (in `lib/ai.ts`): reserve, call, settle (managed); one call (own key).
 *
 * Every failure is `{ error: <AI_ERROR_CODES value>, ...details }`.
 */

/** A JSON error response carrying one of the shared AI error codes. */
export function aiError(
  status: number,
  code: AiErrorCode,
  details: Record<string, unknown> = {},
  remaining: number | null = null
): NextResponse {
  const headers: Record<string, string> = {}
  if (remaining !== null) headers[AI_CREDITS_REMAINING_HEADER] = String(remaining)
  return NextResponse.json({ error: code, ...details }, { status, headers })
}

/** 400 for a body the route's parser rejected; `message` says what was wrong. */
export function invalidRequest(message: string): NextResponse {
  return aiError(400, AI_ERROR_CODES.invalidRequest, { message })
}

/** A successful JSON response, with the managed credits left when known. */
export function aiJson(data: unknown, remaining: number | null): NextResponse {
  return NextResponse.json(data, {
    headers: remaining === null ? {} : { [AI_CREDITS_REMAINING_HEADER]: String(remaining) },
  })
}

/**
 * Turns anything thrown while handling an AI request into its response, logging only what
 * {@link describeErrorForLog} allows (never a BYOK key or request headers).
 */
export function aiErrorResponse(err: unknown, label: string): NextResponse {
  if (err instanceof AiRouteError) {
    if (err.status >= 500) console.error(`AI ${label} error:`, describeErrorForLog(err))
    return aiError(err.status, err.code, err.details, err.remaining)
  }
  console.error(`AI ${label} error:`, describeErrorForLog(err))
  return aiError(500, AI_ERROR_CODES.failed)
}

export interface AuthenticatedAiRequest {
  user: User
  supabase: SupabaseClient
}

/**
 * Verifies the caller's Supabase JWT. The extension sends it as a Bearer token because it runs
 * on another origin and cannot share cookies; the service-role client is needed to verify an
 * arbitrary JWT. Returns a 401 response when it is missing or invalid.
 */
export async function authenticateAiRequest(request: NextRequest): Promise<AuthenticatedAiRequest | NextResponse> {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return aiError(401, AI_ERROR_CODES.unauthorized)

  const supabase = await createServiceRoleClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token)
  if (error || !user) return aiError(401, AI_ERROR_CODES.unauthorized)
  return { user, supabase }
}

/** 403 unless the subscription is `pro_ai` with an entitled status. */
export async function requireProAi(
  supabase: SupabaseClient,
  userId: string
): Promise<AiSubscription | NextResponse> {
  const sub = await getAiSubscription(supabase, userId)
  return hasProAi(sub) ? sub : aiError(403, AI_ERROR_CODES.planRequired)
}

/** An own key read from {@link AI_BYOK_KEY_HEADER}, with the provider its shape belongs to. */
export type ByokKey =
  | { status: 'ok'; key: string; provider: AiProvider }
  | { status: 'missing' }
  | { status: 'unrecognised' }

/**
 * The own key sent in {@link AI_BYOK_KEY_HEADER} and its provider (`byokKeyProvider`: Anthropic,
 * OpenAI or Google, read from the key's shape). Never logged or stored.
 */
export function byokKeyOf(request: NextRequest): ByokKey {
  const key = request.headers.get(AI_BYOK_KEY_HEADER)?.trim()
  if (!key) return { status: 'missing' }
  const provider = byokKeyProvider(key)
  return provider ? { status: 'ok', key, provider } : { status: 'unrecognised' }
}

/** The 400 for an own-key header that is missing or not a key of a supported provider. */
export function byokKeyErrorResponse(found: Exclude<ByokKey, { status: 'ok' }>): NextResponse {
  return found.status === 'missing'
    ? aiError(400, AI_ERROR_CODES.byokKeyMissing)
    : aiError(400, AI_ERROR_CODES.byokKeyInvalid)
}

/**
 * Plan, option, key and model checks for a validated request, then the call context:
 * - not `pro_ai` or not entitled → 403 `ai_plan_required`
 * - the caller's option (managed or own key) is not live → 503 `ai_disabled`
 * - own key: no key header → 400 `byok_key_missing`; a header that is not an Anthropic, OpenAI
 *   or Google key → 400 `byok_key_invalid`
 * - `body.model` unknown, or from another provider than the one the request goes to → 400
 *   `ai_model_invalid`
 *
 * Managed mode always runs on Anthropic, ignores a sent key header and gets a meter for this
 * month (fixed here, so the reservation and the settlement hit the same `ai_usage` row even
 * across midnight UTC at the month's end). Own-key mode goes to the key's provider, never uses
 * TabMerger's key and is not metered.
 */
export async function resolveAiContext(
  request: NextRequest,
  auth: AuthenticatedAiRequest,
  body: unknown,
  action: AiAction
): Promise<AiCallContext | NextResponse> {
  const sub = await requireProAi(auth.supabase, auth.user.id)
  if (sub instanceof NextResponse) return sub

  const modeOff = aiModeDisabledResponse(sub.aiMode)
  if (modeOff) return modeOff

  if (sub.aiMode === 'managed') {
    const model = resolveAiModel(modelChoiceOf(body), action, MANAGED_AI_PROVIDER)
    if (!model) return aiError(400, AI_ERROR_CODES.modelInvalid)
    let client
    try {
      client = anthropicClient('managed', null)
    } catch (err) {
      return aiErrorResponse(err, action)
    }
    return {
      provider: 'anthropic',
      client,
      model,
      mode: 'managed',
      meter: { supabase: auth.supabase, userId: auth.user.id, month: currentMonth() },
    }
  }

  const found = byokKeyOf(request)
  if (found.status !== 'ok') return byokKeyErrorResponse(found)

  const model = resolveAiModel(modelChoiceOf(body), action, found.provider)
  if (!model) return aiError(400, AI_ERROR_CODES.modelInvalid)

  if (found.provider !== 'anthropic') {
    return { provider: found.provider, apiKey: found.key, model, mode: 'byok', meter: null }
  }
  let client
  try {
    client = anthropicClient('byok', found.key)
  } catch (err) {
    return aiErrorResponse(err, action)
  }
  return { provider: 'anthropic', client, model, mode: 'byok', meter: null }
}
