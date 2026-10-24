import type {
  Message,
  MessageCountTokensParams,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/messages'
import { PRESET_COLORS, type AiMode, type AiProvider } from '@tabmerger/shared'
import { ProviderHttpError, type ProviderReply } from '@/lib/ai-providers'
import type { AiTask } from '@/lib/ai'

/**
 * Dev-only AI mock: fake model replies at the one provider seam, so AI features can be used
 * locally without a provider key and without spending money.
 *
 * Only the model call itself is replaced (`client.messages.countTokens` / `.create` for Claude,
 * `callOpenAi` / `callGoogle` for own keys, and the provider check in `/api/ai/byok/verify`).
 * Everything around it runs for real: the AI flags, auth, plan and option checks, body
 * validation and prompt cleaning, credit reservation and settlement, and each task's own parser
 * and sanitiser, which read the mock's raw JSON exactly as they would a model's.
 *
 * On only when `AI_MOCK=true` (server-only, never `NEXT_PUBLIC_*`) AND
 * `NODE_ENV === 'development'` AND not on Vercel (`VERCEL_ENV`/`VERCEL` unset). A production
 * build inlines `NODE_ENV` as `production`, so the mock is dead code there.
 *
 * `AI_MOCK_SCENARIO` (optional): `ok` (default), `slow` (about 1.5 s per reply) or
 * `error:<kind>`, see {@link AiMockErrorKind}. The errors are shaped like the provider's own,
 * so the existing error mapping turns them into the codes the UI handles.
 */

/** Response header set on AI responses while the mock is on. */
export const AI_MOCK_HEADER = 'x-tabmerger-ai-mock'

/** Delay of the `slow` scenario. */
export const AI_MOCK_SLOW_DELAY_MS = 1500

/**
 * Input tokens the mock's count step reports in `error:over_quota` (managed): far more than any
 * normal allowance, so the real `ai_reserve_credits` refuses the reservation and the route
 * answers 429 `ai_quota_exceeded` with the account's real balance.
 */
export const AI_MOCK_OVER_QUOTA_INPUT_TOKENS = 100_000_000

/** Rough characters per token for the synthetic usage. */
const CHARS_PER_TOKEN = 4

/**
 * Whether the mock is on for this request. Read from `process.env` on every call, so tests can
 * stub it.
 */
export function aiMockEnabled(): boolean {
  if (process.env.AI_MOCK !== 'true') return false
  if (process.env.NODE_ENV !== 'development') return false
  // Belt and braces: never on a Vercel deployment, whatever its NODE_ENV.
  if (process.env.VERCEL_ENV || process.env.VERCEL) return false
  return true
}

let announced = false

/** Logs once per server process, on the first mocked call. */
function announceMockUse(): void {
  if (announced) return
  announced = true
  console.warn('AI mock mode: responses are fake')
}

/** Adds {@link AI_MOCK_HEADER} to a response while the mock is on. */
export function withAiMockHeader<R extends Response>(response: R): R {
  if (aiMockEnabled()) response.headers.set(AI_MOCK_HEADER, '1')
  return response
}

// --- Scenarios --------------------------------------------------------------------------------

/**
 * `error:<kind>` values of `AI_MOCK_SCENARIO`:
 * - `rate_limited`: the provider's 429. Managed → 503 `ai_overloaded`; own key → 503
 *   `byok_rate_limited`.
 * - `provider_error`: the provider is overloaded or down → 503 `ai_overloaded`.
 * - `invalid_key`: the provider rejects the key. Own key (and the verify route) → 400
 *   `byok_key_invalid`; managed (TabMerger's key) → 500 `ai_failed`.
 * - `over_quota`: managed → the reservation is refused, 429 `ai_quota_exceeded`; own key → the
 *   provider's billing error, 402 `byok_billing`.
 */
export const AI_MOCK_ERROR_KINDS = ['rate_limited', 'provider_error', 'invalid_key', 'over_quota'] as const

export type AiMockErrorKind = (typeof AI_MOCK_ERROR_KINDS)[number]

export type AiMockScenario = { type: 'ok' } | { type: 'slow' } | { type: 'error'; kind: AiMockErrorKind }

const warnedScenarios = new Set<string>()

function isErrorKind(value: string): value is AiMockErrorKind {
  return (AI_MOCK_ERROR_KINDS as readonly string[]).includes(value)
}

/** The scenario from `AI_MOCK_SCENARIO`; unknown values fall back to `ok` with a warning. */
export function aiMockScenario(): AiMockScenario {
  const raw = (process.env.AI_MOCK_SCENARIO ?? '').trim().toLowerCase()
  if (raw === '' || raw === 'ok') return { type: 'ok' }
  if (raw === 'slow') return { type: 'slow' }
  if (raw.startsWith('error:')) {
    const kind = raw.slice('error:'.length).replace(/-/g, '_')
    if (isErrorKind(kind)) return { type: 'error', kind }
  }
  if (!warnedScenarios.has(raw)) {
    warnedScenarios.add(raw)
    console.warn(
      `AI mock mode: unknown AI_MOCK_SCENARIO "${raw.slice(0, 40)}", using "ok". ` +
        `Use ok, slow or error:${AI_MOCK_ERROR_KINDS.join('|')}.`
    )
  }
  return { type: 'ok' }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * An error shaped like the Anthropic SDK's `APIError`: `status`, and the response body on
 * `error` (`{ type: 'error', error: { type, message } }`), which `mapAnthropicError` reads.
 */
export class AiMockAnthropicError extends Error {
  readonly error: { type: 'error'; error: { type: string; message: string } }

  constructor(
    readonly status: number,
    type: string,
    message: string
  ) {
    super(message)
    this.name = 'AiMockAnthropicError'
    this.error = { type: 'error', error: { type, message } }
  }
}

function anthropicMockError(kind: AiMockErrorKind): AiMockAnthropicError {
  switch (kind) {
    case 'rate_limited':
      return new AiMockAnthropicError(429, 'rate_limit_error', 'Mock: rate limited')
    case 'provider_error':
      return new AiMockAnthropicError(529, 'overloaded_error', 'Mock: overloaded')
    case 'invalid_key':
      return new AiMockAnthropicError(401, 'authentication_error', 'Mock: invalid x-api-key')
    case 'over_quota':
      // What Anthropic answers an own key whose account is out of credit.
      return new AiMockAnthropicError(
        400,
        'invalid_request_error',
        'Mock: your credit balance is too low to access the Anthropic API.'
      )
  }
}

const PROVIDER_ERRORS: Record<'openai' | 'google', Record<AiMockErrorKind, [number, string]>> = {
  openai: {
    rate_limited: [429, 'rate_limit_exceeded'],
    provider_error: [500, 'server_error'],
    invalid_key: [401, 'invalid_api_key'],
    over_quota: [429, 'insufficient_quota'],
  },
  google: {
    rate_limited: [429, 'RESOURCE_EXHAUSTED'],
    provider_error: [503, 'UNAVAILABLE'],
    invalid_key: [400, 'API_KEY_INVALID'],
    over_quota: [400, 'BILLING_DISABLED'],
  },
}

function providerMockError(provider: 'openai' | 'google', kind: AiMockErrorKind): ProviderHttpError {
  const [status, code] = PROVIDER_ERRORS[provider][kind]
  return new ProviderHttpError(provider, status, code)
}

// --- Synthetic usage --------------------------------------------------------------------------

/** About how many tokens `text` is: 1 per 4 characters, at least 1. */
export function estimateMockTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN))
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  return JSON.stringify(value)
}

/** The prompt's size in tokens: system prompt, messages and the structured-output schema. */
function promptTokens(params: MessageCountTokensParams): number {
  const parts = [
    textOf(params.system),
    ...params.messages.map((m) => textOf(m.content)),
    textOf(params.output_config?.format),
  ]
  return estimateMockTokens(parts.join('\n'))
}

/**
 * Mock `messages.countTokens`: the prompt's estimated size, or a size no allowance covers in the
 * managed `error:over_quota` scenario.
 */
export async function mockCountTokens(params: MessageCountTokensParams): Promise<{ input_tokens: number }> {
  announceMockUse()
  const scenario = aiMockScenario()
  if (scenario.type === 'error' && scenario.kind === 'over_quota') {
    return { input_tokens: AI_MOCK_OVER_QUOTA_INPUT_TOKENS }
  }
  return { input_tokens: promptTokens(params) }
}

/** The parts of an Anthropic `Message` that `runAiTask` reads. */
export type MockAnthropicMessage = Pick<Message, 'content' | 'stop_reason' | 'usage'>

/** Applies the scenario before a reply: wait (`slow`) or throw (`error:*`). */
async function applyScenario(makeError: (kind: AiMockErrorKind) => Error, skip?: AiMockErrorKind): Promise<void> {
  const scenario = aiMockScenario()
  if (scenario.type === 'slow') await delay(AI_MOCK_SLOW_DELAY_MS)
  if (scenario.type === 'error' && scenario.kind !== skip) throw makeError(scenario.kind)
}

/**
 * Mock `messages.create`: the task's mock answer as the text block, `end_turn`, and usage
 * estimated from the prompt and the answer (capped at `max_tokens`), so managed calls settle
 * to a realistic cost. Error scenarios throw Anthropic-shaped errors; managed `over_quota` is
 * handled at the count step, so a call that still got its reservation is answered normally.
 */
export async function mockAnthropicMessage(
  task: AiTask<unknown>,
  request: MessageCreateParamsNonStreaming,
  mode: AiMode
): Promise<MockAnthropicMessage> {
  announceMockUse()
  await applyScenario(anthropicMockError, mode === 'managed' ? 'over_quota' : undefined)

  const text = mockReplyText(task)
  return {
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    usage: {
      input_tokens: promptTokens(request),
      output_tokens: Math.min(request.max_tokens, estimateMockTokens(text)),
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
    },
  }
}

/** Mock `callOpenAi` / `callGoogle`: the task's mock answer, or the provider's error. */
export async function mockProviderReply(task: AiTask<unknown>, provider: 'openai' | 'google'): Promise<ProviderReply> {
  announceMockUse()
  await applyScenario((kind) => providerMockError(provider, kind))
  return { text: mockReplyText(task), outcome: 'complete' }
}

/**
 * Mock own-key check for `/api/ai/byok/verify`: no network call. Any key that passed the format
 * check is accepted, unless an error scenario is set.
 */
export async function mockVerifyKey(provider: AiProvider): Promise<void> {
  announceMockUse()
  await applyScenario((kind) => (provider === 'anthropic' ? anthropicMockError(kind) : providerMockError(provider, kind)))
}

// --- Mock answers -----------------------------------------------------------------------------

interface DataTab {
  id?: number
  title: string
  url: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tabsOf(value: unknown): DataTab[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map((t) => ({
    ...(typeof t.id === 'number' ? { id: t.id } : {}),
    title: typeof t.title === 'string' ? t.title : '',
    url: typeof t.url === 'string' ? t.url : '',
  }))
}

/** Sites whose name doesn't follow from their domain. */
const KNOWN_SITES: Record<string, string> = {
  'github.com': 'GitHub',
  'gitlab.com': 'GitLab',
  'stackoverflow.com': 'Stack Overflow',
  'youtube.com': 'YouTube',
  'mail.google.com': 'Gmail',
  'docs.google.com': 'Google Docs',
  'drive.google.com': 'Google Drive',
  'calendar.google.com': 'Google Calendar',
  'developer.mozilla.org': 'MDN',
  'news.ycombinator.com': 'Hacker News',
  'linkedin.com': 'LinkedIn',
  'x.com': 'X',
  'chatgpt.com': 'ChatGPT',
  'claude.ai': 'Claude',
}

interface Site {
  /** What tabs are grouped by: a known site's host, else the last two host labels. */
  key: string
  /** A Title Case name for the site. */
  label: string
}

const OTHER_SITE: Site = { key: '~other', label: 'Other' }

function titleCase(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function hostOf(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** The site a tab belongs to, read from its URL's host. */
export function mockSiteOf(url: string): Site {
  const parsed = hostOf(url)
  if (!parsed) return OTHER_SITE
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { key: '~browser', label: 'Browser' }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  if (!host) return OTHER_SITE
  if (KNOWN_SITES[host]) return { key: host, label: KNOWN_SITES[host] }
  if (host === 'localhost' || /^[\d.]+$/.test(host) || host.startsWith('[')) return { key: '~local', label: 'Local Dev' }

  const labels = host.split('.')
  const key = labels.slice(-2).join('.')
  if (KNOWN_SITES[key]) return { key, label: KNOWN_SITES[key] }
  const core = labels.length >= 2 ? labels[labels.length - 2] : labels[0]
  return { key, label: titleCase(core.replace(/[-_]+/g, ' ')) || OTHER_SITE.label }
}

/** Tabs bucketed by site, in first-seen order. */
function bySite<T extends DataTab>(tabs: T[]): { site: Site; tabs: T[] }[] {
  const buckets = new Map<string, { site: Site; tabs: T[] }>()
  for (const tab of tabs) {
    const site = mockSiteOf(tab.url)
    const bucket = buckets.get(site.key) ?? { site, tabs: [] }
    bucket.tabs.push(tab)
    buckets.set(site.key, bucket)
  }
  return [...buckets.values()]
}

/** The site most of `tabs` are on (first seen wins a tie), or `null` without tabs. */
function dominantSite(tabs: DataTab[]): Site | null {
  let best: { site: Site; tabs: DataTab[] } | null = null
  for (const bucket of bySite(tabs)) if (!best || bucket.tabs.length > best.tabs.length) best = bucket
  return best?.site ?? null
}

/** Cuts a name to `max` characters on a word boundary. */
function fitName(name: string, max: number): string {
  const words = name.split(' ')
  while (words.length > 1 && words.join(' ').length > max) words.pop()
  return words.join(' ').slice(0, max)
}

const MAX_MOCK_GROUPS = 6

/** group-tabs: one group per site (at most 6; the smallest sites share "Other"). */
function mockGroupTabs(data: Record<string, unknown>) {
  const tabs = tabsOf(data.tabs).filter((t): t is DataTab & { id: number } => typeof t.id === 'number')
  let buckets = bySite(tabs)

  if (buckets.length > MAX_MOCK_GROUPS) {
    const ranked = [...buckets].sort((a, b) => b.tabs.length - a.tabs.length)
    const kept = new Set(ranked.slice(0, MAX_MOCK_GROUPS - 1))
    const rest = buckets.filter((b) => !kept.has(b)).flatMap((b) => b.tabs)
    buckets = [...buckets.filter((b) => kept.has(b)), { site: OTHER_SITE, tabs: rest }]
  }

  return {
    groups: buckets.map((b, i) => ({
      name: b.site.label,
      color: PRESET_COLORS[i % PRESET_COLORS.length],
      tabIds: b.tabs.map((t) => t.id),
    })),
  }
}

const STOPWORDS = new Set(
  (
    'the and for with your you from this that are was how what why who into about our home page ' +
    'new www com org net http https html index login sign untitled tab tabs'
  ).split(' ')
)

/** The most common meaningful title words, most frequent first (first seen wins a tie). */
function topTitleWords(tabs: DataTab[], exclude: string): string[] {
  const counts = new Map<string, number>()
  for (const tab of tabs) {
    for (const word of tab.title.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (word.length < 3 || /^\d+$/.test(word) || STOPWORDS.has(word) || exclude.includes(word)) continue
      counts.set(word, (counts.get(word) ?? 0) + 1)
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([word]) => word)
}

const MOCK_NAME_MAX = 30

/** Longest mock suggestion; the prompt asks the model for at most 100 characters. */
const MAX_MOCK_SUGGESTION = 100

/**
 * name-group: the site most tabs are on when it holds at least half of them, plus the top title
 * word ("GitHub Pull"); otherwise the two top title words ("React Hooks").
 */
function mockNameGroup(data: Record<string, unknown>) {
  const tabs = tabsOf(data.tabs)
  const site = dominantSite(tabs)
  const siteCount = site ? tabs.filter((t) => mockSiteOf(t.url).key === site.key).length : 0

  let name: string
  if (site && site.key !== OTHER_SITE.key && siteCount * 2 >= tabs.length) {
    const [word] = topTitleWords(tabs, site.label.toLowerCase())
    name = `${site.label} ${word ? titleCase(word) : 'Tabs'}`
  } else {
    const words = topTitleWords(tabs, '').slice(0, 2)
    name = words.length === 2 ? titleCase(words.join(' ')) : words.length === 1 ? `${titleCase(words[0])} Tabs` : 'Mixed Tabs'
  }
  return { name: fitName(name, MOCK_NAME_MAX) }
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/** tab-summary: one or two sentences from the title and URL, marked as a mock. */
function mockTabSummary(data: Record<string, unknown>) {
  const tab = tabsOf(isRecord(data.tab) ? [data.tab] : [])[0] ?? { title: '', url: '' }
  const parsed = hostOf(tab.url)
  const title = tab.title.trim() ? `"${cut(tab.title.trim(), 80)}"` : 'with no title'
  const web = parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:')
  const where = web ? `on ${parsed.hostname.replace(/^www\./, '')}` : 'in the browser'
  const path = web && parsed.pathname !== '/' ? ` Its address points to ${cut(parsed.pathname, 60)}.` : ''
  return { summary: `[Mock summary] A page ${where} titled ${title}.${path}` }
}

/**
 * suggest-sessions: two groups on the same site → merge them; else groups with at most one tab
 * → merge or archive them; else the two largest groups → save them as a session.
 */
function mockSuggestSessions(data: Record<string, unknown>): { message: string; staleGroups: string[] } {
  const groups = (Array.isArray(data.groups) ? data.groups : []).filter(isRecord).map((g) => ({
    name: typeof g.name === 'string' ? g.name : '',
    tabs: tabsOf(g.tabs),
  }))
  const short = (name: string) => cut(name.trim() || 'Untitled', 24)
  const suggest = (message: string, staleGroups: string[] = []) => ({ message: cut(message, MAX_MOCK_SUGGESTION), staleGroups })

  const firstBySite = new Map<string, string>()
  for (const g of groups) {
    const site = dominantSite(g.tabs)
    if (!site) continue
    const earlier = firstBySite.get(site.key)
    if (earlier !== undefined) {
      return suggest(`${short(earlier)} and ${short(g.name)} are both mostly ${site.label}. Merge them?`, [earlier, g.name])
    }
    firstBySite.set(site.key, g.name)
  }

  const small = groups.filter((g) => g.tabs.length <= 1).slice(0, 3)
  if (small.length > 0) {
    return suggest(`${short(small[0].name)} has at most one tab. Merge or archive it?`, small.map((g) => g.name))
  }

  const [a, b] = [...groups].sort((x, y) => y.tabs.length - x.tabs.length)
  if (a && b) return suggest(`You often open ${short(a.name)} + ${short(b.name)} together. Save them as a session?`)
  if (a) return suggest(`Save ${short(a.name)} as a session so you can reopen it later?`)
  return suggest('Save your open groups as a session to reopen them later?')
}

/**
 * organize: merges groups whose tabs are mostly on the same site into the first of them (renamed
 * after the site), and deletes empty groups. Permanent groups are never touched.
 */
function mockOrganize(data: Record<string, unknown>) {
  const groups = (Array.isArray(data.groups) ? data.groups : [])
    .filter(isRecord)
    .filter((g) => typeof g.id === 'string' && g.permanent !== true)
    .map((g) => ({ id: g.id as string, name: typeof g.name === 'string' ? g.name : '', tabs: tabsOf(g.tabs) }))

  const actions: Record<string, unknown>[] = []
  const targets = new Map<string, { id: string; name: string }>()
  const mergedSites: string[] = []
  let deleted = 0

  for (const g of groups) {
    const site = dominantSite(g.tabs)
    if (!site) {
      actions.push({ type: 'delete', groupId: g.id })
      deleted++
      continue
    }
    const target = targets.get(site.key)
    if (!target) {
      targets.set(site.key, g)
      continue
    }
    actions.push({ type: 'merge', sourceGroupId: g.id, targetGroupId: target.id })
    if (!mergedSites.includes(site.label)) {
      mergedSites.push(site.label)
      const newName = fitName(site.label, MOCK_NAME_MAX)
      if (target.name.trim().toLowerCase() !== newName.toLowerCase()) {
        actions.push({ type: 'rename', groupId: target.id, newName })
      }
    }
  }

  const parts: string[] = []
  if (mergedSites.length > 0) parts.push(`merges groups that share a site (${mergedSites.join(', ')})`)
  if (deleted > 0) parts.push(`removes ${deleted} empty group${deleted === 1 ? '' : 's'}`)
  const rationale =
    parts.length > 0
      ? `Mock proposal: ${parts.join(' and ')}.`
      : 'Mock proposal: each group already holds one site, so nothing changes.'
  return { actions, rationale }
}

/**
 * The raw JSON text a model would answer `task` with, built only from the task's data (the
 * same cleaned data the prompt carries). The task's own parser then cleans it as usual.
 */
export function mockReplyText(task: AiTask<unknown>): string {
  const data = isRecord(task.data) ? task.data : {}
  switch (task.action) {
    case 'groupTabs':
      return JSON.stringify(mockGroupTabs(data))
    case 'nameGroup':
      return JSON.stringify(mockNameGroup(data))
    case 'tabSummary':
      return JSON.stringify(mockTabSummary(data))
    case 'suggestSessions':
      return JSON.stringify(mockSuggestSessions(data))
    case 'organize':
      return JSON.stringify(mockOrganize(data))
  }
}
