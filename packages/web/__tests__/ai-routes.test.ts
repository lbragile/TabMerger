/**
 * Unit tests for the AI API routes under app/api/ai/*.
 *
 * The task builders and `runAiTask` from `@/lib/ai` are replaced by spies (the rest of the
 * module is real), so no Anthropic client is constructed and no network call is made. The
 * metering itself (count, reserve, call, settle) is covered with a mocked SDK in
 * `ai-metering.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetUser = vi.fn()
const mockFrom = vi.fn()
const mockSupabase = { auth: { getUser: mockGetUser }, from: mockFrom }

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn(async () => mockSupabase),
}))

// A stand-in client: `runAiTask` is a spy, so the client is built but never used.
vi.mock('@anthropic-ai/sdk', () => ({ default: class {} }))

const mockRunAiTask = vi.fn()
const mockGroupTabs = vi.fn((...a: unknown[]) => ({ task: 'groupTabs', args: a }))
const mockNameGroup = vi.fn((...a: unknown[]) => ({ task: 'nameGroup', args: a }))
const mockSummarizeTab = vi.fn((...a: unknown[]) => ({ task: 'tabSummary', args: a }))
const mockSuggestSessions = vi.fn((...a: unknown[]) => ({ task: 'suggestSessions', args: a }))
const mockOrganizeTask = vi.fn((...a: unknown[]) => ({ task: 'organize', args: a }))
vi.mock('@/lib/ai', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/ai')>()),
  runAiTask: (...a: unknown[]) => mockRunAiTask(...a),
  groupTabsTask: (...a: unknown[]) => mockGroupTabs(...a),
  nameGroupTask: (...a: unknown[]) => mockNameGroup(...a),
  tabSummaryTask: (...a: unknown[]) => mockSummarizeTab(...a),
  suggestSessionsTask: (...a: unknown[]) => mockSuggestSessions(...a),
  organizeTask: (...a: unknown[]) => mockOrganizeTask(...a),
}))

/** Makes `runAiTask` resolve with `result` and 42 credits left. */
function aiReturns(result: unknown) {
  mockRunAiTask.mockResolvedValue({ result, remaining: 42 })
}

const mockStart = vi.fn()
const mockGetRun = vi.fn()
const mockResumeHook = vi.fn()
vi.mock('workflow/api', () => ({
  start: (...a: unknown[]) => mockStart(...a),
  getRun: (...a: unknown[]) => mockGetRun(...a),
  resumeHook: (...a: unknown[]) => mockResumeHook(...a),
}))

vi.mock('@/lib/workflows/tabOrganizer', () => ({ tabOrganizerWorkflow: 'wf' }))

// Imported after mocks are registered
import { POST as groupTabsPOST } from '@/app/api/ai/group-tabs/route'
import { POST as nameGroupPOST } from '@/app/api/ai/name-group/route'
import { POST as tabSummaryPOST } from '@/app/api/ai/tab-summary/route'
import { POST as suggestSessionsPOST } from '@/app/api/ai/suggest-sessions/route'
import { POST as organizePOST, GET as organizeGET } from '@/app/api/ai/organize/route'
import { POST as approvePOST } from '@/app/api/ai/organize/approve/route'
import { POST as byokVerifyPOST } from '@/app/api/ai/byok/verify/route'
import { AiRouteError } from '@/lib/ai'
import {
  AI_MAX_ACTIONS,
  AI_MAX_GROUPS,
  AI_MAX_GROUP_NAME_LENGTH,
  AI_MAX_HOOK_TOKEN_LENGTH,
  AI_MAX_ID_LENGTH,
  AI_MAX_RENAME_LENGTH,
  AI_MAX_TABS_PER_LIST,
  AI_MAX_TITLE_LENGTH,
  AI_MAX_TOTAL_TABS,
  AI_MAX_URL_LENGTH,
} from '@/lib/ai-validation'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const USER_ID = 'user-uuid-1'

function req(url: string, body?: unknown, auth: string | null = 'Bearer jwt-token') {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: auth ? { authorization: auth } : {},
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

/** Chainable Supabase query-builder stub resolving to `result`. */
function builder(result: unknown) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'insert', 'upsert', 'order']) b[m] = () => b
  b.single = async () => result
  b.maybeSingle = async () => result
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res)
  return b
}

const TABS = [{ id: 1, title: 'Docs', url: 'https://example.com/docs' }]

/** An entitled managed Pro AI subscription row. */
const PRO_AI = { tier: 'pro_ai', status: 'active', ai_mode: 'managed', ai_monthly_credits: 2500 }

/** Serves each table's query result; tables not listed resolve to `{ data: null, error: null }`. */
function setTables(tables: Record<string, unknown>) {
  mockFrom.mockImplementation((table: string) =>
    builder(table in tables ? tables[table] : { data: null, error: null })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null })
  mockRunAiTask.mockReset()
  aiReturns(null)
  setTables({ subscriptions: { data: PRO_AI, error: null } })
})

afterEach(() => vi.unstubAllEnvs())

// ─── Shared gating behaviour (the four simple routes) ─────────────────────────

const simpleRoutes = [
  {
    name: 'group-tabs',
    handler: groupTabsPOST,
    url: 'http://localhost/api/ai/group-tabs',
    body: { tabs: TABS },
    bad: [{}, { tabs: [] }, { tabs: 'nope' }] as Record<string, unknown>[],
    aiMock: () => mockGroupTabs,
    aiValue: [{ name: 'Docs', color: 'rgba(1,1,1,1)', tabIds: [1] }],
    expected: { groups: [{ name: 'Docs', color: 'rgba(1,1,1,1)', tabIds: [1] }] },
    badMessage: 'tabs array required',
  },
  {
    name: 'name-group',
    handler: nameGroupPOST,
    url: 'http://localhost/api/ai/name-group',
    body: { tabs: TABS },
    bad: [{}, { tabs: [] }] as Record<string, unknown>[],
    aiMock: () => mockNameGroup,
    aiValue: 'Dev Tools',
    expected: { name: 'Dev Tools' },
    badMessage: 'tabs array required',
  },
  {
    name: 'tab-summary',
    handler: tabSummaryPOST,
    url: 'http://localhost/api/ai/tab-summary',
    body: { tab: TABS[0] },
    bad: [{}, { tab: { title: 'x', url: 'y' } }] as Record<string, unknown>[],
    aiMock: () => mockSummarizeTab,
    aiValue: 'A documentation page.',
    expected: { summary: 'A documentation page.' },
    badMessage: 'tab object required',
  },
  {
    name: 'suggest-sessions',
    handler: suggestSessionsPOST,
    url: 'http://localhost/api/ai/suggest-sessions',
    body: { groups: [{ id: 'g1', name: 'Work', tabs: TABS }] },
    bad: [{}, { groups: [] }] as Record<string, unknown>[],
    aiMock: () => mockSuggestSessions,
    aiValue: { message: 'Save Work as a session.', staleGroupIds: ['g1'] },
    expected: {
      message: 'Save Work as a session.',
      staleGroupIds: ['g1'],
      suggestion: 'Save Work as a session.',
    },
    badMessage: 'groups array required',
  },
]

describe.each(simpleRoutes)('POST /api/ai/$name', (route) => {
  it('returns the expected payload and the remaining-credits header', async () => {
    aiReturns(route.aiValue)
    const res = await route.handler(req(route.url, route.body))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(route.expected)
    expect(res.headers.get('X-AI-Credits-Remaining')).toBe('42')
    expect(res.headers.get('X-AI-Requests-Remaining')).toBeNull()
    expect(route.aiMock()).toHaveBeenCalledTimes(1)
    // Managed mode: the default model for the feature, and a meter for this month.
    const ctx = mockRunAiTask.mock.calls[0][1]
    expect(ctx.mode).toBe('managed')
    expect(ctx.model).toBe('claude-haiku-5-5')
    expect(ctx.meter).toMatchObject({ userId: USER_ID, month: expect.stringMatching(/^\d{4}-\d{2}$/) })
  })

  it('omits the remaining-credits header when the call is not metered (BYOK)', async () => {
    mockRunAiTask.mockResolvedValue({ result: route.aiValue, remaining: null })
    const res = await route.handler(req(route.url, route.body))
    expect(res.status).toBe(200)
    expect(res.headers.get('X-AI-Credits-Remaining')).toBeNull()
  })

  it('401s with no Authorization header', async () => {
    const res = await route.handler(req(route.url, route.body, null))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'ai_unauthorized' })
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('401s when the JWT does not resolve to a user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } })
    const res = await route.handler(req(route.url, route.body))
    expect(res.status).toBe(401)
    expect(mockRunAiTask).not.toHaveBeenCalled()
  })

  it('429s with what was needed and what is left when the allowance cannot cover the call', async () => {
    mockRunAiTask.mockRejectedValue(
      new AiRouteError(429, 'ai_quota_exceeded', { needed: 9, remaining: 3 }, 3)
    )
    const res = await route.handler(req(route.url, route.body))
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'ai_quota_exceeded', needed: 9, remaining: 3 })
    expect(res.headers.get('X-AI-Credits-Remaining')).toBe('3')
  })

  it('400s ai_model_invalid for a model outside the allowlist, before any AI work', async () => {
    const res = await route.handler(req(route.url, { ...route.body, model: 'gpt-5' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'ai_model_invalid' })
    expect(mockRunAiTask).not.toHaveBeenCalled()
  })

  it.each([
    ['auto', 'claude-haiku-5-5'],
    ['claude-opus-5-5', 'claude-opus-5-5'],
    ['claude-sonnet-5-5', 'claude-sonnet-5-5'],
  ])('runs model choice %s on %s', async (choice, model) => {
    aiReturns(route.aiValue)
    await route.handler(req(route.url, { ...route.body, model: choice }))
    expect(mockRunAiTask.mock.calls[0][1].model).toBe(model)
  })

  it.each(route.bad)('400s on malformed body %j', async (bad) => {
    const res = await route.handler(req(route.url, bad))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'ai_invalid_request', message: route.badMessage })
    expect(route.aiMock()).not.toHaveBeenCalled()
    expect(mockRunAiTask).not.toHaveBeenCalled()
  })

  it('returns the mapped error code when the model call fails', async () => {
    mockRunAiTask.mockRejectedValue(new AiRouteError(503, 'ai_overloaded'))
    const res = await route.handler(req(route.url, route.body))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'ai_overloaded' })
  })

  it('500s ai_failed on an unexpected error', async () => {
    mockRunAiTask.mockRejectedValue(new Error('boom'))
    const res = await route.handler(req(route.url, route.body))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'ai_failed' })
  })
})

// ─── organize ─────────────────────────────────────────────────────────────────

/** A stored plaintext group row, as the stored-rows path reads it. */
const STORED_ROW = { id: 'row-1', name: 'Stored', windows: [{ tabs: [{ title: 'Docs', url: 'https://example.com/docs' }] }] }

const PROPOSAL = { actions: [{ type: 'delete', groupId: 'g1' }], rationale: 'Tidy up.' }

describe('POST /api/ai/organize', () => {
  const url = 'http://localhost/api/ai/organize'

  beforeEach(() => {
    aiReturns(PROPOSAL)
    mockStart.mockResolvedValue({ runId: 'run-1' })
    setTables({
      subscriptions: { data: PRO_AI, error: null },
      groups: { data: [STORED_ROW], error: null },
    })
  })

  it('calls the model, then starts the workflow with only the proposal and pinned ids', async () => {
    const insert = vi.fn(() => builder({ data: null, error: null }))
    mockFrom.mockImplementation((table: string) =>
      table === 'organize_runs' ? { insert } : builder({ data: PRO_AI, error: null })
    )

    const groups = [
      { id: 'g0', name: 'Now Open', permanent: true, tabs: [{ title: 'A', url: 'https://a.example/' }] },
      { id: 'g1', name: 'Work', tabs: [{ title: 'B', url: 'https://b.example/' }] },
    ]
    const res = await organizePOST(req(url, { groups }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.runId).toBe('run-1')
    expect(json.token).toMatch(new RegExp(`^org-${USER_ID}-[0-9a-f]{32}$`))
    expect(res.headers.get('X-AI-Credits-Remaining')).toBe('42')

    expect(mockRunAiTask).toHaveBeenCalledTimes(1)
    expect(mockRunAiTask.mock.calls[0][1].model).toBe('claude-sonnet-5-5')
    // Workflow arguments are persisted: no tabs, no key, only the proposal and pinned ids.
    expect(mockStart).toHaveBeenCalledWith('wf', [USER_ID, json.token, PROPOSAL, ['g0']])
    expect(insert).toHaveBeenCalledWith({ run_id: 'run-1', user_id: USER_ID })
  })

  it('sends a client-supplied groups payload to the prompt (E2EE path)', async () => {
    const groups = [
      { id: 'g0', name: 'Now Open', permanent: true, tabs: [{ title: 'A', url: 'https://a.example/' }] },
      { id: 'g1', name: 'Work', tabs: [{ title: 'B', url: 'https://b.example/' }] },
    ]
    expect((await organizePOST(req(url, { groups }))).status).toBe(200)
    expect(mockOrganizeTask.mock.calls[0][0]).toStrictEqual([
      { id: 'g0', name: 'Now Open', tabs: groups[0].tabs, permanent: true },
      { id: 'g1', name: 'Work', tabs: groups[1].tabs, permanent: false },
    ])
    expect(mockFrom).not.toHaveBeenCalledWith('groups')
  })

  it.each([
    ['empty body', {}],
    ['empty groups array', { groups: [] }],
    ['null groups', { groups: null }],
  ])('reads the stored rows for %s', async (_label, body) => {
    expect((await organizePOST(req(url, body))).status).toBe(200)
    expect(mockFrom).toHaveBeenCalledWith('groups')
    expect(mockOrganizeTask.mock.calls[0][0]).toStrictEqual([
      { id: 'row-1', name: 'Stored', permanent: false, tabs: [{ title: 'Docs', url: 'https://example.com/docs' }] },
    ])
    expect(mockStart.mock.calls[0][1][3]).toEqual([])
  })

  it('400s before the model when the stored rows are encrypted and no groups were sent', async () => {
    setTables({
      subscriptions: { data: PRO_AI, error: null },
      groups: { data: [{ id: 'row-1', name: '', windows: { v: 1, iv: 'x', ct: 'y' } }], error: null },
    })
    const res = await organizePOST(req(url, {}))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('ai_invalid_request')
    expect(mockRunAiTask).not.toHaveBeenCalled()
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('400s when there are no groups to organize', async () => {
    setTables({ subscriptions: { data: PRO_AI, error: null }, groups: { data: [], error: null } })
    const res = await organizePOST(req(url, {}))
    expect(res.status).toBe(400)
    expect(mockRunAiTask).not.toHaveBeenCalled()
  })

  it('401s without a token', async () => {
    expect((await organizePOST(req(url, {}, null))).status).toBe(401)
  })

  it('401s on an invalid JWT', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'nope' } })
    expect((await organizePOST(req(url, {}))).status).toBe(401)
  })

  it('429s when the allowance cannot cover the call and starts no workflow', async () => {
    mockRunAiTask.mockRejectedValue(new AiRouteError(429, 'ai_quota_exceeded', { needed: 50, remaining: 2 }, 2))
    const res = await organizePOST(req(url, {}))
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'ai_quota_exceeded', needed: 50, remaining: 2 })
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('500s ai_failed when the workflow fails to start, still reporting the balance', async () => {
    mockStart.mockRejectedValue(new Error('boom'))
    const res = await organizePOST(req(url, {}))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'ai_failed' })
    expect(res.headers.get('X-AI-Credits-Remaining')).toBe('42')
  })
})

describe('GET /api/ai/organize', () => {
  const url = (q = '') => `http://localhost/api/ai/organize${q}`

  it('streams NDJSON for a run owned by the caller', async () => {
    mockFrom.mockReturnValue(builder({ data: { user_id: USER_ID } }))
    mockGetRun.mockReturnValue({
      getReadable: async () => new ReadableStream({ start: (c) => c.close() }),
    })
    const res = await organizeGET(req(url('?runId=run-1')))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/x-ndjson')
    expect(mockGetRun).toHaveBeenCalledWith('run-1')
  })

  it('401s without a token', async () => {
    expect((await organizeGET(req(url('?runId=r'), undefined, null))).status).toBe(401)
  })

  it('401s on an invalid JWT', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'nope' } })
    expect((await organizeGET(req(url('?runId=r')))).status).toBe(401)
  })

  it('400s when runId is missing', async () => {
    const res = await organizeGET(req(url()))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'ai_invalid_request', message: 'runId required' })
  })

  it('404s for a run belonging to another user (IDOR guard)', async () => {
    mockFrom.mockReturnValue(builder({ data: { user_id: 'someone-else' } }))
    expect((await organizeGET(req(url('?runId=run-1')))).status).toBe(404)
  })

  it('404s for an unknown run', async () => {
    mockFrom.mockReturnValue(builder({ data: null }))
    expect((await organizeGET(req(url('?runId=nope')))).status).toBe(404)
  })

  it('500s when the stream cannot be opened', async () => {
    mockFrom.mockReturnValue(builder({ data: { user_id: USER_ID } }))
    mockGetRun.mockReturnValue({
      getReadable: async () => {
        throw new Error('gone')
      },
    })
    const res = await organizeGET(req(url('?runId=run-1')))
    expect(res.status).toBe(500)
  })
})

// ─── organize/approve ─────────────────────────────────────────────────────────

describe('POST /api/ai/organize/approve', () => {
  const url = 'http://localhost/api/ai/organize/approve'
  const hookToken = `org-${USER_ID}-abc`

  function withSubscription(sub: unknown) {
    mockFrom.mockReturnValue(builder({ data: sub }))
  }

  beforeEach(() => withSubscription({ tier: 'pro_ai', status: 'active' }))

  it('resumes the workflow for an approving pro_ai user', async () => {
    const actions = [{ type: 'rename', groupId: 'g1', newName: 'Docs' }]
    const res = await approvePOST(req(url, { token: hookToken, approved: true, actions }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockResumeHook).toHaveBeenCalledWith(hookToken, { approved: true, actions })
  })

  it('passes rejection through to the workflow', async () => {
    await approvePOST(req(url, { token: hookToken, approved: false }))
    expect(mockResumeHook).toHaveBeenCalledWith(hookToken, {
      approved: false,
      actions: undefined,
    })
  })

  it('401s without a token', async () => {
    expect((await approvePOST(req(url, { token: hookToken, approved: true }, null))).status).toBe(401)
  })

  it('401s on an invalid JWT', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'nope' } })
    expect((await approvePOST(req(url, { token: hookToken, approved: true }))).status).toBe(401)
  })

  it.each([
    ['no subscription row', null],
    ['wrong tier', { tier: 'pro', status: 'active' }],
    ['inactive pro_ai', { tier: 'pro_ai', status: 'canceled' }],
  ])('403s for %s', async (_label, sub) => {
    withSubscription(sub)
    const res = await approvePOST(req(url, { token: hookToken, approved: true }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'ai_plan_required' })
    expect(mockResumeHook).not.toHaveBeenCalled()
  })

  it.each(['trialing', 'past_due'])('accepts an entitled %s Pro AI subscription', async (status) => {
    withSubscription({ tier: 'pro_ai', status })
    const res = await approvePOST(req(url, { token: hookToken, approved: true }))
    expect(res.status).toBe(200)
  })

  it("403s on another user's hook token (IDOR guard)", async () => {
    const res = await approvePOST(req(url, { token: 'org-other-user-abc', approved: true }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'ai_not_found' })
    expect(mockResumeHook).not.toHaveBeenCalled()
  })

  it('500s when resumeHook throws', async () => {
    mockResumeHook.mockRejectedValue(new Error('run finished'))
    const res = await approvePOST(req(url, { token: hookToken, approved: true }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'ai_failed' })
  })
})

// ─── Request-body validation ──────────────────────────────────────────────────

/** A POST whose body is sent as-is, for bodies that are not valid JSON. */
function rawReq(url: string, body: string) {
  return new NextRequest(url, { method: 'POST', headers: { authorization: 'Bearer jwt-token' }, body })
}

const LONG_TITLE = 'T'.repeat(AI_MAX_TITLE_LENGTH + 500)
const LONG_URL = `https://example.com/${'u'.repeat(AI_MAX_URL_LENGTH + 500)}`
const CUT_TITLE = LONG_TITLE.slice(0, AI_MAX_TITLE_LENGTH)
const CUT_URL = LONG_URL.slice(0, AI_MAX_URL_LENGTH)

/** A tab as the extension stores it: the prompt fields plus fields the prompts never use. */
const FULL_TAB = {
  id: 7,
  title: LONG_TITLE,
  url: LONG_URL,
  favIconUrl: 'data:image/png;base64,AAAA',
  note: 'private note',
  pinned: true,
}

const manyTabs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, title: 't', url: 'https://e.com' }))

const validation = [
  {
    name: 'group-tabs',
    handler: groupTabsPOST,
    url: 'http://localhost/api/ai/group-tabs',
    aiMock: () => mockGroupTabs,
    aiValue: [] as unknown,
    badMessage: 'tabs array required',
    wrongTyped: [
      null,
      [],
      'text',
      42,
      { tabs: {} },
      { tabs: [null] },
      { tabs: ['tab'] },
      { tabs: [{ id: '1', title: 'a', url: 'b' }] },
      { tabs: [{ id: 1.5, title: 'a', url: 'b' }] },
      { tabs: [{ id: 1, title: 5, url: 'b' }] },
      { tabs: [{ id: 1, title: 'a' }] },
    ] as unknown[],
    overCeiling: [['too many tabs', { tabs: manyTabs(AI_MAX_TABS_PER_LIST + 1) }]] as [string, unknown][],
    atCeiling: { tabs: manyTabs(AI_MAX_TABS_PER_LIST) } as unknown,
    longBody: { tabs: [FULL_TAB], extra: 'ignored' } as unknown,
    forwarded: [{ id: 7, title: CUT_TITLE, url: CUT_URL }] as unknown,
  },
  {
    name: 'name-group',
    handler: nameGroupPOST,
    url: 'http://localhost/api/ai/name-group',
    aiMock: () => mockNameGroup,
    aiValue: 'Name' as unknown,
    badMessage: 'tabs array required',
    wrongTyped: [
      null,
      [],
      'text',
      { tabs: 'nope' },
      { tabs: [null] },
      { tabs: [{ title: 'a', url: 5 }] },
      { tabs: [{ url: 'b' }] },
    ] as unknown[],
    overCeiling: [['too many tabs', { tabs: manyTabs(AI_MAX_TABS_PER_LIST + 1) }]] as [string, unknown][],
    atCeiling: { tabs: manyTabs(AI_MAX_TABS_PER_LIST) } as unknown,
    longBody: { tabs: [FULL_TAB] } as unknown,
    // Saved tabs all carry id 0 and the prompt does not use it, so it is not forwarded.
    forwarded: [{ title: CUT_TITLE, url: CUT_URL }] as unknown,
  },
  {
    name: 'tab-summary',
    handler: tabSummaryPOST,
    url: 'http://localhost/api/ai/tab-summary',
    aiMock: () => mockSummarizeTab,
    aiValue: 'Summary' as unknown,
    badMessage: 'tab object required',
    wrongTyped: [
      null,
      [],
      'text',
      { tab: null },
      { tab: 'nope' },
      { tab: { id: 1, title: 5, url: 'b' } },
      { url: 'https://e.com' },
      { title: 5, url: 'https://e.com' },
    ] as unknown[],
    overCeiling: [] as [string, unknown][],
    atCeiling: null as unknown,
    longBody: { tab: FULL_TAB } as unknown,
    forwarded: { title: CUT_TITLE, url: CUT_URL } as unknown,
  },
  {
    name: 'suggest-sessions',
    handler: suggestSessionsPOST,
    url: 'http://localhost/api/ai/suggest-sessions',
    aiMock: () => mockSuggestSessions,
    aiValue: { message: 'm', staleGroupIds: [] } as unknown,
    badMessage: 'groups array required',
    wrongTyped: [
      null,
      [],
      'text',
      { groups: 'nope' },
      { groups: [null] },
      { groups: [{ id: 1, name: 'x', tabs: [] }] },
      { groups: [{ id: 'g'.repeat(AI_MAX_ID_LENGTH + 1), name: 'x', tabs: [] }] },
      { groups: [{ id: 'g1', name: 5, tabs: [] }] },
      { groups: [{ id: 'g1', name: 'x' }] },
      { groups: [{ id: '', name: 'x', tabs: [] }] },
      { groups: [{ id: 'g1', name: 'x', tabs: 'nope' }] },
    ] as unknown[],
    overCeiling: [
      [
        'too many groups',
        { groups: Array.from({ length: AI_MAX_GROUPS + 1 }, (_, i) => ({ id: `g${i}`, name: 'x', tabs: [] })) },
      ],
      ['too many tabs in one group', { groups: [{ id: 'g1', name: 'x', tabs: manyTabs(AI_MAX_TABS_PER_LIST + 1) }] }],
      [
        'too many tabs in total',
        {
          groups: Array.from({ length: 4 }, (_, i) => ({
            id: `g${i}`,
            name: 'x',
            tabs: manyTabs(AI_MAX_TOTAL_TABS / 4 + 1),
          })),
        },
      ],
    ] as [string, unknown][],
    atCeiling: {
      groups: Array.from({ length: 3 }, (_, i) => ({ id: `g${i}`, name: 'x', tabs: manyTabs(AI_MAX_TOTAL_TABS / 3) })),
    } as unknown,
    longBody: {
      groups: [
        { id: 'g1', name: 'N'.repeat(AI_MAX_GROUP_NAME_LENGTH + 50), color: 'red', windows: [], tabs: [FULL_TAB] },
      ],
    } as unknown,
    forwarded: [
      { id: 'g1', name: 'N'.repeat(AI_MAX_GROUP_NAME_LENGTH), tabs: [{ title: CUT_TITLE, url: CUT_URL }] },
    ] as unknown,
  },
]

describe.each(validation)('POST /api/ai/$name request-body validation', (route) => {
  /** A rejected body is answered before the usage check and the model call. */
  async function expectRejected(res: Response, message: string) {
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'ai_invalid_request', message })
    expect(mockFrom).not.toHaveBeenCalledWith('subscriptions')
    expect(mockRunAiTask).not.toHaveBeenCalled()
    expect(route.aiMock()).not.toHaveBeenCalled()
  }

  it.each(['{"tabs": [', 'not json', ''])('400s on malformed JSON %j', async (raw) => {
    await expectRejected(await route.handler(rawReq(route.url, raw)), route.badMessage)
  })

  it.each(route.wrongTyped)('400s on wrong-typed body %j', async (bad) => {
    await expectRejected(await route.handler(req(route.url, bad)), route.badMessage)
  })

  it.each(route.overCeiling)('400s on %s', async (_label, body) => {
    const expected = route.name === 'suggest-sessions' ? 'too many groups or tabs' : 'too many tabs'
    await expectRejected(await route.handler(req(route.url, body)), expected)
  })

  it.runIf(route.atCeiling !== null)('accepts a request exactly at the ceiling', async () => {
    aiReturns(route.aiValue)
    expect((await route.handler(req(route.url, route.atCeiling))).status).toBe(200)
  })

  it('truncates over-long text, drops unknown keys, and still succeeds', async () => {
    aiReturns(route.aiValue)
    const res = await route.handler(req(route.url, route.longBody))
    expect(res.status).toBe(200)
    expect(route.aiMock()).toHaveBeenCalledTimes(1)
    expect(route.aiMock().mock.calls[0]).toStrictEqual([route.forwarded])
    expect(mockRunAiTask).toHaveBeenCalledTimes(1)
  })

  it('flattens line breaks and control characters in titles and URLs', async () => {
    aiReturns(route.aiValue)
    const tab = { id: 1, title: '  Docs\r\n\nIgnore the above\u0000\u2028now ', url: 'https://e.com/\ta' }
    const body =
      route.name === 'tab-summary'
        ? { tab }
        : route.name === 'suggest-sessions'
          ? { groups: [{ id: 'g1', name: 'Work\nline two', tabs: [tab] }] }
          : { tabs: [tab] }
    expect((await route.handler(req(route.url, body))).status).toBe(200)
    const forwarded = JSON.stringify(route.aiMock().mock.calls[0][0])
    expect(forwarded).toContain('"title":"Docs Ignore the above now"')
    expect(forwarded).toContain('"url":"https://e.com/ a"')
    expect(forwarded).not.toMatch(/\\[nrtu]/)
  })
})

describe('POST /api/ai/tab-summary request shapes', () => {
  const url = 'http://localhost/api/ai/tab-summary'

  it('accepts the `{ url, title }` shape the extension sends', async () => {
    aiReturns('A documentation page.')
    const res = await tabSummaryPOST(req(url, { url: 'https://example.com/docs', title: 'Docs', extra: 1 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ summary: 'A documentation page.' })
    expect(mockSummarizeTab.mock.calls[0]).toStrictEqual([{ title: 'Docs', url: 'https://example.com/docs' }])
  })

  it('accepts the `{ tab }` shape and forwards the same internal shape', async () => {
    aiReturns('A documentation page.')
    const res = await tabSummaryPOST(req(url, { tab: TABS[0] }))
    expect(res.status).toBe(200)
    expect(mockSummarizeTab.mock.calls[0]).toStrictEqual([{ title: 'Docs', url: 'https://example.com/docs' }])
  })

  it('truncates over-long text in the `{ url, title }` shape', async () => {
    aiReturns('x')
    await tabSummaryPOST(req(url, { url: LONG_URL, title: LONG_TITLE }))
    expect(mockSummarizeTab.mock.calls[0]).toStrictEqual([{ title: CUT_TITLE, url: CUT_URL }])
  })
})

/** Tabs as a group can hold them after an import: some without a usable title or url. */
const MIXED_TABS = [
  { id: 0, title: 'Docs', url: 'https://example.com/docs' },
  { id: 0, title: null, url: 'https://example.com/untitled' },
  { id: 0, url: 'https://example.com/no-title' },
  { id: 0, title: 42, url: 'https://example.com/number-title' },
  { id: 0, title: 'No url' },
  { id: 0, title: 'Null url', url: null },
  null,
  'tab',
  7,
  ['nested'],
]

/** What {@link MIXED_TABS} becomes: entries without a string url dropped, other titles `''`. */
const MIXED_TABS_KEPT = [
  { title: 'Docs', url: 'https://example.com/docs' },
  { title: '', url: 'https://example.com/untitled' },
  { title: '', url: 'https://example.com/no-title' },
  { title: '', url: 'https://example.com/number-title' },
]

describe('POST /api/ai/suggest-sessions tolerance for unusual tabs', () => {
  const url = 'http://localhost/api/ai/suggest-sessions'

  it('drops tabs without a string url, blanks other titles, and still succeeds', async () => {
    aiReturns({ message: 'm', staleGroupIds: [] })
    const res = await suggestSessionsPOST(req(url, { groups: [{ id: 'g1', name: 'Work', tabs: MIXED_TABS }] }))
    expect(res.status).toBe(200)
    expect(mockSuggestSessions.mock.calls[0]).toStrictEqual([[{ id: 'g1', name: 'Work', tabs: MIXED_TABS_KEPT }]])
  })

  it('leaves out a group whose tabs were all dropped and keeps one sent with no tabs', async () => {
    aiReturns({ message: 'm', staleGroupIds: [] })
    const groups = [
      { id: 'g1', name: 'Unreadable', tabs: [null, { title: 'x' }] },
      { id: 'g2', name: 'Empty', tabs: [] },
      { id: 'g3', name: 'Work', tabs: TABS },
    ]
    const res = await suggestSessionsPOST(req(url, { groups }))
    expect(res.status).toBe(200)
    expect(mockSuggestSessions.mock.calls[0]).toStrictEqual([
      [
        { id: 'g2', name: 'Empty', tabs: [] },
        { id: 'g3', name: 'Work', tabs: [{ title: 'Docs', url: 'https://example.com/docs' }] },
      ],
    ])
  })

  it('400s when every group had tabs and none were readable, without spending a credit', async () => {
    const res = await suggestSessionsPOST(req(url, { groups: [{ id: 'g1', name: 'Work', tabs: [null, { title: 'x' }] }] }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'ai_invalid_request', message: 'no readable tabs in groups' })
    expect(mockRunAiTask).not.toHaveBeenCalled()
    expect(mockSuggestSessions).not.toHaveBeenCalled()
  })
})

// ─── Entitlement with a valid body (real plan check) ──────────────────────────

const UNENTITLED: [string, unknown][] = [
  ['a free account', { tier: 'free', status: 'active' }],
  ['a Pro (non-AI) account', { tier: 'pro', status: 'active' }],
  ['a canceled Pro AI account', { tier: 'pro_ai', status: 'canceled' }],
  ['an incomplete Pro AI account', { tier: 'pro_ai', status: 'incomplete' }],
  ['an account with no subscription row', null],
]

const BYOK_SUB = { ...PRO_AI, ai_mode: 'byok', ai_monthly_credits: 0 }
const BYOK_KEY = `sk-ant-api03-${'k'.repeat(40)}`

describe.each(simpleRoutes)('POST /api/ai/$name entitlement with a well-formed body', (route) => {
  it.each(UNENTITLED)('403s %s and never reaches the model or the meter', async (_label, sub) => {
    setTables({ subscriptions: { data: sub, error: null } })
    const res = await route.handler(req(route.url, route.body))

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'ai_plan_required' })
    expect(mockRunAiTask).not.toHaveBeenCalled()
    expect(mockFrom).toHaveBeenCalledWith('subscriptions')
    expect(mockFrom).not.toHaveBeenCalledWith('ai_usage')
  })

  it.each(['trialing', 'past_due'])('serves an entitled %s Pro AI subscription', async (status) => {
    setTables({ subscriptions: { data: { ...PRO_AI, status }, error: null } })
    aiReturns(route.aiValue)
    expect((await route.handler(req(route.url, route.body))).status).toBe(200)
  })

  describe('BYOK subscription', () => {
    beforeEach(() => setTables({ subscriptions: { data: BYOK_SUB, error: null } }))

    it.each([
      ['no key header', null, 'byok_key_missing'],
      ['a key of no supported provider', 'not-a-key', 'byok_key_invalid'],
      ['an OpenAI admin key', `sk-admin-${'a'.repeat(40)}`, 'byok_key_invalid'],
    ])('400s with %s', async (_label, key, code) => {
      const r = req(route.url, route.body)
      if (key) r.headers.set('X-AI-Key', key)
      const res = await route.handler(r)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: code })
      expect(mockRunAiTask).not.toHaveBeenCalled()
    })

    it.each([
      ['an OpenAI key', `sk-proj-${'o'.repeat(40)}`, 'openai', 'gpt-6-luna', 'claude-haiku-5-5'],
      ['a Google key', `AIza${'g'.repeat(35)}`, 'google', 'gemini-3.1-flash-lite', 'gpt-6-luna'],
      ['an Anthropic key', BYOK_KEY, 'anthropic', 'claude-haiku-5-5', 'gemini-4-argon'],
    ])('sends %s to its provider, rejecting a model of another provider', async (_label, key, provider, auto, foreign) => {
      mockRunAiTask.mockResolvedValue({ result: route.aiValue, remaining: null })
      const ok = req(route.url, route.body)
      ok.headers.set('X-AI-Key', key)
      expect((await route.handler(ok)).status).toBe(200)
      const ctx = mockRunAiTask.mock.calls[0][1]
      expect(ctx).toMatchObject({ provider, model: auto, mode: 'byok', meter: null })

      const wrong = req(route.url, { ...route.body, model: foreign })
      wrong.headers.set('X-AI-Key', key)
      const res = await route.handler(wrong)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'ai_model_invalid' })
      expect(mockRunAiTask).toHaveBeenCalledTimes(1)
    })

    it('runs unmetered in BYOK mode when the key is sent', async () => {
      mockRunAiTask.mockResolvedValue({ result: route.aiValue, remaining: null })
      const r = req(route.url, route.body)
      r.headers.set('X-AI-Key', BYOK_KEY)
      const res = await route.handler(r)
      expect(res.status).toBe(200)
      const ctx = mockRunAiTask.mock.calls[0][1]
      expect(ctx.mode).toBe('byok')
      expect(ctx.meter).toBeNull()
    })
  })
})

describe.each([
  ['a client-supplied groups payload', { groups: [{ id: 'g1', name: 'Work', tabs: TABS }] }],
  ['no groups payload', {}],
])('POST /api/ai/organize entitlement with %s', (_bodyLabel, body) => {
  it.each(UNENTITLED)('403s %s and never starts a workflow or reads groups', async (_label, sub) => {
    setTables({ subscriptions: { data: sub, error: null } })
    mockStart.mockResolvedValue({ runId: 'run-never' })

    const res = await organizePOST(req('http://localhost/api/ai/organize', body))

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'ai_plan_required' })
    expect(mockRunAiTask).not.toHaveBeenCalled()
    expect(mockStart).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalledWith('groups')
    expect(mockFrom).not.toHaveBeenCalledWith('organize_runs')
  })

  it('400s byok_key_missing for a BYOK subscription without a key', async () => {
    setTables({ subscriptions: { data: BYOK_SUB, error: null } })
    const res = await organizePOST(req('http://localhost/api/ai/organize', body))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'byok_key_missing' })
    expect(mockStart).not.toHaveBeenCalled()
  })
})

// ─── organize: client-supplied groups ─────────────────────────────────────────

describe('POST /api/ai/organize request-body validation', () => {
  const url = 'http://localhost/api/ai/organize'

  beforeEach(() => {
    mockStart.mockResolvedValue({ runId: 'run-v' })
    aiReturns(PROPOSAL)
    setTables({
      subscriptions: { data: PRO_AI, error: null },
      groups: { data: [STORED_ROW], error: null },
    })
  })

  it.each([
    ['too many groups', { groups: Array.from({ length: AI_MAX_GROUPS + 1 }, (_, i) => ({ id: `g${i}`, name: 'x', tabs: [] })) }],
    ['too many tabs in one group', { groups: [{ id: 'g1', name: 'x', tabs: manyTabs(AI_MAX_TABS_PER_LIST + 1) }] }],
    [
      'too many tabs in total',
      { groups: Array.from({ length: 4 }, (_, i) => ({ id: `g${i}`, name: 'x', tabs: manyTabs(AI_MAX_TOTAL_TABS / 4 + 1) })) },
    ],
  ])('400s on %s without spending a credit or starting a workflow', async (_label, body) => {
    const res = await organizePOST(req(url, body))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'ai_invalid_request', message: 'too many groups or tabs' })
    expect(mockRunAiTask).not.toHaveBeenCalled()
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('forwards only the prompt fields, truncated, to the prompt', async () => {
    const groups = [
      { id: 'g0', name: 'Now Open', permanent: true, color: 'red', tabs: [FULL_TAB] },
      { id: 'g1', name: 'N'.repeat(AI_MAX_GROUP_NAME_LENGTH + 50), permanent: 'yes', tabs: [] },
    ]
    expect((await organizePOST(req(url, { groups }))).status).toBe(200)
    expect(mockOrganizeTask.mock.calls[0][0]).toStrictEqual([
      { id: 'g0', name: 'Now Open', tabs: [{ title: CUT_TITLE, url: CUT_URL }], permanent: true },
      // A non-boolean flag is ignored; the group was not first, so it is not permanent.
      { id: 'g1', name: 'N'.repeat(AI_MAX_GROUP_NAME_LENGTH), tabs: [], permanent: false },
    ])
  })

  it.each([
    ['malformed JSON', '{"groups": ['],
    ['an empty body', ''],
    ['a null body', 'null'],
    ['an array body', '[1,2]'],
    ['a string body', '"text"'],
  ])('falls back to the stored rows for %s', async (_label, raw) => {
    expect((await organizePOST(rawReq(url, raw))).status).toBe(200)
    expect(mockFrom).toHaveBeenCalledWith('groups')
    expect((mockOrganizeTask.mock.calls[0][0] as { id: string }[]).map((g) => g.id)).toEqual(['row-1'])
  })

  it('uses a present payload with unusual tabs: drops tabs without a string url and blanks other titles', async () => {
    const groups = [{ id: 'g0', name: 'Now Open', permanent: true, tabs: MIXED_TABS }]
    expect((await organizePOST(req(url, { groups }))).status).toBe(200)
    expect(mockOrganizeTask.mock.calls[0][0]).toStrictEqual([
      { id: 'g0', name: 'Now Open', tabs: MIXED_TABS_KEPT, permanent: true },
    ])
  })

  it('leaves out a group whose tabs were all dropped, so it is not presented as empty', async () => {
    const groups = [
      { id: 'g0', name: 'Now Open', permanent: true, tabs: TABS },
      { id: 'g1', name: 'Imported', tabs: [{ title: null, url: null }, 'tab'] },
      { id: 'g2', name: 'Work', tabs: TABS },
    ]
    expect((await organizePOST(req(url, { groups }))).status).toBe(200)
    const forwarded = mockOrganizeTask.mock.calls[0][0] as { id: string }[]
    expect(forwarded.map((g) => g.id)).toEqual(['g0', 'g2'])
  })

  it('keeps a group that was sent with no tabs', async () => {
    const groups = [
      { id: 'g0', name: 'Now Open', permanent: true, tabs: TABS },
      { id: 'g1', name: 'Empty', tabs: [] },
    ]
    expect((await organizePOST(req(url, { groups }))).status).toBe(200)
    expect(mockOrganizeTask.mock.calls[0][0]).toStrictEqual([
      { id: 'g0', name: 'Now Open', tabs: [{ title: 'Docs', url: 'https://example.com/docs' }], permanent: true },
      { id: 'g1', name: 'Empty', tabs: [], permanent: false },
    ])
  })

  describe('`permanent` is resolved from the position in the array as sent', () => {
    const readable = [{ title: 'Docs', url: 'https://example.com/docs' }]

    async function forwardedFor(groups: unknown[]) {
      expect((await organizePOST(req(url, { groups }))).status).toBe(200)
      return mockOrganizeTask.mock.calls[0][0]
    }

    it('does not promote the second group when the first is left out and no flag was sent', async () => {
      const forwarded = await forwardedFor([
        { id: 'g0', name: 'Now Open', tabs: [{ title: 'No url' }, null] },
        { id: 'g1', name: 'Work', tabs: TABS },
        { id: 'g2', name: 'Play', tabs: TABS },
      ])
      expect(forwarded).toStrictEqual([
        { id: 'g1', name: 'Work', tabs: readable, permanent: false },
        { id: 'g2', name: 'Play', tabs: readable, permanent: false },
      ])
    })

    it('marks the first group permanent when it is kept and no flag was sent', async () => {
      const forwarded = await forwardedFor([
        { id: 'g0', name: 'Now Open', tabs: TABS },
        { id: 'g1', name: 'Work', tabs: TABS },
      ])
      expect(forwarded).toStrictEqual([
        { id: 'g0', name: 'Now Open', tabs: readable, permanent: true },
        { id: 'g1', name: 'Work', tabs: readable, permanent: false },
      ])
    })

    it('passes an explicit flag through unchanged, whatever the position', async () => {
      const forwarded = await forwardedFor([
        { id: 'g0', name: 'Work', permanent: false, tabs: TABS },
        { id: 'g1', name: 'Now Open', permanent: true, tabs: TABS },
      ])
      expect(forwarded).toStrictEqual([
        { id: 'g0', name: 'Work', tabs: readable, permanent: false },
        { id: 'g1', name: 'Now Open', tabs: readable, permanent: true },
      ])
    })

    it('keeps an explicit flag on a later group when the first group is left out', async () => {
      const forwarded = await forwardedFor([
        { id: 'g0', name: 'Imported', permanent: false, tabs: ['tab'] },
        { id: 'g1', name: 'Now Open', permanent: true, tabs: TABS },
      ])
      expect(forwarded).toStrictEqual([{ id: 'g1', name: 'Now Open', tabs: readable, permanent: true }])
    })
  })

  it('400s when every group had tabs and none were readable, and starts no workflow', async () => {
    const groups = [
      { id: 'g1', name: 'Imported', tabs: [{ title: 'No url' }, null] },
      { id: 'g2', name: 'Also imported', tabs: ['tab'] },
    ]
    const res = await organizePOST(req(url, { groups }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'ai_invalid_request', message: 'no readable tabs in groups' })
    expect(mockStart).not.toHaveBeenCalled()
    expect(mockRunAiTask).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  /** Payloads that carry groups but whose structure is invalid, with the expected message. */
  const presentButInvalid: [string, unknown, string][] = [
    ['groups that is a string', { groups: 'nope' }, 'groups must be an array'],
    ['groups that is an object', { groups: { g1: {} } }, 'groups must be an array'],
    ['groups that is a number', { groups: 3 }, 'groups must be an array'],
    ['a null group', { groups: [null] }, 'invalid groups'],
    ['a group that is a string', { groups: ['g1'] }, 'invalid groups'],
    ['a non-string group id', { groups: [{ id: 1, name: 'x', tabs: [] }] }, 'invalid groups'],
    ['an empty group id', { groups: [{ id: '', name: 'x', tabs: [] }] }, 'invalid groups'],
    ['an over-long group id', { groups: [{ id: 'g'.repeat(AI_MAX_ID_LENGTH + 1), name: 'x', tabs: [] }] }, 'invalid groups'],
    ['a non-string group name', { groups: [{ id: 'g1', name: 5, tabs: [] }] }, 'invalid groups'],
    ['a group without tabs', { groups: [{ id: 'g1', name: 'x' }] }, 'invalid groups'],
    ['tabs that is not an array', { groups: [{ id: 'g1', name: 'x', tabs: 'nope' }] }, 'invalid groups'],
    [
      'one invalid group after a valid one',
      { groups: [{ id: 'g0', name: 'Now Open', tabs: TABS }, { id: 'g1', tabs: [] }] },
      'invalid groups',
    ],
  ]

  it.each(presentButInvalid)(
    '400s on %s and never falls back to the stored-rows read',
    async (_label, body, message) => {
      const res = await organizePOST(req(url, body))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'ai_invalid_request', message })
      // No model call and no read of the stored rows at all.
      expect(mockStart).not.toHaveBeenCalled()
      expect(mockRunAiTask).not.toHaveBeenCalled()
      expect(mockFrom).not.toHaveBeenCalled()
    }
  )

  it('never reads the stored rows when a non-empty groups array was sent', async () => {
    const bodies: unknown[] = [
      ...presentButInvalid.map(([, body]) => body),
      { groups: [{ id: 'g1', name: 'x', tabs: MIXED_TABS }] },
      { groups: [{ id: 'g1', name: 'x', tabs: [] }] },
    ]
    for (const body of bodies) {
      await organizePOST(req(url, body))
    }
    expect(mockFrom).not.toHaveBeenCalledWith('groups')
    // The two usable payloads did start a run, each with the client's groups.
    expect(mockOrganizeTask).toHaveBeenCalledTimes(2)
    expect(mockStart).toHaveBeenCalledTimes(2)
  })
})

// ─── organize/approve: body validation ────────────────────────────────────────

describe('POST /api/ai/organize/approve request-body validation', () => {
  const url = 'http://localhost/api/ai/organize/approve'
  const hookToken = `org-${USER_ID}-abc`

  beforeEach(() => {
    setTables({ subscriptions: { data: PRO_AI, error: null } })
    // `clearAllMocks` keeps implementations, so undo the rejection an earlier test installs.
    mockResumeHook.mockResolvedValue(undefined)
  })

  async function expectRejected(res: Response) {
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'ai_invalid_request', message: 'token and approved are required' })
    expect(mockResumeHook).not.toHaveBeenCalled()
  }

  it.each(['{"token": ', 'not json', ''])('400s on malformed JSON %j', async (raw) => {
    await expectRejected(await approvePOST(rawReq(url, raw)))
  })

  it.each([
    null,
    [],
    'text',
    {},
    { approved: true },
    { token: 42, approved: true },
    { token: '', approved: true },
    { token: `org-${USER_ID}-${'a'.repeat(AI_MAX_HOOK_TOKEN_LENGTH)}`, approved: true },
    { token: hookToken },
    { token: hookToken, approved: 'yes' },
    { token: hookToken, approved: 1 },
    { token: hookToken, approved: true, actions: null },
    { token: hookToken, approved: true, actions: 'all' },
    { token: hookToken, approved: true, actions: [null] },
    { token: hookToken, approved: true, actions: [{ type: 'archive', groupId: 'g1' }] },
    { token: hookToken, approved: true, actions: [{ type: 'rename', groupId: 'g1', name: 'Docs' }] },
    { token: hookToken, approved: true, actions: [{ type: 'rename', groupId: 'g1', newName: 'N'.repeat(AI_MAX_RENAME_LENGTH + 1) }] },
    { token: hookToken, approved: true, actions: [{ type: 'delete', groupId: 7 }] },
    { token: hookToken, approved: true, actions: [{ type: 'merge', sourceGroupId: 'g1' }] },
    { token: hookToken, approved: true, actions: [{ type: 'reorder', groupIds: ['g1', 2] }] },
    { token: hookToken, approved: true, actions: Array.from({ length: AI_MAX_ACTIONS + 1 }, () => ({ type: 'delete', groupId: 'g1' })) },
  ] as unknown[])('400s on wrong-typed body %j', async (bad) => {
    await expectRejected(await approvePOST(req(url, bad)))
  })

  it('accepts every action type and drops unknown keys before resuming', async () => {
    const actions = [
      { type: 'merge', sourceGroupId: 'g1', targetGroupId: 'g2', extra: 1 },
      { type: 'rename', groupId: 'g2', newName: 'Docs', userId: 'someone-else' },
      { type: 'delete', groupId: 'g3' },
      { type: 'reorder', groupIds: ['g2', 'g4'] },
    ]
    const res = await approvePOST(req(url, { token: hookToken, approved: true, actions, userId: 'someone-else' }))
    expect(res.status).toBe(200)
    expect(mockResumeHook.mock.calls[0]).toStrictEqual([
      hookToken,
      {
        approved: true,
        actions: [
          { type: 'merge', sourceGroupId: 'g1', targetGroupId: 'g2' },
          { type: 'rename', groupId: 'g2', newName: 'Docs' },
          { type: 'delete', groupId: 'g3' },
          { type: 'reorder', groupIds: ['g2', 'g4'] },
        ],
      },
    ])
  })

  it('checks the subscription before the body, so an unentitled caller gets 403 for any body', async () => {
    mockFrom.mockReturnValue(builder({ data: { tier: 'free', status: 'active' } }))
    expect((await approvePOST(req(url, { token: 42 }))).status).toBe(403)
    expect(mockResumeHook).not.toHaveBeenCalled()
  })

  it("still 403s on a well-formed body carrying another user's token", async () => {
    const res = await approvePOST(req(url, { token: 'org-other-user-abc', approved: false, actions: [] }))
    expect(res.status).toBe(403)
    expect(mockResumeHook).not.toHaveBeenCalled()
  })
})

// ─── AI feature flag (NEXT_PUBLIC_AI_ENABLED) kill switch ─────────────────────

const allHandlers = [
  { name: 'POST group-tabs', call: () => groupTabsPOST(req('http://localhost/api/ai/group-tabs', { tabs: TABS })) },
  { name: 'POST name-group', call: () => nameGroupPOST(req('http://localhost/api/ai/name-group', { tabs: TABS })) },
  { name: 'POST tab-summary', call: () => tabSummaryPOST(req('http://localhost/api/ai/tab-summary', { tab: TABS[0] })) },
  {
    name: 'POST suggest-sessions',
    call: () =>
      suggestSessionsPOST(
        req('http://localhost/api/ai/suggest-sessions', { groups: [{ id: 'g1', name: 'Work', tabs: TABS }] })
      ),
  },
  {
    name: 'POST organize',
    call: () =>
      organizePOST(req('http://localhost/api/ai/organize', { groups: [{ id: 'g1', name: 'Work', tabs: TABS }] })),
  },
  { name: 'GET organize', call: () => organizeGET(req('http://localhost/api/ai/organize?runId=run-1')) },
  {
    name: 'POST byok/verify',
    call: () => byokVerifyPOST(req('http://localhost/api/ai/byok/verify', {})),
  },
  {
    name: 'POST organize/approve',
    call: () =>
      approvePOST(req('http://localhost/api/ai/organize/approve', { token: `org-${USER_ID}-abc`, approved: true })),
  },
]

describe.each([
  ['unset', undefined],
  ['empty', ''],
  ['"false"', 'false'],
  ['"TRUE" (case-sensitive)', 'TRUE'],
  ['"1"', '1'],
])('AI flag off (%s)', (_label, value) => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', value)
    // Would succeed if reached — proves the guard, not a downstream failure, is what stops the call.
    aiReturns(PROPOSAL)
    mockStart.mockResolvedValue({ runId: 'run-1' })
  })

  it.each(allHandlers)('$name returns 503 ai_disabled with no side effects', async ({ call }) => {
    const res = await call()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'ai_disabled' })

    // Nothing past the guard ran: no auth lookup, no DB (incl. ai_usage), no workflow, no Anthropic.
    expect(mockGetUser).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockRunAiTask).not.toHaveBeenCalled()
    expect(mockStart).not.toHaveBeenCalled()
    expect(mockGetRun).not.toHaveBeenCalled()
    expect(mockResumeHook).not.toHaveBeenCalled()
    for (const ai of [mockGroupTabs, mockNameGroup, mockSummarizeTab, mockSuggestSessions, mockOrganizeTask]) {
      expect(ai).not.toHaveBeenCalled()
    }
  })
})
