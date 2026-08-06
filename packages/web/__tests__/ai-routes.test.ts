/**
 * Unit tests for the AI API routes under app/api/ai/*.
 *
 * The Anthropic client is never constructed here — `@/lib/ai` is mocked wholesale,
 * so no real API key or network call is involved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetUser = vi.fn()
const mockFrom = vi.fn()
const mockSupabase = { auth: { getUser: mockGetUser }, from: mockFrom }

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn(async () => mockSupabase),
}))

const mockCheckUsage = vi.fn()
vi.mock('@/lib/ai-usage', () => ({
  AI_MONTHLY_CAP: 100,
  checkAndIncrementAIUsage: (...args: unknown[]) => mockCheckUsage(...args),
}))

const mockGroupTabs = vi.fn()
const mockNameGroup = vi.fn()
const mockSummarizeTab = vi.fn()
const mockSuggestSessions = vi.fn()
vi.mock('@/lib/ai', () => ({
  groupTabs: (...a: unknown[]) => mockGroupTabs(...a),
  nameGroup: (...a: unknown[]) => mockNameGroup(...a),
  summarizeTab: (...a: unknown[]) => mockSummarizeTab(...a),
  suggestSessions: (...a: unknown[]) => mockSuggestSessions(...a),
}))

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
  for (const m of ['select', 'eq', 'insert', 'upsert']) b[m] = () => b
  b.single = async () => result
  b.maybeSingle = async () => result
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res)
  return b
}

const TABS = [{ id: 1, title: 'Docs', url: 'https://example.com/docs' }]

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null })
  mockCheckUsage.mockResolvedValue({ allowed: true, remaining: 42 })
  mockFrom.mockReturnValue(builder({ data: null, error: null }))
})

// ─── Shared gating behaviour (the four simple routes) ─────────────────────────

const simpleRoutes = [
  {
    name: 'group-tabs',
    handler: groupTabsPOST,
    url: 'http://localhost/api/ai/group-tabs',
    body: { tabs: TABS },
    bad: [{}, { tabs: [] }, { tabs: 'nope' }],
    aiMock: () => mockGroupTabs,
    aiValue: [{ name: 'Docs', color: 'rgba(1,1,1,1)', tabIds: [1] }],
    key: 'groups',
    errorMessage: 'Failed to group tabs',
    badMessage: 'tabs array required',
  },
  {
    name: 'name-group',
    handler: nameGroupPOST,
    url: 'http://localhost/api/ai/name-group',
    body: { tabs: TABS },
    bad: [{}, { tabs: [] }],
    aiMock: () => mockNameGroup,
    aiValue: 'Dev Tools',
    key: 'name',
    errorMessage: 'Failed to name group',
    badMessage: 'tabs array required',
  },
  {
    name: 'tab-summary',
    handler: tabSummaryPOST,
    url: 'http://localhost/api/ai/tab-summary',
    body: { tab: TABS[0] },
    bad: [{}, { tab: { title: 'x', url: 'y' } }],
    aiMock: () => mockSummarizeTab,
    aiValue: 'A documentation page.',
    key: 'summary',
    errorMessage: 'Failed to summarize tab',
    badMessage: 'tab object required',
  },
  {
    name: 'suggest-sessions',
    handler: suggestSessionsPOST,
    url: 'http://localhost/api/ai/suggest-sessions',
    body: { groups: [{ name: 'Work', tabs: TABS }] },
    bad: [{}, { groups: [] }],
    aiMock: () => mockSuggestSessions,
    aiValue: 'Save Work as a session.',
    key: 'suggestion',
    errorMessage: 'Failed to suggest sessions',
    badMessage: 'groups array required',
  },
]

describe.each(simpleRoutes)('POST /api/ai/$name', (route) => {
  it('returns the expected payload and remaining-quota header', async () => {
    route.aiMock().mockResolvedValue(route.aiValue)
    const res = await route.handler(req(route.url, route.body))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ [route.key]: route.aiValue })
    expect(res.headers.get('X-AI-Requests-Remaining')).toBe('42')
    expect(mockCheckUsage).toHaveBeenCalledWith(mockSupabase, USER_ID)
  })

  it('401s with no Authorization header', async () => {
    const res = await route.handler(req(route.url, route.body, null))
    expect(res.status).toBe(401)
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('401s when the JWT does not resolve to a user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } })
    const res = await route.handler(req(route.url, route.body))
    expect(res.status).toBe(401)
    expect(mockCheckUsage).not.toHaveBeenCalled()
  })

  it('429s when the monthly cap is exhausted', async () => {
    mockCheckUsage.mockResolvedValue({ allowed: false, remaining: 0 })
    const res = await route.handler(req(route.url, route.body))
    expect(res.status).toBe(429)
    expect(route.aiMock()).not.toHaveBeenCalled()
  })

  it('403s when not entitled but quota remains', async () => {
    mockCheckUsage.mockResolvedValue({ allowed: false, remaining: 5 })
    const res = await route.handler(req(route.url, route.body))
    expect(res.status).toBe(403)
  })

  it.each(route.bad)('400s on malformed body %j', async (bad) => {
    const res = await route.handler(req(route.url, bad))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: route.badMessage })
    expect(route.aiMock()).not.toHaveBeenCalled()
  })

  it('500s when the Anthropic call throws', async () => {
    route.aiMock().mockRejectedValue(new Error('overloaded'))
    const res = await route.handler(req(route.url, route.body))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: route.errorMessage })
  })
})

// ─── organize ─────────────────────────────────────────────────────────────────

describe('POST /api/ai/organize', () => {
  const url = 'http://localhost/api/ai/organize'

  it('starts a workflow, persists run ownership, returns runId + hook token', async () => {
    mockStart.mockResolvedValue({ runId: 'run-1' })
    const insert = vi.fn(() => builder({ data: null, error: null }))
    mockFrom.mockReturnValue({ insert })

    const res = await organizePOST(req(url, {}))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.runId).toBe('run-1')
    expect(json.token).toMatch(new RegExp(`^org-${USER_ID}-[0-9a-f]{32}$`))
    expect(mockStart).toHaveBeenCalledWith('wf', [USER_ID, json.token])
    expect(mockFrom).toHaveBeenCalledWith('organize_runs')
    expect(insert).toHaveBeenCalledWith({ run_id: 'run-1', user_id: USER_ID })
  })

  it('401s without a token', async () => {
    expect((await organizePOST(req(url, {}, null))).status).toBe(401)
  })

  it('401s on an invalid JWT', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'nope' } })
    expect((await organizePOST(req(url, {}))).status).toBe(401)
  })

  it('429s when the cap is hit and 403s when merely unentitled', async () => {
    mockCheckUsage.mockResolvedValue({ allowed: false, remaining: 0 })
    expect((await organizePOST(req(url, {}))).status).toBe(429)
    mockCheckUsage.mockResolvedValue({ allowed: false, remaining: 3 })
    expect((await organizePOST(req(url, {}))).status).toBe(403)
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('500s when the workflow fails to start', async () => {
    mockStart.mockRejectedValue(new Error('boom'))
    const res = await organizePOST(req(url, {}))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to start workflow' })
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
    expect(await res.json()).toEqual({ error: 'runId required' })
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
    const actions = [{ type: 'rename', groupId: 'g1', name: 'Docs' }]
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
    expect(mockResumeHook).not.toHaveBeenCalled()
  })

  it("403s on another user's hook token (IDOR guard)", async () => {
    const res = await approvePOST(req(url, { token: 'org-other-user-abc', approved: true }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
    expect(mockResumeHook).not.toHaveBeenCalled()
  })

  it('500s when resumeHook throws', async () => {
    mockResumeHook.mockRejectedValue(new Error('run finished'))
    const res = await approvePOST(req(url, { token: hookToken, approved: true }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to resume workflow' })
  })
})
