import { AI_ERROR_CODES, type AiModelId, type AiProvider } from '@tabmerger/shared'
import type { AiRouteError } from '@/lib/ai'

/**
 * Own-key calls to OpenAI and Google, over plain `fetch` (no SDK dependency).
 *
 * `runAiTask` in `lib/ai.ts` builds the prompt (instructions in the system prompt, untrusted
 * data in one `<tab_data>` block), and this module only carries it to the provider and back,
 * normalized to a {@link ProviderReply}. The same structured-output schema is enforced on every
 * provider; the answer is parsed and cleaned in `runAiTask` exactly as for Anthropic.
 *
 * The customer's key travels only in a request header (`Authorization: Bearer` for OpenAI,
 * `x-goog-api-key` for Google, never the URL, which ends up in logs). It is never logged, never
 * put into an error, and no response body is ever echoed back: errors are reduced to a status
 * and a provider error code before they leave this module.
 *
 * These requests are not metered (own-key only), so no token counting happens here.
 */

const OPENAI_BASE = 'https://api.openai.com/v1'
const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta'

/** A model call: generous, since organize over thousands of tabs can take a while. */
const GENERATE_TIMEOUT_MS = 120_000
/** A key check. */
const VERIFY_TIMEOUT_MS = 15_000

/** The prompt as `runAiTask` built it, provider-neutral. */
export interface ProviderPrompt {
  model: AiModelId
  system: string
  /** The user turn: the untrusted-data notice and the `<tab_data>` block. */
  user: string
  /** JSON schema for the answer (`additionalProperties: false` on every object). */
  schema: Record<string, unknown>
  /** A short name for the schema (OpenAI requires one). */
  schemaName: string
  /** `max_output_tokens`, thinking included. */
  maxOutputTokens: number
  /** Reasoning setting for the model (see `MODEL_REQUEST_SETTINGS`). */
  effort: 'none' | 'minimal' | 'low'
}

/** What came back: the answer text and how the turn ended. */
export interface ProviderReply {
  text: string
  outcome: 'complete' | 'refused' | 'truncated'
}

/**
 * A provider failure reduced to what may be mapped and logged: HTTP status (undefined for a
 * network error or timeout) and the provider's machine-readable error code or status string.
 * Never carries the request, the key or the response body.
 */
export class ProviderHttpError extends Error {
  constructor(
    readonly provider: AiProvider,
    readonly status: number | undefined,
    readonly code: string | undefined
  ) {
    super(`${provider} request failed${status ? ` (${status})` : ''}${code ? `: ${code}` : ''}`)
    this.name = 'ProviderHttpError'
  }
}

/** Code for a 2xx reply that carried no usable answer; mapped to `ai_failed`. */
const UNREADABLE = 'unreadable_response'

/** What a provider error code looks like (`insufficient_quota`, `API_KEY_INVALID`, …). */
const ERROR_CODE_SHAPE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The provider's error code, read from its JSON error body (never returned or logged in full). */
async function errorCodeOf(res: Response): Promise<string | undefined> {
  try {
    const body: unknown = await res.json()
    const err = isRecord(body) && isRecord(body.error) ? body.error : undefined
    if (!err) return undefined
    // OpenAI: { error: { type, code } }. Google: { error: { code: 400, status: 'INVALID_ARGUMENT',
    // details: [{ reason: 'API_KEY_INVALID' }] } }.
    const details = Array.isArray(err.details) ? err.details : []
    const reason = details.map((d) => (isRecord(d) && typeof d.reason === 'string' ? d.reason : undefined)).find(Boolean)
    const code = typeof err.code === 'string' ? err.code : undefined
    const status = typeof err.status === 'string' ? err.status : undefined
    const type = typeof err.type === 'string' ? err.type : undefined
    const found = reason ?? code ?? status ?? type
    // Only a short machine code is kept (it is logged): never free text that could echo a key.
    return found && ERROR_CODE_SHAPE.test(found) ? found : undefined
  } catch {
    return undefined
  }
}

/** `fetch` with a timeout; network failures and timeouts become a status-less {@link ProviderHttpError}. */
async function send(provider: AiProvider, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    throw new ProviderHttpError(provider, undefined, name === 'TimeoutError' ? 'timeout' : 'network')
  }
  if (!res.ok) throw new ProviderHttpError(provider, res.status, await errorCodeOf(res))
  return res
}

async function jsonOf(provider: AiProvider, res: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await res.json()
    if (isRecord(body)) return body
  } catch {
    // fall through
  }
  throw new ProviderHttpError(provider, 502, UNREADABLE)
}

// --- OpenAI (Responses API) ---------------------------------------------------------------

/**
 * OpenAI prompt caching is turned off for these requests.
 *
 * Why: on the GPT-6 models a cache write costs 1.25x input (reads 0.1x, 0.05x on GPT-6.1 Sol),
 * and the default implicit breakpoint sits at the end of the last user message, which is our
 * unique `<tab_data>` turn. Every request of 1,024+ tokens (large group-tabs and organize runs)
 * would pay a 1.25x write on its tab data, which no later request reads. `mode: 'explicit'` with
 * no breakpoints means no cache writes and no caching. `prompt_cache_key` is not sent: on these
 * models it only separates cache accounting and doesn't affect routing.
 *
 * When to revisit: the only prefix shared between requests, the instructions, is far below
 * OpenAI's 1,024-token minimum (hidden system content, such as the output schema, doesn't
 * count). If a task's instructions ever pass 1,024 tokens, a breakpoint after them would pay
 * off. Top-level `instructions` can't carry one, so they would move into a developer message
 * whose `input_text` block has `prompt_cache_breakpoint: { mode: 'explicit' }`.
 * Sources (checked 2026-10-25): https://developers.openai.com/api/docs/guides/prompt-caching and
 * https://developers.openai.com/api/reference/resources/responses/methods/create
 */
export const OPENAI_PROMPT_CACHE_OPTIONS = { mode: 'explicit' } as const

/**
 * One OpenAI Responses API call with Structured Outputs (`text.format` json_schema, strict),
 * `store: false` so OpenAI keeps no conversation state, the lowest reasoning effort the model
 * accepts (`none` on GPT-6 Luna, `low` on GPT-6.1 Sol and GPT-6 Astra), and prompt caching off
 * ({@link OPENAI_PROMPT_CACHE_OPTIONS}).
 */
export async function callOpenAi(apiKey: string, prompt: ProviderPrompt): Promise<ProviderReply> {
  const res = await send(
    'openai',
    `${OPENAI_BASE}/responses`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: prompt.model,
        instructions: prompt.system,
        input: [{ role: 'user', content: prompt.user }],
        text: { format: { type: 'json_schema', name: prompt.schemaName, schema: prompt.schema, strict: true } },
        reasoning: { effort: prompt.effort },
        max_output_tokens: prompt.maxOutputTokens,
        store: false,
        prompt_cache_options: OPENAI_PROMPT_CACHE_OPTIONS,
      }),
    },
    GENERATE_TIMEOUT_MS
  )
  const body = await jsonOf('openai', res)

  let text = ''
  let refused = false
  for (const item of Array.isArray(body.output) ? body.output : []) {
    if (!isRecord(item) || item.type !== 'message') continue // skip reasoning items
    for (const part of Array.isArray(item.content) ? item.content : []) {
      if (!isRecord(part)) continue
      if (part.type === 'output_text' && typeof part.text === 'string') text += part.text
      if (part.type === 'refusal') refused = true
    }
  }

  const incomplete = isRecord(body.incomplete_details) ? body.incomplete_details.reason : undefined
  if (refused || incomplete === 'content_filter') return { text, outcome: 'refused' }
  if (body.status === 'incomplete' || incomplete === 'max_output_tokens') return { text, outcome: 'truncated' }
  if (body.status !== undefined && body.status !== 'completed') {
    // `failed`, `cancelled` or anything else that carries no answer.
    throw new ProviderHttpError('openai', 502, UNREADABLE)
  }
  return { text, outcome: 'complete' }
}

// --- Google (Gemini generateContent) --------------------------------------------------------

/** finishReason values that mean the answer was withheld by a safety or policy filter. */
const GOOGLE_BLOCKED_FINISH = new Set([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'LANGUAGE',
])

/**
 * One Gemini `generateContent` call with structured output (`responseMimeType:
 * application/json` + `responseJsonSchema`) and the lowest thinking level the model accepts
 * (`minimal` on Flash-Lite, `low` on 3.8 Flash and 4 Argon). The key goes in `x-goog-api-key`.
 *
 * Gemini's implicit caching is on by default and needs no request change (Google passes on
 * the savings when a request hits the cache); explicit `cachedContents` is not used, since it needs
 * per-key cache resources, a storage fee, and a prefix of at least 4,096 tokens on 3.8 Flash and
 * 4 Argon (and Gemini 4 Argon doesn't support it).
 * Source: https://ai.google.dev/gemini-api/docs/generate-content/caching (checked 2026-10-25).
 */
export async function callGoogle(apiKey: string, prompt: ProviderPrompt): Promise<ProviderReply> {
  const res = await send(
    'google',
    `${GOOGLE_BASE}/models/${encodeURIComponent(prompt.model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: prompt.system }] },
        contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: prompt.schema,
          maxOutputTokens: prompt.maxOutputTokens,
          thinkingConfig: { thinkingLevel: prompt.effort },
        },
      }),
    },
    GENERATE_TIMEOUT_MS
  )
  const body = await jsonOf('google', res)

  const feedback = isRecord(body.promptFeedback) ? body.promptFeedback : undefined
  if (feedback && typeof feedback.blockReason === 'string' && feedback.blockReason !== 'BLOCK_REASON_UNSPECIFIED') {
    return { text: '', outcome: 'refused' }
  }

  const candidate = Array.isArray(body.candidates) && isRecord(body.candidates[0]) ? body.candidates[0] : undefined
  if (!candidate) return { text: '', outcome: 'refused' }

  const content = isRecord(candidate.content) ? candidate.content : undefined
  let text = ''
  for (const part of Array.isArray(content?.parts) ? content.parts : []) {
    // Thought parts (`thought: true`) are the model's reasoning, not the answer.
    if (isRecord(part) && part.thought !== true && typeof part.text === 'string') text += part.text
  }

  const finish = typeof candidate.finishReason === 'string' ? candidate.finishReason : 'STOP'
  if (GOOGLE_BLOCKED_FINISH.has(finish)) return { text, outcome: 'refused' }
  if (finish === 'MAX_TOKENS') return { text, outcome: 'truncated' }
  return { text, outcome: 'complete' }
}

// --- Key checks -------------------------------------------------------------------------------

/**
 * Checks an own key against its provider at no cost: a models GET (OpenAI lists models; Google
 * reads the one model, which also proves the key can reach it). Throws a
 * {@link ProviderHttpError} when the provider refuses the key.
 */
export async function verifyOpenAiOrGoogleKey(provider: 'openai' | 'google', apiKey: string, model: AiModelId): Promise<void> {
  if (provider === 'openai') {
    await send(
      'openai',
      `${OPENAI_BASE}/models/${encodeURIComponent(model)}`,
      { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } },
      VERIFY_TIMEOUT_MS
    )
    return
  }
  await send(
    'google',
    `${GOOGLE_BASE}/models/${encodeURIComponent(model)}`,
    { method: 'GET', headers: { 'x-goog-api-key': apiKey } },
    VERIFY_TIMEOUT_MS
  )
}

// --- Error mapping ---------------------------------------------------------------------------

/** OpenAI 429 codes that mean money, not speed: retrying won't help until the account is topped up. */
const OPENAI_BILLING_CODES = new Set([
  'insufficient_quota',
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
  'billing_hard_limit_reached',
])

/** Google error reasons/statuses that mean the key itself is unusable. */
const GOOGLE_KEY_CODES = new Set(['API_KEY_INVALID', 'API_KEY_EXPIRED', 'API_KEY_SERVICE_BLOCKED', 'PERMISSION_DENIED', 'UNAUTHENTICATED'])

/** Google error reasons/statuses that mean billing has to be set up or fixed. */
const GOOGLE_BILLING_CODES = new Set(['BILLING_DISABLED', 'BILLING_NOT_ENABLED', 'FAILED_PRECONDITION'])

/**
 * Maps an OpenAI or Google failure to the shared codes, using the same rules as
 * `mapAnthropicError` for own-key calls: never 401 (TabMerger's sign-in) or 429 (TabMerger's
 * credits). `make` builds the `AiRouteError` (passed in to avoid an import cycle).
 */
export function mapProviderError(
  err: ProviderHttpError,
  make: (status: number, code: (typeof AI_ERROR_CODES)[keyof typeof AI_ERROR_CODES]) => AiRouteError
): AiRouteError {
  const { provider, status, code } = err

  if (status === undefined) return make(503, AI_ERROR_CODES.overloaded) // network error or timeout
  if (code === UNREADABLE) return make(502, AI_ERROR_CODES.failed)

  if (provider === 'openai') {
    if (status === 401 || status === 403) return make(400, AI_ERROR_CODES.byokKeyInvalid)
    if (status === 402 || (code && OPENAI_BILLING_CODES.has(code))) return make(402, AI_ERROR_CODES.byokBilling)
    if (status === 429) return make(503, AI_ERROR_CODES.byokRateLimited)
    if (status === 404 || code === 'model_not_found') return make(400, AI_ERROR_CODES.modelInvalid)
  } else {
    if (status === 401 || status === 403 || (code && GOOGLE_KEY_CODES.has(code))) {
      return make(400, AI_ERROR_CODES.byokKeyInvalid)
    }
    if (status === 402 || (code && GOOGLE_BILLING_CODES.has(code))) return make(402, AI_ERROR_CODES.byokBilling)
    if (status === 429) return make(503, AI_ERROR_CODES.byokRateLimited)
    if (status === 404) return make(400, AI_ERROR_CODES.modelInvalid)
  }

  if (status >= 500 || status === 408) return make(503, AI_ERROR_CODES.overloaded)
  return make(500, AI_ERROR_CODES.failed)
}
