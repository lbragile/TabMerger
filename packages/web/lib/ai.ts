import Anthropic from '@anthropic-ai/sdk'
import type {
  Message,
  MessageCountTokensParams,
  MessageCreateParamsNonStreaming,
  ThinkingConfigParam,
} from '@anthropic-ai/sdk/resources/messages'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  AI_ERROR_CODES,
  PRESET_COLORS,
  aiCallCredits,
  type AiAction,
  type AiErrorCode,
  type AiMode,
  type AiModelId,
} from '@tabmerger/shared'
import { AI_MAX_GROUP_NAME_LENGTH, AI_MAX_RENAME_LENGTH } from '@/lib/ai-validation'
import {
  SYSTEM_DATA_RULE,
  buildUntrustedDataTurn,
  cleanGroupColor,
  cleanModelText,
} from '@/lib/ai-prompt-safety'
import { reserveCredits, settleCredits } from '@/lib/ai-usage'
import type { ReorganizeAction } from '@/lib/workflows/tabOrganizer'

/**
 * Every Claude call made by the `/api/ai/*` routes.
 *
 * A feature is an {@link AiTask}: a system prompt (instructions only), the untrusted data that
 * goes into the user turn's `<tab_data>` block, a JSON schema for structured output, an answer
 * budget, and a parser that cleans the model's answer. {@link runAiTask} runs one task:
 *
 * 1. Managed mode only: count the input tokens (`messages.countTokens`, free), reserve the
 *    worst-case cost (`aiCallCredits(model, input, max_tokens)`) atomically, or refuse with
 *    429 `ai_quota_exceeded` without calling the model.
 * 2. Call the model with the per-model settings in {@link MODEL_REQUEST_SETTINGS}.
 * 3. Managed only: settle the reservation to the real cost from `response.usage` (input +
 *    output, thinking included). A call that failed without usage releases the reservation; a
 *    settle that fails keeps it (we may over-charge slightly, never under-charge).
 * 4. Refusals and truncated output are errors (their usage is still charged); otherwise the
 *    answer is parsed and cleaned.
 *
 * BYOK requests run the same task on a client built from the customer's key for that request
 * only, with no metering. The key is never logged, stored or put into an error message.
 */

// --- Clients ------------------------------------------------------------------------------

/** The part of the Anthropic client the routes use, so tests can pass a stand-in. */
export type AnthropicClient = Pick<Anthropic, 'messages'>

/**
 * The client for a request: TabMerger's key in managed mode, the customer's key in BYOK mode.
 * Built per request so a BYOK key never outlives it.
 */
export function anthropicClient(mode: AiMode, byokKey: string | null): AnthropicClient {
  if (mode === 'byok') {
    if (!byokKey) throw new Error('BYOK client requested without a key')
    return new Anthropic({ apiKey: byokKey })
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

// --- Per-model request settings -----------------------------------------------------------

interface ModelRequestSettings {
  /** `thinking` sent with every request; omitted when undefined. */
  thinking?: { type: 'disabled' } | { type: 'between_tools' }
  effort: 'low'
  /** Extra `max_tokens` on top of the answer budget, for thinking the model always does. */
  thinkingHeadroomTokens: number
}

/**
 * How each model is called for these short tasks (checked against the `claude-api` skill):
 * - Haiku 5.5: `thinking: disabled` (accepted at effort `high` or below), effort `low`.
 * - Sonnet 5.5: `disabled` is a 400 on this model; `between_tools` is its lowest setting and,
 *   with no tools, means no thinking. Effort `low`.
 * - Opus 5.5: thinking can't be turned off, so `thinking` is omitted (adaptive) and effort
 *   `low` keeps it short; `max_tokens` gets headroom so thinking can't crowd out the answer.
 *
 * No sampling parameters (the 5.5 models reject non-default `temperature`/`top_p`) and no
 * refusal fallbacks: a refusal is returned as `ai_refused` and its usage settled.
 */
export const MODEL_REQUEST_SETTINGS: Record<AiModelId, ModelRequestSettings> = {
  'claude-haiku-5-5': { thinking: { type: 'disabled' }, effort: 'low', thinkingHeadroomTokens: 0 },
  'claude-sonnet-5-5': { thinking: { type: 'between_tools' }, effort: 'low', thinkingHeadroomTokens: 0 },
  'claude-opus-5-5': { effort: 'low', thinkingHeadroomTokens: 2048 },
}

/** Upper bound for any answer budget; far below the models' 128K output limit. */
const MAX_ANSWER_TOKENS = 64_000

function answerBudget(tokens: number): number {
  return Math.min(MAX_ANSWER_TOKENS, Math.ceil(tokens))
}

// --- Tasks --------------------------------------------------------------------------------

/** A JSON schema for structured output: every object sets `additionalProperties: false`. */
type JsonSchema = Record<string, unknown>

export interface AiTask<T> {
  action: AiAction
  /** Instructions. Never contains page data. */
  system: string
  /** Untrusted data, already cleaned, placed in the user turn's `<tab_data>` block. */
  data: unknown
  schema: JsonSchema
  /** Output tokens the answer may need (before any thinking headroom). */
  answerTokens: number
  /** Turns the parsed JSON answer into the route's result, dropping anything malformed. */
  parse(output: unknown): T
}

export interface Tab {
  id: number
  title: string
  url: string
}

export interface TabGroup {
  name: string
  color: string
  tabIds: number[]
}

/** The tab fields the prompts read. Routes pass tabs already cleaned by `lib/ai-validation.ts`. */
export type PromptTab = Pick<Tab, 'title' | 'url'>

/** Longest banner message returned by suggest-sessions; the prompt asks for 100. */
const MAX_SUGGESTION_LENGTH = 200

/** Longest tab summary returned; the prompt asks for at most 60 words. */
const MAX_SUMMARY_LENGTH = 500

/** Longest organize rationale kept. */
const MAX_RATIONALE_LENGTH = 300

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reduces the model's group list to well-formed groups over the tabs that were sent.
 *
 * Entries that are not `{ name: string, tabIds: unknown[] }` are dropped, as are tab ids that
 * were not in the request and ids already placed in an earlier group, so each sent tab
 * appears in at most one group. Groups left without tabs are dropped. Names are cleaned of
 * invisible and control characters, and a colour that is not a valid colour string becomes
 * the default group colour.
 */
export function sanitizeTabGroups(raw: unknown, tabs: Pick<Tab, 'id'>[]): TabGroup[] {
  if (!Array.isArray(raw)) return []

  const unplaced = new Set(tabs.map((t) => t.id))
  const groups: TabGroup[] = []

  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const { name, color, tabIds } = entry
    if (typeof name !== 'string' || !Array.isArray(tabIds)) continue

    const kept: number[] = []
    for (const id of tabIds) {
      if (typeof id === 'number' && unplaced.delete(id)) kept.push(id)
    }
    if (kept.length === 0) continue

    groups.push({
      name: cleanModelText(name, AI_MAX_GROUP_NAME_LENGTH),
      color: cleanGroupColor(color),
      tabIds: kept,
    })
  }

  return groups
}

const GROUP_TABS_SYSTEM = [
  "You sort a user's open browser tabs into groups by topic.",
  'Each tab in the data has an `id`, a `title` and a `url`.',
  'Make between 2 and 6 groups (a single group only when there are fewer than 4 tabs).',
  'Put every tab in exactly one group, using the tab ids from the data.',
  'Give each group a short Title Case name of 1 to 3 words, such as "Shopping", "Dev Tools" or',
  '"Research", and one colour from the allowed values.',
].join(' ')

/** group-tabs: cluster tabs into 2–6 named, coloured groups. */
export function groupTabsTask(tabs: Tab[]): AiTask<TabGroup[]> {
  return {
    action: 'groupTabs',
    system: GROUP_TABS_SYSTEM,
    data: { tabs: tabs.map((t) => ({ id: t.id, title: t.title, url: t.url })) },
    schema: {
      type: 'object',
      properties: {
        groups: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              color: { type: 'string', enum: [...PRESET_COLORS] },
              tabIds: { type: 'array', items: { type: 'integer' } },
            },
            required: ['name', 'color', 'tabIds'],
            additionalProperties: false,
          },
        },
      },
      required: ['groups'],
      additionalProperties: false,
    },
    // Room for every tab id (a few tokens each) plus the group names and colours.
    answerTokens: answerBudget(300 + 8 * tabs.length),
    parse: (output) => sanitizeTabGroups(isRecord(output) ? output.groups : undefined, tabs),
  }
}

const NAME_GROUP_SYSTEM = [
  'You name a group of browser tabs.',
  'Reply with a name of 2 to 4 words in Title Case, at most 30 characters, without quotes, that',
  'says what the tabs have in common. Examples: "Shopping", "Dev Tools", "Research",',
  '"Trip To Japan".',
].join(' ')

/** Strips the quotes a model sometimes wraps a name in. */
function unquote(text: string): string {
  return text.replace(/^["'“‘]+|["'”’]+$/g, '').trim()
}

/** name-group: a 2–4 word name of at most 30 characters. */
export function nameGroupTask(tabs: PromptTab[]): AiTask<string> {
  return {
    action: 'nameGroup',
    system: NAME_GROUP_SYSTEM,
    data: { tabs: tabs.map((t) => ({ title: t.title, url: t.url })) },
    schema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
    answerTokens: 100,
    parse: (output) => {
      const name = isRecord(output) && typeof output.name === 'string' ? output.name : ''
      return cleanModelText(unquote(cleanModelText(name, AI_MAX_GROUP_NAME_LENGTH)), AI_MAX_RENAME_LENGTH)
    },
  }
}

const TAB_SUMMARY_SYSTEM = [
  'You describe what a web page most likely contains, using only its title and URL (you cannot',
  'open it). Write 1 or 2 factual sentences, at most 60 words. When the title and URL say',
  'little, say what kind of page it is (for example a search results page or a sign-in page)',
  'instead of guessing details.',
].join(' ')

/** tab-summary: 1–2 sentences inferred from the title and URL only. */
export function tabSummaryTask(tab: PromptTab): AiTask<string> {
  return {
    action: 'tabSummary',
    system: TAB_SUMMARY_SYSTEM,
    data: { tab: { title: tab.title, url: tab.url } },
    schema: {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
      additionalProperties: false,
    },
    answerTokens: 200,
    parse: (output) =>
      cleanModelText(isRecord(output) && typeof output.summary === 'string' ? output.summary : '', MAX_SUMMARY_LENGTH),
  }
}

export interface SessionSuggestion {
  /** Human-readable banner text, max ~100 chars. */
  message: string
  /** `Group.id` values the message is about, so the UI can offer a per-group action. */
  staleGroupIds: string[]
}

const SUGGEST_SESSIONS_SYSTEM = [
  "You look at a user's saved browser tab groups and suggest one specific, actionable way to",
  'organize their browsing sessions, in one sentence of at most 100 characters.',
  'Also list the groups the suggestion is about (ones that look stale, redundant, or worth',
  'archiving or merging) by their exact `name` from the data; use an empty list if none apply.',
].join(' ')

/**
 * suggest-sessions: a banner message plus the groups it is about.
 *
 * The model only ever sees group *names*: it is never shown or asked to echo `Group.id`,
 * because model-invented ids would silently point at the wrong group. The names it flags are
 * mapped back to ids here from the caller's own input array.
 */
export function suggestSessionsTask(
  groups: { id: string; name: string; tabs: PromptTab[] }[]
): AiTask<SessionSuggestion> {
  return {
    action: 'suggestSessions',
    system: SUGGEST_SESSIONS_SYSTEM,
    data: { groups: groups.map((g) => ({ name: g.name, tabs: g.tabs.map((t) => ({ title: t.title, url: t.url })) })) },
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        staleGroups: { type: 'array', items: { type: 'string' } },
      },
      required: ['message', 'staleGroups'],
      additionalProperties: false,
    },
    answerTokens: answerBudget(200 + 40 * groups.length),
    parse: (output) => {
      const parsed = isRecord(output) ? output : {}
      const text = typeof parsed.message === 'string' ? parsed.message : ''
      const flagged = Array.isArray(parsed.staleGroups) ? parsed.staleGroups : []

      const byName = new Map(groups.map((g) => [g.name.trim().toLowerCase(), g.id]))
      const staleGroupIds = [
        ...new Set(
          flagged
            .map((n) => (typeof n === 'string' ? byName.get(n.trim().toLowerCase()) : undefined))
            .filter((id): id is string => Boolean(id))
        ),
      ]
      return { message: cleanModelText(text, MAX_SUGGESTION_LENGTH), staleGroupIds }
    },
  }
}

/** A group as the organize prompt sees it. Text is already cleaned. */
export interface OrganizePromptGroup {
  id: string
  name: string
  permanent: boolean
  tabs: PromptTab[]
}

export interface OrganizeProposalResult {
  actions: ReorganizeAction[]
  rationale: string
}

const ORGANIZE_SYSTEM = [
  "You are a tab-organization assistant. Analyze the user's browser tab groups, find",
  'redundancies and near-duplicate groups, and propose a clean reorganization.',
  'Prefer merging small or overlapping groups, renaming vague groups to concise 2 to 4 word',
  'titles of at most 30 characters, and removing empty groups.',
  'Refer to groups only by the `id` values in the data.',
  'Never rename, delete or merge away a group marked `"permanent": true` (the live "Now Open"',
  'group), and never merge another group into it.',
  'A `reorder` action lists group ids in the new order.',
  'Propose no actions when the groups are already well organized.',
  'Give a one-sentence rationale.',
].join(' ')

const groupIdProperty = { type: 'string' }

/**
 * Keeps only actions that name groups from the request, never touch a permanent group, and
 * are well formed. Rename text is cleaned and cut to the rename limit. The approve route and
 * `applyChanges` check again before anything is written.
 */
export function sanitizeOrganizeProposal(raw: unknown, groups: OrganizePromptGroup[]): OrganizeProposalResult {
  const known = new Set(groups.map((g) => g.id))
  const pinned = new Set(groups.filter((g) => g.permanent).map((g) => g.id))
  const editable = (id: unknown): id is string => typeof id === 'string' && known.has(id) && !pinned.has(id)

  const parsed = isRecord(raw) ? raw : {}
  const actions: ReorganizeAction[] = []
  for (const entry of Array.isArray(parsed.actions) ? parsed.actions : []) {
    if (!isRecord(entry)) continue
    switch (entry.type) {
      case 'merge':
        if (editable(entry.sourceGroupId) && editable(entry.targetGroupId) && entry.sourceGroupId !== entry.targetGroupId) {
          actions.push({ type: 'merge', sourceGroupId: entry.sourceGroupId, targetGroupId: entry.targetGroupId })
        }
        break
      case 'rename': {
        const newName = typeof entry.newName === 'string' ? cleanModelText(entry.newName, AI_MAX_RENAME_LENGTH) : ''
        if (editable(entry.groupId) && newName) actions.push({ type: 'rename', groupId: entry.groupId, newName })
        break
      }
      case 'delete':
        if (editable(entry.groupId)) actions.push({ type: 'delete', groupId: entry.groupId })
        break
      case 'reorder': {
        const ids = Array.isArray(entry.groupIds) ? entry.groupIds : []
        const groupIds = [...new Set(ids.filter((id): id is string => typeof id === 'string' && known.has(id)))]
        if (groupIds.length > 0) actions.push({ type: 'reorder', groupIds })
        break
      }
    }
  }

  const rationale = typeof parsed.rationale === 'string' ? cleanModelText(parsed.rationale, MAX_RATIONALE_LENGTH) : ''
  return { actions, rationale }
}

/** organize: a list of merge / rename / delete / reorder actions over the sent groups. */
export function organizeTask(groups: OrganizePromptGroup[]): AiTask<OrganizeProposalResult> {
  return {
    action: 'organize',
    system: ORGANIZE_SYSTEM,
    data: {
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        permanent: g.permanent,
        tabs: g.tabs.map((t) => ({ title: t.title, url: t.url })),
      })),
    },
    schema: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          items: {
            anyOf: [
              {
                type: 'object',
                properties: {
                  type: { type: 'string', const: 'merge' },
                  sourceGroupId: groupIdProperty,
                  targetGroupId: groupIdProperty,
                },
                required: ['type', 'sourceGroupId', 'targetGroupId'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  type: { type: 'string', const: 'rename' },
                  groupId: groupIdProperty,
                  newName: { type: 'string' },
                },
                required: ['type', 'groupId', 'newName'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: { type: { type: 'string', const: 'delete' }, groupId: groupIdProperty },
                required: ['type', 'groupId'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  type: { type: 'string', const: 'reorder' },
                  groupIds: { type: 'array', items: groupIdProperty },
                },
                required: ['type', 'groupIds'],
                additionalProperties: false,
              },
            ],
          },
        },
        rationale: { type: 'string' },
      },
      required: ['actions', 'rationale'],
      additionalProperties: false,
    },
    // Room for about one action per group plus a full reorder list of ids.
    answerTokens: answerBudget(400 + 80 * groups.length),
    parse: (output) => sanitizeOrganizeProposal(output, groups),
  }
}

// --- Errors ---------------------------------------------------------------------------------

/**
 * A failure a route turns into `{ error: code, ...details }` with `status`. `remaining` is the
 * managed credit balance when it is known (a refused call is still charged).
 */
export class AiRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: AiErrorCode,
    readonly details: Record<string, unknown> = {},
    public remaining: number | null = null
  ) {
    super(code)
    this.name = 'AiRouteError'
  }
}

interface ApiErrorLike {
  status?: unknown
  type?: unknown
  error?: unknown
  message?: unknown
  name?: unknown
  requestID?: unknown
}

function errorType(err: ApiErrorLike): string | undefined {
  if (typeof err.type === 'string') return err.type
  // The SDK keeps the response body on `error`: `{ type: 'error', error: { type, message } }`.
  const body = isRecord(err.error) ? err.error : undefined
  const inner = body && isRecord(body.error) ? body.error : undefined
  return typeof inner?.type === 'string' ? inner.type : undefined
}

/**
 * Maps an Anthropic SDK error to the route's error. BYOK errors get their own codes so the
 * extension can point the user at Settings, and never 401 (that means TabMerger's sign-in
 * failed) or 429 (that means TabMerger credits ran out). In managed mode Anthropic's own rate
 * limits and outages are `ai_overloaded`, never 429.
 */
export function mapAnthropicError(err: unknown, mode: AiMode): AiRouteError {
  if (err instanceof AiRouteError) return err
  const e: ApiErrorLike = isRecord(err) || err instanceof Error ? (err as ApiErrorLike) : {}
  const status = typeof e.status === 'number' ? e.status : undefined
  const type = errorType(e)
  const message = typeof e.message === 'string' ? e.message : ''

  if (mode === 'byok') {
    if (status === 401 || status === 403 || type === 'authentication_error' || type === 'permission_error') {
      return new AiRouteError(400, AI_ERROR_CODES.byokKeyInvalid)
    }
    if (status === 402 || type === 'billing_error' || (status === 400 && /credit balance/i.test(message))) {
      return new AiRouteError(402, AI_ERROR_CODES.byokBilling)
    }
    if (status === 429 || type === 'rate_limit_error') {
      return new AiRouteError(503, AI_ERROR_CODES.byokRateLimited)
    }
    if (status === 404 || type === 'not_found_error') {
      // The model is not available to the customer's Anthropic organization.
      return new AiRouteError(400, AI_ERROR_CODES.modelInvalid)
    }
  }

  const connectionError = status === undefined && typeof e.name === 'string' && /Connection|Timeout/.test(e.name)
  if (
    status === 429 ||
    status === 529 ||
    (status !== undefined && status >= 500) ||
    type === 'overloaded_error' ||
    type === 'rate_limit_error' ||
    connectionError
  ) {
    return new AiRouteError(503, AI_ERROR_CODES.overloaded)
  }
  return new AiRouteError(500, AI_ERROR_CODES.failed)
}

/**
 * What may be logged about an error: its class, HTTP status, Anthropic error type and request
 * id. Never the error object itself or a BYOK request's message, so nothing derived from a
 * request (headers included) reaches the logs.
 */
export function describeErrorForLog(err: unknown): Record<string, unknown> {
  if (err instanceof AiRouteError) return { code: err.code, status: err.status }
  const e: ApiErrorLike = isRecord(err) || err instanceof Error ? (err as ApiErrorLike) : {}
  return {
    name: typeof e.name === 'string' ? e.name : typeof err,
    status: typeof e.status === 'number' ? e.status : undefined,
    type: errorType(e),
    requestID: typeof e.requestID === 'string' ? e.requestID : undefined,
  }
}

// --- Running a task -------------------------------------------------------------------------

/** Where a managed call's credits are reserved and settled. */
export interface AiMeter {
  supabase: SupabaseClient
  userId: string
  /** 'YYYY-MM' (UTC) fixed at the start of the request, so reserve and settle hit one row. */
  month: string
}

export interface AiCallContext {
  client: AnthropicClient
  model: AiModelId
  mode: AiMode
  /** Set in managed mode only. */
  meter: AiMeter | null
}

export interface AiTaskResult<T> {
  result: T
  /** Managed credits left this month after the call; `null` for BYOK. */
  remaining: number | null
}

/** The request for a task on a model: the count-tokens params and the create params. */
export function buildAiRequest(task: AiTask<unknown>, model: AiModelId) {
  const settings = MODEL_REQUEST_SETTINGS[model]
  const count: MessageCountTokensParams = {
    model,
    system: `${task.system}\n\n${SYSTEM_DATA_RULE}`,
    messages: [{ role: 'user', content: buildUntrustedDataTurn(task.data) }],
    output_config: { effort: settings.effort, format: { type: 'json_schema', schema: task.schema } },
    // `between_tools` is valid for Sonnet 5.5 but not yet in this SDK version's types.
    ...(settings.thinking ? { thinking: settings.thinking as unknown as ThinkingConfigParam } : {}),
  }
  const create: MessageCreateParamsNonStreaming = {
    ...count,
    max_tokens: task.answerTokens + settings.thinkingHeadroomTokens,
  }
  return { count, create }
}

function usageCredits(model: AiModelId, message: Message): number {
  const u = message.usage
  const input = (u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0)
  return aiCallCredits(model, input, u?.output_tokens ?? 0)
}

/** Settles a reservation; on failure logs and returns `undefined` so the reservation stays. */
async function settle(meter: AiMeter, delta: number): Promise<number | null | undefined> {
  if (delta === 0) return undefined
  try {
    return await settleCredits(meter.supabase, meter.userId, meter.month, delta)
  } catch (err) {
    console.error('AI credit settle failed; keeping the reservation:', describeErrorForLog(err))
    return undefined
  }
}

/** Runs one task: meter (managed), call, settle, interpret. See the module comment. */
export async function runAiTask<T>(task: AiTask<T>, ctx: AiCallContext): Promise<AiTaskResult<T>> {
  const { client, model, mode, meter } = ctx
  const request = buildAiRequest(task, model)

  let reserved = 0
  let cap = 0
  let remaining: number | null = null

  if (meter) {
    let inputTokens: number
    try {
      inputTokens = (await client.messages.countTokens(request.count)).input_tokens
    } catch (err) {
      throw mapAnthropicError(err, mode)
    }
    reserved = aiCallCredits(model, inputTokens, request.create.max_tokens)
    const reservation = await reserveCredits(meter.supabase, meter.userId, meter.month, reserved)
    if (!reservation.allowed) {
      throw new AiRouteError(
        429,
        AI_ERROR_CODES.quotaExceeded,
        { needed: reserved, remaining: reservation.remaining },
        reservation.remaining
      )
    }
    cap = reservation.cap
    remaining = reservation.remaining
  }

  let message: Message
  try {
    message = await client.messages.create(request.create)
  } catch (err) {
    // No usage came back, so nothing was spent: release the whole reservation.
    if (meter) {
      const used = await settle(meter, -reserved)
      if (used !== undefined) remaining = used === null ? cap : Math.max(0, cap - used)
    }
    const mapped = mapAnthropicError(err, mode)
    mapped.remaining = remaining
    throw mapped
  }

  if (meter) {
    const used = await settle(meter, usageCredits(model, message) - reserved)
    if (used !== undefined) remaining = used === null ? cap : Math.max(0, cap - used)
  }

  if (message.stop_reason === 'refusal') {
    throw new AiRouteError(422, AI_ERROR_CODES.refused, {}, remaining)
  }
  if (message.stop_reason === 'max_tokens') {
    throw new AiRouteError(502, AI_ERROR_CODES.failed, {}, remaining)
  }

  const text = message.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')
  let output: unknown
  try {
    output = JSON.parse(text)
  } catch {
    throw new AiRouteError(502, AI_ERROR_CODES.failed, {}, remaining)
  }

  return { result: task.parse(output), remaining }
}
