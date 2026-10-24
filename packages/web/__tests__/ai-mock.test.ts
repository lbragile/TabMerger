/**
 * The dev AI mock (`lib/ai-mock.ts`): its gate, its scenarios, each task's mock answer going
 * through the task's real parser, and the AI routes end to end with the mock on: real request
 * steps, real metering with the synthetic usage, the real error mapping, and no provider call.
 * Only the Anthropic SDK (which refuses to construct in jsdom) and Supabase are
 * stubbed; any SDK or `fetch` call is a failure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { AI_CREDITS_REMAINING_HEADER, PRESET_COLORS, aiCallCredits } from '@tabmerger/shared'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const sdk = vi.hoisted(() => ({ create: vi.fn(), countTokens: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: sdk.create, countTokens: sdk.countTokens }
  },
}))

const mockGetUser = vi.fn()
const mockFrom = vi.fn()
const mockRpc = vi.fn()
const mockSupabase = { auth: { getUser: mockGetUser }, from: mockFrom, rpc: mockRpc }

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn(async () => mockSupabase),
}))


import { POST as nameGroupPOST } from '@/app/api/ai/name-group/route'
import { POST as groupTabsPOST } from '@/app/api/ai/group-tabs/route'
import { POST as tabSummaryPOST } from '@/app/api/ai/tab-summary/route'
import { POST as suggestPOST } from '@/app/api/ai/suggest-sessions/route'
import { POST as organizePOST } from '@/app/api/ai/organize/route'
import { POST as verifyPOST } from '@/app/api/ai/byok/verify/route'
import {
  buildAiRequest,
  groupTabsTask,
  nameGroupTask,
  organizeTask,
  runAiTask,
  suggestSessionsTask,
  tabSummaryTask,
  type AiCallContext,
} from '@/lib/ai'
import {
  AI_MOCK_HEADER,
  AI_MOCK_OVER_QUOTA_INPUT_TOKENS,
  AI_MOCK_SLOW_DELAY_MS,
  aiMockEnabled,
  aiMockScenario,
  estimateMockTokens,
  mockCountTokens,
  mockReplyText,
} from '@/lib/ai-mock'
import { parseNameGroupBody } from '@/lib/ai-validation'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const USER_ID = 'user-uuid-1'
const ANTHROPIC_MOCK_KEY = `sk-ant-mock-${'0'.repeat(24)}`
const OPENAI_KEY = `sk-proj-${'a'.repeat(40)}`
const GOOGLE_KEY = `AIza${'b'.repeat(35)}`

const MANAGED = { tier: 'pro_ai', status: 'active', ai_mode: 'managed', ai_monthly_credits: 2500 }
const BYOK = { tier: 'pro_ai', status: 'active', ai_mode: 'byok', ai_monthly_credits: 0 }

const TABS = [
  { id: 1, title: 'Pull requests · tabmerger', url: 'https://github.com/lbragile/TabMerger/pulls' },
  { id: 2, title: 'Issues · tabmerger', url: 'https://github.com/lbragile/TabMerger/issues' },
  { id: 3, title: 'useState – React', url: 'https://react.dev/reference/react/useState' },
  { id: 4, title: 'Hooks pull request review', url: 'https://github.com/facebook/react/pull/1' },
]

function builder(result: unknown) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'insert', 'order']) b[m] = () => b
  b.single = async () => result
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res)
  return b
}

function withSubscription(sub: unknown) {
  mockFrom.mockImplementation((table: string) =>
    builder(table === 'subscriptions' ? { data: sub, error: null } : { data: null, error: null })
  )
}

function req(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/ai/${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer jwt-token', ...headers },
    body: JSON.stringify(body),
  })
}

/** Reservations up to `cap` are allowed; settle returns `used`. */
function stubRpc(cap = 2500, used = 100) {
  mockRpc.mockImplementation(async (fn: string, args: { p_amount?: number }) => {
    if (fn === 'ai_reserve_credits') {
      const amount = args.p_amount ?? 0
      return { data: [{ allowed: amount <= cap - used, remaining: cap - used, cap }], error: null }
    }
    if (fn === 'ai_settle_credits') return { data: used, error: null }
    throw new Error(`unexpected rpc ${fn}`)
  })
}

const rpcCalls = (fn: string) => mockRpc.mock.calls.filter(([name]) => name === fn).map(([, args]) => args)

/** Turns the mock on the way local development does. */
function mockOn(scenario?: string) {
  vi.stubEnv('AI_MOCK', 'true')
  vi.stubEnv('NODE_ENV', 'development')
  if (scenario !== undefined) vi.stubEnv('AI_MOCK_SCENARIO', scenario)
}

let fetchSpy: ReturnType<typeof vi.spyOn>
let consoleWarn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  sdk.create.mockReset().mockRejectedValue(new Error('the real SDK must not be called'))
  sdk.countTokens.mockReset().mockRejectedValue(new Error('the real SDK must not be called'))
  mockRpc.mockReset()
  vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
  vi.stubEnv('ANTHROPIC_API_KEY', '')
  vi.stubEnv('VERCEL_ENV', '')
  vi.stubEnv('VERCEL', '')
  vi.stubEnv('AI_MOCK_SCENARIO', '')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in mock mode'))
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null })
  withSubscription(MANAGED)
  stubRpc()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ─── Gate ─────────────────────────────────────────────────────────────────────

describe('gate', () => {
  it('is on with AI_MOCK=true in development', () => {
    mockOn()
    expect(aiMockEnabled()).toBe(true)
  })

  it.each([
    ['production build', { NODE_ENV: 'production' }],
    ['test run', { NODE_ENV: 'test' }],
    ['Vercel preview', { VERCEL_ENV: 'preview' }],
    ['Vercel production', { VERCEL_ENV: 'production' }],
    ['vercel dev', { VERCEL_ENV: 'development' }],
    ['Vercel build (VERCEL=1)', { VERCEL: '1' }],
  ])('is off on a %s even with AI_MOCK=true', (_label, env) => {
    mockOn()
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
    expect(aiMockEnabled()).toBe(false)
  })

  it.each([undefined, '', 'false', 'TRUE', '1', ' true'])('is off when AI_MOCK is %j', (value) => {
    vi.stubEnv('NODE_ENV', 'development')
    if (value === undefined) delete process.env.AI_MOCK
    else vi.stubEnv('AI_MOCK', value)
    expect(aiMockEnabled()).toBe(false)
  })

  it('logs "AI mock mode: responses are fake" once, on first use', async () => {
    vi.resetModules()
    const fresh = await import('@/lib/ai-mock')
    mockOn()
    expect(consoleWarn).not.toHaveBeenCalled()
    const params = buildAiRequest(nameGroupTask([TABS[0]]), 'claude-haiku-5-5').count
    await fresh.mockCountTokens(params)
    await fresh.mockCountTokens(params)
    expect(consoleWarn).toHaveBeenCalledTimes(1)
    expect(consoleWarn).toHaveBeenCalledWith('AI mock mode: responses are fake')
  })
})

// ─── Scenarios ────────────────────────────────────────────────────────────────

describe('AI_MOCK_SCENARIO', () => {
  it.each([
    ['', { type: 'ok' }],
    ['ok', { type: 'ok' }],
    ['slow', { type: 'slow' }],
    ['error:rate_limited', { type: 'error', kind: 'rate_limited' }],
    ['error:provider_error', { type: 'error', kind: 'provider_error' }],
    ['error:invalid_key', { type: 'error', kind: 'invalid_key' }],
    ['error:over_quota', { type: 'error', kind: 'over_quota' }],
    ['ERROR:Over-Quota', { type: 'error', kind: 'over_quota' }],
  ])('%j → %j', (value, expected) => {
    vi.stubEnv('AI_MOCK_SCENARIO', value)
    expect(aiMockScenario()).toEqual(expected)
    expect(consoleWarn).not.toHaveBeenCalled()
  })

  it.each(['fast', 'error:', 'error:teapot'])('falls back to ok with a warning for %j', (value) => {
    vi.stubEnv('AI_MOCK_SCENARIO', value)
    expect(aiMockScenario()).toEqual({ type: 'ok' })
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('unknown AI_MOCK_SCENARIO'))
  })
})

// ─── Mock answers through the real parsers ────────────────────────────────────

describe('mock answers pass through each task’s real parser', () => {
  const parse = <T>(task: { parse(o: unknown): T } & Parameters<typeof mockReplyText>[0]) =>
    task.parse(JSON.parse(mockReplyText(task)))

  it('group-tabs: one group per site, every tab placed once, preset colours', () => {
    const groups = parse(groupTabsTask(TABS))
    expect(groups).toEqual([
      { name: 'GitHub', color: PRESET_COLORS[0], tabIds: [1, 2, 4] },
      { name: 'React', color: PRESET_COLORS[1], tabIds: [3] },
    ])
  })

  it('group-tabs: at most 6 groups, the smallest sites share "Other"', () => {
    const tabs = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, title: `T${i}`, url: `https://site${i}.example/` }))
    const groups = parse(groupTabsTask(tabs))
    expect(groups).toHaveLength(6)
    expect(groups.at(-1)?.name).toBe('Other')
    expect(groups.flatMap((g) => g.tabIds).sort((a, b) => a - b)).toEqual(tabs.map((t) => t.id))
  })

  it('group-tabs: non-web and local tabs get their own names', () => {
    const groups = parse(
      groupTabsTask([
        { id: 1, title: 'Extensions', url: 'chrome://extensions/' },
        { id: 2, title: 'Dev server', url: 'http://localhost:3000/' },
        { id: 3, title: 'Broken', url: 'not a url' },
      ])
    )
    expect(groups.map((g) => g.name)).toEqual(['Browser', 'Local Dev', 'Other'])
  })

  it('name-group: the dominant site plus the top title word, at most 30 characters', () => {
    const name = parse(nameGroupTask(TABS))
    expect(name).toBe('GitHub Pull')
    expect(name.length).toBeLessThanOrEqual(30)
  })

  it('name-group: the top title words when no site dominates', () => {
    const name = parse(
      nameGroupTask([
        { title: 'Flights to Tokyo', url: 'https://a.example/' },
        { title: 'Tokyo hotels', url: 'https://b.example/' },
        { title: 'Hotels near Shibuya', url: 'https://c.example/' },
      ])
    )
    expect(name).toBe('Tokyo Hotels')
  })

  it('tab-summary: built from the title and URL and marked as a mock', () => {
    const summary = parse(tabSummaryTask(TABS[2]))
    expect(summary).toBe('[Mock summary] A page on react.dev titled "useState – React". Its address points to /reference/react/useState.')
    expect(summary.split(/\s+/).length).toBeLessThanOrEqual(60)
  })

  it('suggest-sessions: flags two groups on the same site by id', () => {
    const result = parse(
      suggestSessionsTask([
        { id: 'g1', name: 'Code review', tabs: [TABS[0], TABS[1]] },
        { id: 'g2', name: 'Docs', tabs: [TABS[2]] },
        { id: 'g3', name: 'Open PRs', tabs: [TABS[3]] },
      ])
    )
    expect(result.message).toBe('Code review and Open PRs are both mostly GitHub. Merge them?')
    expect(result.staleGroupIds).toEqual(['g1', 'g3'])
  })

  it('suggest-sessions: suggests a session from the two largest groups, at most 100 characters', () => {
    const result = parse(
      suggestSessionsTask([
        { id: 'g1', name: 'A very long research group name here', tabs: [TABS[0], TABS[1]] },
        { id: 'g2', name: 'Another quite long group name', tabs: [TABS[2], { title: 'x', url: 'https://x.example/' }] },
      ])
    )
    expect(result.message).toMatch(/^You often open .+ \+ .+ together\. Save them as a session\?$/)
    expect(result.message.length).toBeLessThanOrEqual(100)
    expect(result.staleGroupIds).toEqual([])
  })

  it('suggest-sessions: a single group is suggested as a session', () => {
    const result = parse(suggestSessionsTask([{ id: 'g1', name: 'Work', tabs: [TABS[0], TABS[1]] }]))
    expect(result).toEqual({ message: 'Save Work as a session so you can reopen it later?', staleGroupIds: [] })
  })

  it('suggest-sessions: small groups are suggested for merging or archiving', () => {
    const result = parse(
      suggestSessionsTask([
        { id: 'g1', name: 'Work', tabs: [TABS[0], TABS[1]] },
        { id: 'g2', name: 'Stray', tabs: [TABS[2]] },
      ])
    )
    expect(result.staleGroupIds).toEqual(['g2'])
  })

  it('organize: merges groups on the same site, renames the target, deletes empties, skips Now Open', () => {
    const result = parse(
      organizeTask([
        { id: 'now', name: 'Now Open', permanent: true, tabs: [TABS[0]] },
        { id: 'g1', name: 'Code review', permanent: false, tabs: [TABS[0], TABS[1]] },
        { id: 'g2', name: 'Docs', permanent: false, tabs: [TABS[2]] },
        { id: 'g3', name: 'More PRs', permanent: false, tabs: [TABS[3]] },
        { id: 'g4', name: 'Empty', permanent: false, tabs: [] },
      ])
    )
    expect(result.actions).toEqual([
      { type: 'merge', sourceGroupId: 'g3', targetGroupId: 'g1' },
      { type: 'rename', groupId: 'g1', newName: 'GitHub' },
      { type: 'delete', groupId: 'g4' },
    ])
    expect(result.rationale).toBe('Mock proposal: merges groups that share a site (GitHub) and removes 1 empty group.')
  })

  it('organize: proposes nothing when every group holds its own site', () => {
    const result = parse(organizeTask([{ id: 'g1', name: 'Docs', permanent: false, tabs: [TABS[2]] }]))
    expect(result.actions).toEqual([])
    expect(result.rationale).toMatch(/^Mock proposal: /)
  })
})

describe('runAiTask with the mock on', () => {
  it('answers through the task parser without touching the client', async () => {
    mockOn()
    const client = { messages: { create: vi.fn(), countTokens: vi.fn() } }
    const ctx = { provider: 'anthropic', client, model: 'claude-haiku-5-5', mode: 'byok', meter: null } as unknown as AiCallContext
    const { result, remaining } = await runAiTask(nameGroupTask(TABS), ctx)
    expect(result).toBe('GitHub Pull')
    expect(remaining).toBeNull()
    expect(client.messages.create).not.toHaveBeenCalled()
    expect(client.messages.countTokens).not.toHaveBeenCalled()
  })

  it('never applies when AI_MOCK is off: the real client is called', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"name":"Real Name"}' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    })
    const ctx = {
      provider: 'anthropic',
      client: { messages: { create, countTokens: vi.fn() } },
      model: 'claude-haiku-5-5',
      mode: 'byok',
      meter: null,
    } as unknown as AiCallContext
    const { result } = await runAiTask(nameGroupTask(TABS), ctx)
    expect(result).toBe('Real Name')
    expect(create).toHaveBeenCalledTimes(1)
  })
})

// ─── Routes, managed (metered) ────────────────────────────────────────────────

describe('managed routes with the mock on', () => {
  beforeEach(() => mockOn())

  it('settles the reservation to the synthetic usage', async () => {
    const model = 'claude-opus-5-5'
    const res = await nameGroupPOST(req('name-group', { tabs: TABS, model }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'GitHub Pull' })
    expect(res.headers.get(AI_MOCK_HEADER)).toBe('1')
    expect(res.headers.get(AI_CREDITS_REMAINING_HEADER)).toBe('2400')
    expect(sdk.create).not.toHaveBeenCalled()
    expect(sdk.countTokens).not.toHaveBeenCalled()

    // What the route sent: the same task over the same cleaned tabs.
    const parsed = parseNameGroupBody({ tabs: TABS })
    if (!parsed.ok) throw new Error('fixture')
    const task = nameGroupTask(parsed.data)
    const request = buildAiRequest(task, model)
    const input = (await mockCountTokens(request.count)).input_tokens
    const reserved = aiCallCredits(model, input, request.create.max_tokens)
    const actual = aiCallCredits(model, input, estimateMockTokens(mockReplyText(task)))

    expect(rpcCalls('ai_reserve_credits')).toEqual([{ p_user: USER_ID, p_month: expect.any(String), p_amount: reserved }])
    expect(actual).toBeLessThan(reserved)
    expect(rpcCalls('ai_settle_credits')).toEqual([{ p_user: USER_ID, p_month: expect.any(String), p_delta: actual - reserved }])
  })

  it.each([
    ['group-tabs', groupTabsPOST, { tabs: TABS }, { groups: expect.any(Array) }],
    ['tab-summary', tabSummaryPOST, { tab: TABS[2] }, { summary: expect.stringMatching(/^\[Mock summary\]/) }],
    [
      'suggest-sessions',
      suggestPOST,
      { groups: [{ id: 'g1', name: 'Work', tabs: TABS }] },
      { message: expect.any(String), staleGroupIds: expect.any(Array), suggestion: expect.any(String) },
    ],
  ])('%s answers 200 with the mock header and is metered', async (path, POST, body, expected) => {
    const res = await POST(req(path, body))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(expected)
    expect(res.headers.get(AI_MOCK_HEADER)).toBe('1')
    expect(rpcCalls('ai_reserve_credits')).toHaveLength(1)
    expect(sdk.create).not.toHaveBeenCalled()
  })

  it('organize: answers the mock proposal as { actions }', async () => {
    const groups = [
      // Index 0 is Now Open (permanent by default): never merged, even though it shares a site.
      { id: 'now', name: 'Now Open', tabs: [TABS[0]] },
      { id: 'g1', name: 'Code review', tabs: [TABS[0], TABS[1]] },
      { id: 'g2', name: 'More PRs', tabs: [TABS[3]] },
    ]
    const res = await organizePOST(req('organize', { groups }))
    expect(res.status).toBe(200)
    expect(res.headers.get(AI_MOCK_HEADER)).toBe('1')
    expect((await res.json()).actions).toEqual([
      { type: 'merge', sourceGroupId: 'g2', targetGroupId: 'g1' },
      { type: 'rename', groupId: 'g1', newName: 'GitHub' },
    ])
  })

  it('slow: waits about 1.5 s before answering', async () => {
    vi.stubEnv('AI_MOCK_SCENARIO', 'slow')
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    let done = false
    const pending = nameGroupPOST(req('name-group', { tabs: TABS })).then((r) => {
      done = true
      return r
    })
    await vi.advanceTimersByTimeAsync(AI_MOCK_SLOW_DELAY_MS - 100)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(100)
    const res = await pending
    expect(res.status).toBe(200)
  })

  it.each([
    ['error:rate_limited', 503, 'ai_overloaded'],
    ['error:provider_error', 503, 'ai_overloaded'],
    ['error:invalid_key', 500, 'ai_failed'],
  ])('%s → %i %s, and the reservation is released', async (scenario, status, code) => {
    vi.stubEnv('AI_MOCK_SCENARIO', scenario)
    const res = await nameGroupPOST(req('name-group', { tabs: TABS, model: 'claude-opus-5-5' }))
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: code })
    expect(res.headers.get(AI_MOCK_HEADER)).toBe('1')
    const [{ p_amount }] = rpcCalls('ai_reserve_credits') as { p_amount: number }[]
    expect(rpcCalls('ai_settle_credits')).toEqual([expect.objectContaining({ p_delta: -p_amount })])
  })

  it('error:over_quota → the real reservation is refused: 429 ai_quota_exceeded with the real balance', async () => {
    vi.stubEnv('AI_MOCK_SCENARIO', 'error:over_quota')
    const res = await nameGroupPOST(req('name-group', { tabs: TABS }))
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body).toEqual({ error: 'ai_quota_exceeded', needed: expect.any(Number), remaining: 2400 })
    expect(body.needed).toBe(aiCallCredits('claude-haiku-5-5', AI_MOCK_OVER_QUOTA_INPUT_TOKENS, 100))
    expect(res.headers.get(AI_CREDITS_REMAINING_HEADER)).toBe('2400')
    expect(rpcCalls('ai_settle_credits')).toEqual([])
  })
})

// ─── Routes, own key (unmetered) ──────────────────────────────────────────────

describe('own-key routes with the mock on', () => {
  beforeEach(() => {
    mockOn()
    withSubscription(BYOK)
  })

  it.each([
    ['Anthropic', ANTHROPIC_MOCK_KEY],
    ['OpenAI', OPENAI_KEY],
    ['Google', GOOGLE_KEY],
  ])('%s key: mock answer, no credits, no provider call', async (_label, key) => {
    const res = await nameGroupPOST(req('name-group', { tabs: TABS }, { 'X-AI-Key': key }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'GitHub Pull' })
    expect(res.headers.get(AI_MOCK_HEADER)).toBe('1')
    expect(res.headers.get(AI_CREDITS_REMAINING_HEADER)).toBeNull()
    expect(mockRpc).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(sdk.create).not.toHaveBeenCalled()
  })

  it.each([
    ['error:rate_limited', ANTHROPIC_MOCK_KEY, 503, 'byok_rate_limited'],
    ['error:rate_limited', OPENAI_KEY, 503, 'byok_rate_limited'],
    ['error:rate_limited', GOOGLE_KEY, 503, 'byok_rate_limited'],
    ['error:provider_error', ANTHROPIC_MOCK_KEY, 503, 'ai_overloaded'],
    ['error:provider_error', OPENAI_KEY, 503, 'ai_overloaded'],
    ['error:provider_error', GOOGLE_KEY, 503, 'ai_overloaded'],
    ['error:invalid_key', ANTHROPIC_MOCK_KEY, 400, 'byok_key_invalid'],
    ['error:invalid_key', OPENAI_KEY, 400, 'byok_key_invalid'],
    ['error:invalid_key', GOOGLE_KEY, 400, 'byok_key_invalid'],
    ['error:over_quota', ANTHROPIC_MOCK_KEY, 402, 'byok_billing'],
    ['error:over_quota', OPENAI_KEY, 402, 'byok_billing'],
    ['error:over_quota', GOOGLE_KEY, 402, 'byok_billing'],
  ])('%s with %s → %i %s', async (scenario, key, status, code) => {
    vi.stubEnv('AI_MOCK_SCENARIO', scenario)
    const res = await groupTabsPOST(req('group-tabs', { tabs: TABS }, { 'X-AI-Key': key }))
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: code })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

// ─── Own-key verify ───────────────────────────────────────────────────────────

describe('byok/verify with the mock on', () => {
  beforeEach(() => withSubscription(BYOK))

  it.each([
    ['anthropic', ANTHROPIC_MOCK_KEY],
    ['openai', OPENAI_KEY],
    ['google', GOOGLE_KEY],
  ])('accepts any well-formed %s key without a network call', async (provider, key) => {
    mockOn()
    const res = await verifyPOST(req('byok/verify', {}, { 'X-AI-Key': key }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, provider })
    expect(res.headers.get(AI_MOCK_HEADER)).toBe('1')
    expect(sdk.countTokens).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('still rejects a key that fails the format check', async () => {
    mockOn()
    const res = await verifyPOST(req('byok/verify', {}, { 'X-AI-Key': 'sk-ant-short' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'byok_key_invalid' })
  })

  it.each([
    ['error:invalid_key', 400, 'byok_key_invalid'],
    ['error:rate_limited', 503, 'byok_rate_limited'],
    ['error:over_quota', 402, 'byok_billing'],
    ['error:provider_error', 503, 'ai_overloaded'],
  ])('%s → %i %s', async (scenario, status, code) => {
    mockOn(scenario)
    const res = await verifyPOST(req('byok/verify', {}, { 'X-AI-Key': ANTHROPIC_MOCK_KEY }))
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: code })
    expect(res.headers.get(AI_MOCK_HEADER)).toBe('1')
  })

  it('calls the provider as usual when the mock is off', async () => {
    vi.stubEnv('AI_MOCK', 'true') // NODE_ENV stays 'test'
    sdk.countTokens.mockReset().mockResolvedValue({ input_tokens: 1 })
    const res = await verifyPOST(req('byok/verify', {}, { 'X-AI-Key': ANTHROPIC_MOCK_KEY }))
    expect(res.status).toBe(200)
    expect(sdk.countTokens).toHaveBeenCalledTimes(1)
    expect(res.headers.get(AI_MOCK_HEADER)).toBeNull()
  })
})

// ─── Flag off ─────────────────────────────────────────────────────────────────

describe('mock off', () => {
  it.each([
    ['AI_MOCK unset in development', { NODE_ENV: 'development' }],
    ['AI_MOCK=true in a test build', { AI_MOCK: 'true' }],
    ['AI_MOCK=true in a production build', { AI_MOCK: 'true', NODE_ENV: 'production' }],
    ['AI_MOCK=true on Vercel', { AI_MOCK: 'true', NODE_ENV: 'development', VERCEL_ENV: 'preview' }],
  ])('%s: the real model call runs and no mock header is set', async (_label, env) => {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
    sdk.countTokens.mockReset().mockResolvedValue({ input_tokens: 400 })
    sdk.create.mockReset().mockResolvedValue({
      content: [{ type: 'text', text: '{"name":"Real Name"}' }],
      usage: { input_tokens: 400, output_tokens: 5, cache_creation_input_tokens: null, cache_read_input_tokens: null },
      stop_reason: 'end_turn',
    })
    const res = await nameGroupPOST(req('name-group', { tabs: TABS }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'Real Name' })
    expect(sdk.countTokens).toHaveBeenCalledTimes(1)
    expect(sdk.create).toHaveBeenCalledTimes(1)
    expect(res.headers.get(AI_MOCK_HEADER)).toBeNull()
    expect(consoleWarn).not.toHaveBeenCalledWith('AI mock mode: responses are fake')
  })
})
