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
import { aiDisabledResponse, aiModeDisabledResponse } from '@/lib/ai-guard'
import { withAiMockHeader } from '@/lib/ai-mock'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { AiRouteError, anthropicClient, describeErrorForLog, type AiCallContext } from '@/lib/ai'
import { currentMonth, getAiSubscription, hasProAi, type AiSubscription } from '@/lib/ai-usage'
import { modelChoiceOf, readJsonBodyWithin, type ParseResult } from '@/lib/ai-validation'
import {
  AI_DEADLINE_MARGIN_MS,
  AI_SLOT_LEASE_MARGIN_SECONDS,
  AI_USER_RATE_LIMIT,
  acquireAiSlot,
  byokKeyFailureGate,
  limitAiByIp,
  limitAiByUser,
  managedCreditsExhausted,
  recordByokKeyFailure,
} from '@/lib/ai-request-limits'

/**
 * The request steps every `/api/ai/*` model route shares ({@link handleAiRoute}), in this order:
 *
 * 1. AI flag kill switch (`aiDisabledResponse`): 503 when no AI option is live at all.
 * 2. Per-IP rate limit (`limitAiByIp`), before auth: 429 `rate_limited`, 503 if unavailable.
 * 3. {@link authenticateAiRequest}: the Supabase JWT from `Authorization: Bearer`.
 * 4. Per-user rate limit (`AI_USER_RATE_LIMIT`): 429 `rate_limited`, 503 if unavailable.
 * 5. {@link requireAiOption}: plan check (`pro_ai` + entitled status) and the caller's own
 *    option gate (managed needs the managed flag, own-key the own-key flag; 503 otherwise).
 * 6. Body: refused with 413 over the route's byte cap (before parsing), then validated by the
 *    route's `parse*Body` helper (400).
 * 7. {@link aiCallContext}: own-key header and its provider, model allowlist for that provider,
 *    the client, the credit meter and the model call's deadline.
 * 8. Managed only: the credit pre-check (`managedCreditsExhausted`), so a user with no credits
 *    left never reaches Anthropic (429 `ai_quota_exceeded`).
 * 9. A concurrency slot (`acquireAiSlot`): 429 `rate_limited` when the user's are all in use.
 * 10. Own key only, with the slot held: the key-failure gate (`byokKeyFailureGate`, a peek that
 *    counts nothing): 429 `rate_limited` once the user's recent own-key requests failed on a
 *    rejected or unfunded key too often (the slot is released).
 * 11. The route's work, ending in `runAiTask` (in `lib/ai.ts`): count, reserve, call, settle
 *     (managed); one call (own key). An own-key `byok_key_invalid` / `byok_billing` counts one
 *     key failure. The slot is released in `finally`.
 *
 * Every failure is `{ error: <code>, ...details }`; the codes are `AI_ERROR_CODES` values plus
 * `rate_limited` from `lib/rateLimit.ts`.
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

/** 413 for a body over the route's byte cap (`ai_invalid_request`, which the extension knows). */
export function bodyTooLarge(): NextResponse {
  return aiError(413, AI_ERROR_CODES.invalidRequest, { message: 'request body too large' })
}

/** 408 for a body that took longer than `AI_BODY_READ_TIMEOUT_MS` to arrive. */
export function bodyTimedOut(): NextResponse {
  return aiError(408, AI_ERROR_CODES.invalidRequest, { message: 'request body took too long' })
}

/** The response for a body `readJsonBodyWithin` refused. */
export function bodyRefused(reason: 'too_large' | 'timeout'): NextResponse {
  return reason === 'timeout' ? bodyTimedOut() : bodyTooLarge()
}

/**
 * A successful JSON response, with the managed credits left when known (and the dev AI mock
 * header while `AI_MOCK` is on, see `lib/ai-mock.ts`).
 */
export function aiJson(data: unknown, remaining: number | null): NextResponse {
  return withAiMockHeader(
    NextResponse.json(data, {
      headers: remaining === null ? {} : { [AI_CREDITS_REMAINING_HEADER]: String(remaining) },
    })
  )
}

/**
 * Turns anything thrown while handling an AI request into its response, logging only what
 * {@link describeErrorForLog} allows (never a BYOK key or request headers). Carries the dev AI
 * mock header while `AI_MOCK` is on, so a mocked error scenario is recognisable.
 */
export function aiErrorResponse(err: unknown, label: string): NextResponse {
  if (err instanceof AiRouteError) {
    if (err.status >= 500) console.error(`AI ${label} error:`, describeErrorForLog(err))
    return withAiMockHeader(aiError(err.status, err.code, err.details, err.remaining))
  }
  console.error(`AI ${label} error:`, describeErrorForLog(err))
  return withAiMockHeader(aiError(500, AI_ERROR_CODES.failed))
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
 * The plan and option checks, before the body is read:
 * - not `pro_ai` or not entitled → 403 `ai_plan_required`
 * - the caller's option (managed or own key) is not live → 503 `ai_disabled`
 */
export async function requireAiOption(auth: AuthenticatedAiRequest): Promise<AiSubscription | NextResponse> {
  const sub = await requireProAi(auth.supabase, auth.user.id)
  if (sub instanceof NextResponse) return sub
  return aiModeDisabledResponse(sub.aiMode) ?? sub
}

/**
 * Key and model checks for a validated request of an entitled subscriber, then the call context:
 * - own key: no key header → 400 `byok_key_missing`; a header that is not an Anthropic, OpenAI
 *   or Google key → 400 `byok_key_invalid`
 * - `body.model` unknown, or from another provider than the one the request goes to → 400
 *   `ai_model_invalid`
 *
 * Managed mode always runs on Anthropic, ignores a sent key header and gets a meter for this
 * month (fixed here, so the reservation and the settlement hit the same `ai_usage` row even
 * across midnight UTC at the month's end). Own-key mode goes to the key's provider, never uses
 * TabMerger's key and is not metered. `deadline` (epoch ms) is when the model call must be over.
 */
export function aiCallContext(
  request: NextRequest,
  auth: AuthenticatedAiRequest,
  sub: AiSubscription,
  body: unknown,
  action: AiAction,
  deadline?: number
): AiCallContext | NextResponse {
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
      deadline,
    }
  }

  const found = byokKeyOf(request)
  if (found.status !== 'ok') return byokKeyErrorResponse(found)

  const model = resolveAiModel(modelChoiceOf(body), action, found.provider)
  if (!model) return aiError(400, AI_ERROR_CODES.modelInvalid)

  if (found.provider !== 'anthropic') {
    return { provider: found.provider, apiKey: found.key, model, mode: 'byok', meter: null, deadline }
  }
  let client
  try {
    client = anthropicClient('byok', found.key)
  } catch (err) {
    return aiErrorResponse(err, action)
  }
  return { provider: 'anthropic', client, model, mode: 'byok', meter: null, deadline }
}

/** The deadline (epoch ms) of a model call in a request that started at `startedAt`. */
export function aiDeadline(startedAt: number, maxDurationSeconds: number): number {
  return startedAt + maxDurationSeconds * 1000 - AI_DEADLINE_MARGIN_MS
}

/** Seconds a concurrency slot is leased for in a route with this `maxDuration`. */
export function aiSlotLeaseSeconds(maxDurationSeconds: number): number {
  return maxDurationSeconds + AI_SLOT_LEASE_MARGIN_SECONDS
}

/** One `/api/ai/*` model route, for {@link handleAiRoute}. */
export interface AiRouteSpec<P> {
  action: AiAction
  /** For logs: the route's path segment. */
  label: string
  /** The route's `maxDuration` export (seconds). */
  maxDurationSeconds: number
  /** Largest body accepted, in bytes (`AI_MAX_BODY_BYTES_*` in `lib/ai-validation.ts`). */
  maxBodyBytes: number
  /** The route's `parse*Body` helper. */
  parse: (body: unknown) => ParseResult<P>
  /** The route's work once every check passed; anything it throws goes to `aiErrorResponse`. */
  run: (input: P, ctx: AiCallContext, auth: AuthenticatedAiRequest) => Promise<NextResponse>
}

/** Runs a model route through the shared steps listed at the top of this module. */
export async function handleAiRoute<P>(request: NextRequest, spec: AiRouteSpec<P>): Promise<NextResponse> {
  const startedAt = Date.now()

  // AI feature flag kill switch: must stay first, before any limiter, auth, DB or model work.
  const aiDisabled = aiDisabledResponse()
  if (aiDisabled) return aiDisabled

  const ipLimited = await limitAiByIp(request)
  if (ipLimited) return ipLimited

  const auth = await authenticateAiRequest(request)
  if (auth instanceof NextResponse) return auth

  const userLimited = await limitAiByUser(AI_USER_RATE_LIMIT, auth.user.id, auth.supabase)
  if (userLimited) return userLimited

  const sub = await requireAiOption(auth)
  if (sub instanceof NextResponse) return sub

  // Size first, then parse: a rejected body never costs a model call.
  const read = await readJsonBodyWithin(request, spec.maxBodyBytes)
  if (!read.ok) return bodyRefused(read.reason)
  const input = spec.parse(read.body)
  if (!input.ok) return invalidRequest(input.error)

  const ctx = aiCallContext(request, auth, sub, read.body, spec.action, aiDeadline(startedAt, spec.maxDurationSeconds))
  if (ctx instanceof NextResponse) return ctx

  // A managed user with no credits left is refused here, before count_tokens on our key.
  if (ctx.meter && (await managedCreditsExhausted(ctx.meter.supabase, ctx.meter.userId, ctx.meter.month))) {
    return aiError(429, AI_ERROR_CODES.quotaExceeded, { remaining: 0 }, 0)
  }

  const slot = await acquireAiSlot(auth.supabase, auth.user.id, aiSlotLeaseSeconds(spec.maxDurationSeconds))
  if (slot.kind === 'refused') return slot.response
  try {
    // An own-key user whose recent keys keep failing gets no further provider call. Peeked while
    // the slot is held, so only requests already holding one of the user's slots can pass it
    // before a failure is counted. Its refusal returns through `finally`, which frees the slot.
    if (ctx.mode === 'byok') {
      const keyFailures = await byokKeyFailureGate(auth.user.id, auth.supabase)
      if (keyFailures) return keyFailures
    }
    return await spec.run(input.data, ctx, auth)
  } catch (err) {
    if (ctx.mode === 'byok' && err instanceof AiRouteError) {
      await recordByokKeyFailure(err.code, auth.user.id, auth.supabase)
    }
    return aiErrorResponse(err, spec.label)
  } finally {
    await slot.release()
  }
}
