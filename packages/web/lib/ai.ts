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
  AI_MAX_GROUP_DESCRIPTION_LENGTH,
  AI_NAME_GROUP_SUGGESTIONS,
  AI_SUGGESTION_KINDS,
  PRESET_COLORS,
  aiCallCredits,
  aiReservationCredits,
  isAiSuggestionKind,
  type AiAction,
  type AiErrorCode,
  type AiMode,
  type AiModelId,
  type AiSuggestionKind,
} from '@tabmerger/shared'
import {
  ProviderHttpError,
  callGoogle,
  callOpenAi,
  mapProviderError,
  type ProviderPrompt,
  type ProviderReply,
} from '@/lib/ai-providers'
import { AI_MAX_GROUP_NAME_LENGTH, AI_MAX_RENAME_LENGTH } from '@/lib/ai-validation'
import { aiMockEnabled, mockAnthropicMessage, mockCountTokens, mockProviderReply } from '@/lib/ai-mock'
import {
  SYSTEM_DATA_RULE,
  buildUntrustedDataTurn,
  cleanGroupColor,
  cleanModelText,
} from '@/lib/ai-prompt-safety'
import { reserveCredits, settleCredits } from '@/lib/ai-usage'
import type { OrganizeAction } from '@tabmerger/shared'

/**
 * Every model call made by the `/api/ai/*` routes: Claude (managed, or the customer's own
 * Anthropic key), and OpenAI or Google models on the customer's own key (`lib/ai-providers.ts`).
 *
 * A feature is an {@link AiTask}: a system prompt (instructions only), the untrusted data that
 * goes into the user turn's `<tab_data>` block, a JSON schema for structured output, an answer
 * budget, and a parser that cleans the model's answer. {@link runAiTask} runs one task:
 *
 * 1. Managed mode only: count the input tokens (`messages.countTokens`, free), reserve the
 *    worst-case cost (`aiReservationCredits(model, input, max_tokens)`: all input priced as a
 *    cache write) atomically, or refuse with 429 `ai_quota_exceeded` without calling the model.
 * 2. Call the model with the per-model settings in {@link MODEL_REQUEST_SETTINGS}.
 * 3. Managed only: settle the reservation to the real cost from `response.usage` (base input,
 *    cache writes and cache reads each at their own price, plus output with thinking). A call
 *    that was never sent, or that Anthropic answered with an error status, releases the
 *    reservation. A call cut off after it was sent (our deadline, a timeout, a dropped
 *    connection) keeps it, since Anthropic may still bill it; a settle that fails keeps it too
 *    (we may over-charge slightly, never under-charge).
 * 4. Refusals and truncated output are errors (their usage is still charged); otherwise the
 *    answer is parsed and cleaned.
 *
 * Prompt caching: the Claude request marks the system prompt (the task's constant instructions)
 * with an ephemeral `cache_control` breakpoint, so requests for the same task and model can read
 * it from the cache. The per-request `<tab_data>` turn is never marked. A prefix shorter than the
 * model's minimum (512 tokens on the 5.x models) is simply not cached, at no extra cost. OpenAI
 * requests turn caching off (see `callOpenAi`); Gemini's implicit caching needs no request change.
 *
 * BYOK requests run the same task on the key's provider, with a client or request built from the
 * customer's key for that request only, and no metering (so no token counting). The prompt
 * framing, structured-output schema and answer cleaning are the same for every provider. The
 * key is never logged, stored or put into an error message.
 *
 * In local development with `AI_MOCK=true`, only the model call itself (Claude's count and
 * create, or the OpenAI / Google request) is answered by `lib/ai-mock.ts`; everything else
 * here, metering included, runs as usual.
 */

// --- Clients ------------------------------------------------------------------------------

/** The part of the Anthropic client the routes use, so tests can pass a stand-in. */
export type AnthropicClient = Pick<Anthropic, 'messages'>

/**
 * Client defaults, for a call made without a request deadline: one attempt may take a minute and
 * is retried once (the SDK default is 10 minutes and 2 retries, far past any route's
 * `maxDuration`). Route calls override both with the time left before their deadline
 * ({@link deadlineOptions}), so our code gives up first and releases the reservation instead of
 * Vercel ending the function mid-call with the whole reservation still charged. The metered
 * (managed) `messages.create` overrides the retry to 0 (see `callAnthropic`); `countTokens` and
 * own-key calls keep it.
 */
export const ANTHROPIC_CLIENT_TIMEOUT_MS = 60_000
export const ANTHROPIC_MAX_RETRIES = 1

/**
 * The client for a request: TabMerger's key in managed mode, the customer's key in BYOK mode.
 * Built per request so a BYOK key never outlives it.
 */
export function anthropicClient(mode: AiMode, byokKey: string | null): AnthropicClient {
  const limits = { timeout: ANTHROPIC_CLIENT_TIMEOUT_MS, maxRetries: ANTHROPIC_MAX_RETRIES }
  if (mode === 'byok') {
    if (!byokKey) throw new Error('BYOK client requested without a key')
    return new Anthropic({ apiKey: byokKey, ...limits })
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, ...limits })
}

/**
 * Request options that end a call at `deadline` (epoch ms): the SDK's per-attempt `timeout` and an
 * abort `signal` for the whole call, retries included. Throws `ai_overloaded` (503) when the
 * deadline has already passed, so nothing is sent. Without a deadline, the client defaults apply.
 */
export function deadlineOptions(deadline: number | undefined): { timeout?: number; signal?: AbortSignal } {
  if (deadline === undefined) return {}
  const left = Math.floor(deadline - Date.now())
  if (left <= 0) throw new AiRouteError(503, AI_ERROR_CODES.overloaded)
  return { timeout: left, signal: AbortSignal.timeout(left) }
}

// --- Per-model request settings -----------------------------------------------------------

interface ModelRequestSettings {
  /** Anthropic `thinking` sent with every request; omitted when undefined. */
  thinking?: { type: 'disabled' } | { type: 'between_tools' }
  /**
   * The lowest reasoning setting the model accepts: Anthropic `output_config.effort`, OpenAI
   * `reasoning.effort`, Gemini `thinkingConfig.thinkingLevel`.
   */
  effort: 'none' | 'minimal' | 'low'
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
 * Own-key models on other providers (checked against their docs, 2026-10-22):
 * - GPT-6 Luna: `reasoning.effort: none` (it accepts none … max). GPT-6.1 Sol and GPT-6 Astra
 *   start at `low` (`none` is rejected); reasoning tokens count toward `max_output_tokens`.
 * - Gemini 3.1 Flash-Lite: thinking level `minimal` (its default). Gemini 3.8 Flash and Gemini 4
 *   Argon: `low` (their lowest). Thinking tokens count toward `maxOutputTokens`.
 *
 * No sampling parameters (the 5.5 models reject non-default `temperature`/`top_p`) and no
 * refusal fallbacks: a refusal is returned as `ai_refused` and its usage settled.
 */
export const MODEL_REQUEST_SETTINGS: Record<AiModelId, ModelRequestSettings> = {
  'claude-haiku-5-5': { thinking: { type: 'disabled' }, effort: 'low', thinkingHeadroomTokens: 0 },
  'claude-sonnet-5-5': { thinking: { type: 'between_tools' }, effort: 'low', thinkingHeadroomTokens: 0 },
  'claude-opus-5-5': { effort: 'low', thinkingHeadroomTokens: 2048 },
  'gpt-6-luna': { effort: 'none', thinkingHeadroomTokens: 0 },
  'gpt-6.1-sol': { effort: 'low', thinkingHeadroomTokens: 2048 },
  'gpt-6-astra': { effort: 'low', thinkingHeadroomTokens: 2048 },
  'gemini-3.1-flash-lite': { effort: 'minimal', thinkingHeadroomTokens: 512 },
  'gemini-3.8-flash': { effort: 'low', thinkingHeadroomTokens: 2048 },
  'gemini-4-argon': { effort: 'low', thinkingHeadroomTokens: 2048 },
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
  `Suggest ${AI_NAME_GROUP_SUGGESTIONS} different names, best first. Make them differ in angle, not`,
  'just in wording: for example one about the topic, one about what the tabs are for, and one',
  'about the main site.',
  'Each name has 2 to 4 words in Title Case, at most 30 characters, without quotes, and says what',
  'the tabs have in common. Examples: "Shopping", "Dev Tools", "Research", "Trip To Japan".',
].join(' ')

/** Strips the quotes a model sometimes wraps a name in. */
function unquote(text: string): string {
  return text.replace(/^["'“‘]+|["'”’]+$/g, '').trim()
}

/**
 * The model's name suggestions, cleaned: each one unquoted, cleaned of invisible and control
 * characters and cut to {@link AI_MAX_RENAME_LENGTH}. Non-strings, empty names and names equal
 * to an earlier one (ignoring case and runs of spaces) are dropped, and at most
 * {@link AI_NAME_GROUP_SUGGESTIONS} are kept, in the model's order.
 */
export function cleanGroupNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const names: string[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (names.length >= AI_NAME_GROUP_SUGGESTIONS) break
    if (typeof entry !== 'string') continue
    const name = cleanModelText(unquote(cleanModelText(entry, AI_MAX_GROUP_NAME_LENGTH)), AI_MAX_RENAME_LENGTH)
    // Case and runs of spaces don't make a name different.
    const key = name.toLowerCase().replace(/\s+/g, ' ')
    if (!name || seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names
}

/**
 * name-group: {@link AI_NAME_GROUP_SUGGESTIONS} different 2–4 word names of at most 30 characters,
 * best first. The answer keeps 1 to 3 distinct names ({@link cleanGroupNames}); with none left it
 * is an error (`ai_failed`), charged like any other unusable answer.
 */
export function nameGroupTask(tabs: PromptTab[]): AiTask<string[]> {
  return {
    action: 'nameGroup',
    system: NAME_GROUP_SYSTEM,
    data: { tabs: tabs.map((t) => ({ title: t.title, url: t.url })) },
    // The count lives in the prompt and the description: Claude's structured outputs reject
    // `maxItems` and any `minItems` above 1, and the schema is the same for every provider.
    schema: {
      type: 'object',
      properties: {
        names: {
          type: 'array',
          description: `Exactly ${AI_NAME_GROUP_SUGGESTIONS} different names, best first.`,
          items: { type: 'string' },
        },
      },
      required: ['names'],
      additionalProperties: false,
    },
    // Three names of about 8 tokens each plus the JSON; room for a model that writes more.
    answerTokens: 150,
    parse: (output) => {
      const names = cleanGroupNames(isRecord(output) ? output.names : undefined)
      if (names.length === 0) throw new AiRouteError(502, AI_ERROR_CODES.failed)
      return names
    },
  }
}

const DESCRIBE_GROUP_SYSTEM = [
  "You describe a user's saved group of browser tabs, for the user's own reference.",
  'The data has the group `name` and its tabs, each with a `title` and a `url`.',
  `In 1 to 3 plain sentences and at most ${AI_MAX_GROUP_DESCRIPTION_LENGTH} characters, say what the`,
  'group is about: its topic, what the tabs seem to be for, and any notable sites by name.',
  'Write in a neutral tone without marketing language, as plain text: no markdown, no lists,',
  'no URLs and no quotes around the answer. Describe the tabs; never give the user',
  'instructions or advice.',
].join(' ')

/**
 * A model description cut to {@link AI_MAX_GROUP_DESCRIPTION_LENGTH}: cleaned like any model
 * text, and when it runs over, cut back to the last word boundary (when one is in the second
 * half) so the note never ends mid-word.
 */
export function fitGroupDescription(raw: string): string {
  const max = AI_MAX_GROUP_DESCRIPTION_LENGTH
  const full = cleanModelText(raw, max + 1)
  if (full.length <= max) return full
  const cut = cleanModelText(full, max)
  // The cut already falls between two words.
  if (full.charAt(max) === ' ' || full.charAt(max - 1) === ' ') return cut
  const space = cut.lastIndexOf(' ')
  return space > max / 2 ? cut.slice(0, space).replace(/[\s,;:]+$/, '') : cut
}

/**
 * describe-group: 1-3 plain sentences about what a saved group holds, written into its note by
 * the extension. The group name and tabs come from the client, decrypted (the stored row is
 * ciphertext), and go only in the data turn. An empty answer is an error (`ai_failed`), charged
 * like any other unusable answer.
 */
export function describeGroupTask(group: { groupName: string; tabs: PromptTab[] }): AiTask<string> {
  return {
    action: 'describeGroup',
    system: DESCRIBE_GROUP_SYSTEM,
    data: { group: { name: group.groupName, tabs: group.tabs.map((t) => ({ title: t.title, url: t.url })) } },
    schema: {
      type: 'object',
      properties: { description: { type: 'string' } },
      required: ['description'],
      additionalProperties: false,
    },
    // 300 characters is about 75-100 tokens in English; other scripts need more.
    answerTokens: 256,
    parse: (output) => {
      const raw = isRecord(output) && typeof output.description === 'string' ? output.description : ''
      const description = fitGroupDescription(raw)
      if (!description) throw new AiRouteError(502, AI_ERROR_CODES.failed)
      return description
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
  /** What the banner offers for those groups; `merge` always comes with at least two ids. */
  kind: AiSuggestionKind
}

const SUGGEST_SESSIONS_SYSTEM = [
  "You look at a user's saved browser tab groups and suggest one specific, actionable way to",
  'organize them, in one sentence of at most 100 characters.',
  'Set `kind` to "merge" to suggest merging two or more overlapping groups into one, or to',
  '"archive" to suggest archiving stale or redundant groups; the message must propose exactly',
  'that action. List the groups it is about by their exact `name` from the data, the group to',
  'keep first when merging; use an empty list if none apply.',
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
        kind: { type: 'string', enum: [...AI_SUGGESTION_KINDS] },
        staleGroups: { type: 'array', items: { type: 'string' } },
      },
      required: ['message', 'kind', 'staleGroups'],
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
      const kind: AiSuggestionKind = isAiSuggestionKind(parsed.kind) ? parsed.kind : 'archive'
      // A merge names at least two groups. With fewer, the message proposes something the banner
      // cannot do, so no ids are returned and the extension shows no banner.
      const ids = kind === 'merge' && staleGroupIds.length < 2 ? [] : staleGroupIds
      return { message: cleanModelText(text, MAX_SUGGESTION_LENGTH), staleGroupIds: ids, kind }
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
  actions: OrganizeAction[]
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
 * are well formed. Rename text is cleaned and cut to the rename limit. The extension applies
 * the result locally after the user reviews it, and checks the ids against its own groups.
 */
export function sanitizeOrganizeProposal(raw: unknown, groups: OrganizePromptGroup[]): OrganizeProposalResult {
  const known = new Set(groups.map((g) => g.id))
  const pinned = new Set(groups.filter((g) => g.permanent).map((g) => g.id))
  const editable = (id: unknown): id is string => typeof id === 'string' && known.has(id) && !pinned.has(id)

  const parsed = isRecord(raw) ? raw : {}
  const actions: OrganizeAction[] = []
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
                  type: { type: 'string', enum: ['merge'] },
                  sourceGroupId: groupIdProperty,
                  targetGroupId: groupIdProperty,
                },
                required: ['type', 'sourceGroupId', 'targetGroupId'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['rename'] },
                  groupId: groupIdProperty,
                  newName: { type: 'string' },
                },
                required: ['type', 'groupId', 'newName'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: { type: { type: 'string', enum: ['delete'] }, groupId: groupIdProperty },
                required: ['type', 'groupId'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['reorder'] },
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

  // A dropped connection, an SDK timeout, or our own deadline aborting the call (APIUserAbortError).
  const connectionError = status === undefined && typeof e.name === 'string' && /Connection|Timeout|Abort/.test(e.name)
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
  if (err instanceof ProviderHttpError) return { provider: err.provider, status: err.status, code: err.code }
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

interface AiCallBase {
  model: AiModelId
  mode: AiMode
  /** Set in managed mode only (which is always Anthropic). */
  meter: AiMeter | null
  /**
   * When the model call must be over (epoch ms): the route's `maxDuration` minus a margin for
   * settling and releasing (see `lib/ai-request-limits.ts`). Unset: the client defaults apply.
   */
  deadline?: number
}

/**
 * Everything one request's model call needs. Anthropic calls go through the SDK client (managed
 * key or the customer's); OpenAI and Google calls carry the customer's key, used for this request
 * only and never logged.
 */
export type AiCallContext =
  | (AiCallBase & { provider: 'anthropic'; client: AnthropicClient })
  | (AiCallBase & { provider: 'openai' | 'google'; apiKey: string; meter: null })

export interface AiTaskResult<T> {
  result: T
  /** Managed credits left this month after the call; `null` for BYOK. */
  remaining: number | null
}

/**
 * The system prompt every provider gets: the task's instructions plus the untrusted-data rule.
 * Both are constants, so the prompt is identical for every request of a task (across users),
 * which is what lets Claude cache it. Never interpolate request data (dates, ids, counts, names)
 * here: it belongs in the `<tab_data>` turn.
 */
export function systemPromptFor(task: AiTask<unknown>): string {
  return `${task.system}\n\n${SYSTEM_DATA_RULE}`
}

/** `max_tokens` for a task on a model: the answer budget plus the model's thinking headroom. */
export function maxOutputTokensFor(task: AiTask<unknown>, model: AiModelId): number {
  return task.answerTokens + MODEL_REQUEST_SETTINGS[model].thinkingHeadroomTokens
}

/**
 * The Anthropic request for a task on a model: the count-tokens params and the create params.
 *
 * The system prompt is one text block with an explicit 5-minute `cache_control` breakpoint, so
 * the prefix up to it (the structured-output format, thinking and effort settings, and the
 * instructions) is written once and read by later requests for the same task and model. The
 * data turn carries no breakpoint: it is unique per request, and caching it would only add the
 * write premium. (Top-level automatic caching is not used for that reason: it marks the last
 * block, which is the data turn.)
 */
export function buildAiRequest(task: AiTask<unknown>, model: AiModelId) {
  const settings = MODEL_REQUEST_SETTINGS[model]
  const count: MessageCountTokensParams = {
    model,
    system: [{ type: 'text', text: systemPromptFor(task), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildUntrustedDataTurn(task.data) }],
    // Every Claude model's setting is `low` (see MODEL_REQUEST_SETTINGS).
    output_config: { effort: settings.effort as 'low', format: { type: 'json_schema', schema: task.schema } },
    // `between_tools` is valid for Sonnet 5.5 but not yet in this SDK version's types.
    ...(settings.thinking ? { thinking: settings.thinking as unknown as ThinkingConfigParam } : {}),
  }
  const create: MessageCreateParamsNonStreaming = {
    ...count,
    max_tokens: maxOutputTokensFor(task, model),
  }
  return { count, create }
}

/** The parts of a model response that {@link callAnthropic} reads (a mock reply has only these). */
type ModelMessage = Pick<Message, 'content' | 'stop_reason' | 'usage'>

/**
 * Credits a Claude response's usage costs: `input_tokens` at the base input price, cache writes
 * at the write price, cache reads at the model's read price, and output (thinking included). The
 * long-context tier is chosen from the total input.
 *
 * `cache_creation_input_tokens` is the authoritative number of written tokens. The
 * `cache_creation` split only says how many of them were 1-hour writes (clamped to 0…written);
 * the rest are 5-minute writes. TabMerger only asks for 5-minute writes and reserves for them, so
 * any 1-hour write is logged (it can make the call cost more than its reservation).
 * Non-finite usage gives `NaN`, which {@link settle} refuses.
 */
export function usageCredits(model: AiModelId, usage: Partial<ModelMessage['usage']> | null | undefined): number {
  const split = usage?.cache_creation
  const written = Math.max(
    0,
    usage?.cache_creation_input_tokens ?? (split?.ephemeral_5m_input_tokens ?? 0) + (split?.ephemeral_1h_input_tokens ?? 0)
  )
  const write1h = Math.min(Math.max(split?.ephemeral_1h_input_tokens ?? 0, 0), written)
  const write5m = written - write1h
  if (write1h > 0) {
    console.error('AI usage reported 1-hour cache writes; reservations assume 5-minute writes:', { model })
  }
  return aiCallCredits(model, {
    inputTokens: usage?.input_tokens ?? 0,
    cacheWrite5mTokens: write5m,
    cacheWrite1hTokens: write1h,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
  })
}

/**
 * Settles a reservation; on failure logs and returns `undefined` so the reservation stays. A
 * non-finite delta (unreadable usage) is never sent: the reservation stays as the charge.
 */
async function settle(meter: AiMeter, delta: number): Promise<number | null | undefined> {
  if (!Number.isFinite(delta)) {
    console.error('AI credit settle skipped: the usage was not a finite number; keeping the reservation')
    return undefined
  }
  if (delta === 0) return undefined
  try {
    return await settleCredits(meter.supabase, meter.userId, meter.month, delta)
  } catch (err) {
    console.error('AI credit settle failed; keeping the reservation:', describeErrorForLog(err))
    return undefined
  }
}

/**
 * Whether a failed call got an HTTP error answer from the provider (an SDK `APIError` with a
 * status, or the dev mock's equivalent). Such a call returned no usage and is not billed. A
 * failure without a status (abort, timeout, dropped connection) may have been billed.
 */
export function providerAnswered(err: unknown): boolean {
  if (err instanceof AiRouteError) return false
  const status = isRecord(err) || err instanceof Error ? (err as ApiErrorLike).status : undefined
  return typeof status === 'number'
}

/** Runs one task: meter (managed), call, settle, interpret. See the module comment. */
export async function runAiTask<T>(task: AiTask<T>, ctx: AiCallContext): Promise<AiTaskResult<T>> {
  const { text, outcome, remaining } =
    ctx.provider === 'anthropic' ? await callAnthropic(task, ctx) : await callOwnKeyProvider(task, ctx)

  if (outcome === 'refused') throw new AiRouteError(422, AI_ERROR_CODES.refused, {}, remaining)
  if (outcome === 'truncated') throw new AiRouteError(502, AI_ERROR_CODES.failed, {}, remaining)

  let output: unknown
  try {
    output = JSON.parse(text)
  } catch {
    throw new AiRouteError(502, AI_ERROR_CODES.failed, {}, remaining)
  }

  try {
    return { result: task.parse(output), remaining }
  } catch (err) {
    // A parser may reject an unusable answer (describe-group: empty). The call was still charged.
    const mapped = err instanceof AiRouteError ? err : new AiRouteError(502, AI_ERROR_CODES.failed)
    mapped.remaining = remaining
    throw mapped
  }
}

/**
 * Logs a managed response whose pricing differs from what the credit prices assume (global
 * inference at the standard tier). Only the model and the two settings are logged.
 */
function warnOnUnpricedUsage(model: AiModelId, usage: Partial<ModelMessage['usage']> | null | undefined): void {
  const geo = usage?.inference_geo ?? null
  const tier = usage?.service_tier ?? null
  if ((geo !== null && geo !== 'global') || (tier !== null && tier !== 'standard')) {
    console.warn('AI usage is priced as global standard, but the response reports:', {
      model,
      inferenceGeo: geo,
      serviceTier: tier,
    })
  }
}

/** A model's answer text, how the turn ended, and the managed balance when metered. */
type CallOutcome = ProviderReply & { remaining: number | null }

/** Claude, managed or own key: count, reserve, call, settle (metering only when managed). */
async function callAnthropic(
  task: AiTask<unknown>,
  ctx: Extract<AiCallContext, { provider: 'anthropic' }>
): Promise<CallOutcome> {
  const { client, model, mode, meter } = ctx
  const request = buildAiRequest(task, model)
  // Dev-only provider seam: the count and create calls below are the only ones the mock replaces.
  const mock = aiMockEnabled()

  let reserved = 0
  let cap = 0
  let remaining: number | null = null

  if (meter) {
    let inputTokens: number
    try {
      inputTokens = (
        await (mock
          ? mockCountTokens(request.count)
          : client.messages.countTokens(request.count, deadlineOptions(ctx.deadline)))
      ).input_tokens
    } catch (err) {
      throw mapAnthropicError(err, mode)
    }
    // Worst case: every counted token (plus a margin) billed as a cache write. Settling refunds
    // the difference.
    reserved = aiReservationCredits(model, inputTokens, request.create.max_tokens)
    if (!Number.isFinite(reserved)) {
      // An unreadable count must never reach the reservation: refuse without calling the model.
      console.error('AI token count was not a finite number; refusing the call:', { model })
      throw new AiRouteError(500, AI_ERROR_CODES.failed)
    }
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

  let message: ModelMessage
  let sent = false
  try {
    // deadlineOptions is inside the try: a deadline that passed while reserving releases too.
    // A metered call is never retried, so "sent" means exactly one request: an SDK retry after a
    // dropped first attempt (which Anthropic may bill) would let the retry's status release the
    // reservation, or its success settle only the retry's usage. Own-key calls keep the retry.
    const options = meter ? { ...deadlineOptions(ctx.deadline), maxRetries: 0 } : deadlineOptions(ctx.deadline)
    sent = true
    message = mock
      ? await mockAnthropicMessage(task, request.create, mode)
      : await client.messages.create(request.create, options)
  } catch (err) {
    if (meter) {
      if (!sent || providerAnswered(err)) {
        // Nothing was sent, or Anthropic answered with an error status (no usage, not billed):
        // release the whole reservation.
        const used = await settle(meter, -reserved)
        if (used !== undefined) remaining = used === null ? cap : Math.max(0, cap - used)
      } else {
        // Sent, then cut off with no answer (our deadline, a timeout, a dropped connection).
        // Anthropic may still run and bill it, so the reservation stays as the charge: we may
        // over-charge, never under-charge.
        console.error('AI call was cut off after it was sent; keeping its reservation:', describeErrorForLog(err))
      }
    }
    const mapped = mapAnthropicError(err, mode)
    mapped.remaining = remaining
    throw mapped
  }

  if (meter) {
    warnOnUnpricedUsage(model, message.usage)
    const delta = usageCredits(model, message.usage) - reserved
    if (delta > 0) {
      // The reservation is meant to be an upper bound; charge the difference, but say so.
      console.error('AI call cost more than its reservation; settling the difference:', { model })
    }
    const used = await settle(meter, delta)
    if (used !== undefined) remaining = used === null ? cap : Math.max(0, cap - used)
  }

  const text = message.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')
  const outcome =
    message.stop_reason === 'refusal' ? 'refused' : message.stop_reason === 'max_tokens' ? 'truncated' : 'complete'
  return { text, outcome, remaining }
}

/** OpenAI or Google on the customer's key: one unmetered call (no token counting). */
async function callOwnKeyProvider(
  task: AiTask<unknown>,
  ctx: Extract<AiCallContext, { provider: 'openai' | 'google' }>
): Promise<CallOutcome> {
  const prompt: ProviderPrompt = {
    model: ctx.model,
    system: systemPromptFor(task),
    user: buildUntrustedDataTurn(task.data),
    schema: task.schema,
    schemaName: `tabmerger_${task.action}`,
    maxOutputTokens: maxOutputTokensFor(task, ctx.model),
    effort: MODEL_REQUEST_SETTINGS[ctx.model].effort,
  }
  try {
    if (ctx.deadline !== undefined) prompt.timeoutMs = deadlineOptions(ctx.deadline).timeout
    // Dev-only provider seam (see lib/ai-mock.ts).
    const reply = aiMockEnabled()
      ? await mockProviderReply(task, ctx.provider)
      : ctx.provider === 'openai'
        ? await callOpenAi(ctx.apiKey, prompt)
        : await callGoogle(ctx.apiKey, prompt)
    return { ...reply, remaining: null }
  } catch (err) {
    throw mapOwnKeyProviderError(err)
  }
}

/** Maps an OpenAI or Google failure (see `mapProviderError`); anything unexpected is `ai_failed`. */
export function mapOwnKeyProviderError(err: unknown): AiRouteError {
  if (err instanceof AiRouteError) return err
  if (err instanceof ProviderHttpError) return mapProviderError(err, (status, code) => new AiRouteError(status, code))
  return new AiRouteError(500, AI_ERROR_CODES.failed)
}
