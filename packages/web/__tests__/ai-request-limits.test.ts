/**
 * Abuse limits on the `/api/ai/*` routes (`lib/ai-request-limits.ts`, `handleAiRoute` in
 * `lib/ai-route.ts`): per-IP and per-user rate limits, the concurrency slot, the credit
 * pre-check, the body size cap, and the model-call deadline that keeps a slow call from
 * outliving the function. The routes run for real with the real `runAiTask`; only the Anthropic
 * SDK, `fetch` and Supabase are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  countTokens: vi.fn(),
  options: [] as unknown[],
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: sdk.create, countTokens: sdk.countTokens }
    constructor(opts?: unknown) {
      sdk.options.push(opts)
    }
  },
}))

const mockGetUser = vi.fn()
const mockFrom = vi.fn()
const mockRpc = vi.fn()
const mockSupabase = { auth: { getUser: mockGetUser }, from: mockFrom, rpc: mockRpc }

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn(async () => mockSupabase),
}))

import { POST as nameGroupPOST, maxDuration as nameGroupMax } from '@/app/api/ai/name-group/route'
import { POST as groupTabsPOST, maxDuration as groupTabsMax } from '@/app/api/ai/group-tabs/route'
import { POST as tabSummaryPOST, maxDuration as tabSummaryMax } from '@/app/api/ai/tab-summary/route'
import { maxDuration as describeMax } from '@/app/api/ai/describe-group/route'
import { maxDuration as suggestMax } from '@/app/api/ai/suggest-sessions/route'
import { POST as organizePOST, maxDuration as organizeMax } from '@/app/api/ai/organize/route'
import { POST as verifyPOST, maxDuration as verifyMax } from '@/app/api/ai/byok/verify/route'
import { POST as devUsagePOST } from '@/app/api/ai/dev-usage/route'
import {
  ANTHROPIC_CLIENT_TIMEOUT_MS,
  ANTHROPIC_MAX_RETRIES,
  AiRouteError,
  deadlineOptions,
  mapAnthropicError,
  providerAnswered,
} from '@/lib/ai'
import { callGoogle, callOpenAi } from '@/lib/ai-providers'
import {
  AI_BYOK_KEY_FAILURE_LIMIT,
  AI_BYOK_VERIFY_RATE_LIMIT,
  AI_DEADLINE_MARGIN_MS,
  AI_IP_RATE_LIMIT,
  AI_MAX_CONCURRENT_REQUESTS,
  AI_SLOT_LEASE_MARGIN_SECONDS,
  AI_USER_RATE_LIMIT,
  acquireAiSlot,
  clientIpKey,
  hashIpKey,
  ipRateLimitKey,
  managedCreditsExhausted,
  peekRateLimit,
} from '@/lib/ai-request-limits'
import {
  AI_MAX_BODY_BYTES_GROUPS,
  AI_MAX_BODY_BYTES_ONE_TAB,
  AI_MAX_BODY_BYTES_SMALL,
  AI_MAX_BODY_BYTES_TAB_LIST,
  AI_BODY_READ_TIMEOUT_MS,
  readJsonBodyWithin,
} from '@/lib/ai-validation'
import { aiLimitRpc, TEST_SLOT_ID } from './helpers/aiLimits'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const USER_ID = 'user-uuid-1'
const BYOK_KEY = `sk-ant-api03-${'b'.repeat(48)}`
const MANAGED = { tier: 'pro_ai', status: 'active', ai_mode: 'managed', ai_monthly_credits: 2500 }
const BYOK = { tier: 'pro_ai', status: 'active', ai_mode: 'byok', ai_monthly_credits: 0 }
const TABS = [{ id: 1, title: 'React docs', url: 'https://react.dev/learn' }]
const NAME_ANSWER = { names: ['React Learning', 'React Docs', 'Frontend Reading'] }

function builder(result: unknown) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'insert', 'upsert', 'order', 'delete']) b[m] = () => b
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
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

/** Opus: Haiku's reservation and real cost both round to 1 credit, leaving nothing to settle. */
const nameReq = (headers: Record<string, string> = {}) =>
  req('name-group', { tabs: TABS, model: 'claude-opus-5-5' }, headers)

function message(json: unknown) {
  return {
    content: [{ type: 'text', text: JSON.stringify(json) }],
    usage: { input_tokens: 400, output_tokens: 20, cache_creation_input_tokens: null, cache_read_input_tokens: null },
    stop_reason: 'end_turn',
  }
}

/** Per-bucket `rate_limit_take` answers; buckets not listed allow. */
let bucketAnswers: Record<string, unknown> = {}
/** Overrides for other RPCs (by function name). */
let rpcAnswers: Record<string, unknown> = {}

const rpcCalls = (fn: string) =>
  mockRpc.mock.calls.filter(([name]) => name === fn).map(([, args]) => args as Record<string, unknown>)
const rpcNames = () => mockRpc.mock.calls.map(([name]) => name as string)
const limitedRow = (retry: number) => ({ data: [{ allowed: false, retry_after_seconds: retry }], error: null })

beforeEach(() => {
  vi.clearAllMocks()
  sdk.options.length = 0
  sdk.create.mockReset()
  sdk.countTokens.mockReset()
  mockRpc.mockReset()
  bucketAnswers = {}
  rpcAnswers = {}
  vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-managed-key')
  vi.stubEnv('VERCEL', '')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-secret')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null })
  withSubscription(MANAGED)
  sdk.countTokens.mockResolvedValue({ input_tokens: 400 })
  sdk.create.mockResolvedValue(message(NAME_ANSWER))
  mockRpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'rate_limit_take' && typeof args.p_bucket === 'string' && args.p_bucket in bucketAnswers) {
      return bucketAnswers[args.p_bucket]
    }
    if (fn in rpcAnswers) return rpcAnswers[fn]
    const limits = aiLimitRpc(fn)
    if (limits) return limits
    if (fn === 'ai_reserve_credits') return { data: [{ allowed: true, remaining: 2000, cap: 2500 }], error: null }
    if (fn === 'ai_settle_credits') return { data: 100, error: null }
    throw new Error(`unexpected rpc ${fn}`)
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ─── Client IP keys ───────────────────────────────────────────────────────────

describe('ipRateLimitKey', () => {
  it('keys IPv4 by the full address', () => {
    expect(ipRateLimitKey('203.0.113.7')).toBe('4:203.0.113.7')
  })

  it('keys IPv6 by its /64 prefix, whatever the notation', () => {
    const a = ipRateLimitKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')
    expect(a).toBe('6:2001:db8:1:2::/64')
    expect(ipRateLimitKey('2001:0db8:0001:0002::1')).toBe(a)
    expect(ipRateLimitKey('2001:DB8:1:2:ffff::')).toBe(a)
    expect(ipRateLimitKey('[2001:db8:1:2::9]')).toBe(a)
    expect(ipRateLimitKey('2001:db8:1:2::9%eth0')).toBe(a)
  })

  it('gives another /64 another key', () => {
    expect(ipRateLimitKey('2001:db8:1:3::1')).toBe('6:2001:db8:1:3::/64')
    expect(ipRateLimitKey('::1')).toBe('6:0:0:0:0::/64')
  })

  it('keys an IPv4-mapped IPv6 address as the IPv4 address', () => {
    expect(ipRateLimitKey('::ffff:198.51.100.4')).toBe('4:198.51.100.4')
    expect(ipRateLimitKey('::ffff:c633:6404')).toBe('4:198.51.100.4')
  })

  it.each(['', 'unknown', '999.1.1.1', '2001:db8::1::2', 'example.com'])('returns null for %j', (raw) => {
    expect(ipRateLimitKey(raw)).toBeNull()
  })
})

describe('clientIpKey', () => {
  const headers = (h: Record<string, string>) => new Headers(h)

  it('trusts no header off Vercel, where a client could type any of them', () => {
    expect(clientIpKey(headers({ 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '203.0.113.7' }), false)).toBeNull()
  })

  it('on Vercel prefers x-vercel-forwarded-for, then x-real-ip, then the first x-forwarded-for hop', () => {
    expect(
      clientIpKey(
        headers({ 'x-vercel-forwarded-for': '203.0.113.1', 'x-real-ip': '203.0.113.2', 'x-forwarded-for': '203.0.113.3' }),
        true
      )
    ).toBe(hashIpKey('4:203.0.113.1'))
    expect(clientIpKey(headers({ 'x-real-ip': '203.0.113.2', 'x-forwarded-for': '203.0.113.3' }), true)).toBe(hashIpKey('4:203.0.113.2'))
    expect(clientIpKey(headers({ 'x-forwarded-for': '203.0.113.3, 10.0.0.1' }), true)).toBe(hashIpKey('4:203.0.113.3'))
  })

  it('returns null on Vercel without a readable address', () => {
    expect(clientIpKey(headers({}), true)).toBeNull()
    expect(clientIpKey(headers({ 'x-real-ip': 'garbage' }), true)).toBeNull()
  })

  it('reads VERCEL=1 from the environment by default', () => {
    vi.stubEnv('VERCEL', '1')
    expect(clientIpKey(headers({ 'x-real-ip': '203.0.113.2' }))).toBe(hashIpKey('4:203.0.113.2'))
  })

  it('never returns the raw address: an HMAC of the normalised key, keyed by a server secret', () => {
    const key = clientIpKey(headers({ 'x-real-ip': '203.0.113.2' }), true)
    expect(key).toMatch(/^ip:[0-9a-f]{64}$/)
    expect(key).not.toContain('203.0.113.2')
    expect(hashIpKey('4:203.0.113.2', 'secret-a')).toBe(hashIpKey('4:203.0.113.2', 'secret-a'))
    expect(hashIpKey('4:203.0.113.2', 'secret-a')).not.toBe(hashIpKey('4:203.0.113.2', 'secret-b'))
    expect(hashIpKey('4:203.0.113.2', 'secret-a')).not.toBe(hashIpKey('4:203.0.113.3', 'secret-a'))
  })

  it('skips the per-IP key when there is no secret to hash with', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    expect(clientIpKey(headers({ 'x-real-ip': '203.0.113.2' }), true)).toBeNull()
  })
})

// ─── Per-IP limit (before auth) ───────────────────────────────────────────────

describe('per-IP rate limit', () => {
  beforeEach(() => vi.stubEnv('VERCEL', '1'))

  it('429s an IP over its limit before any auth lookup', async () => {
    bucketAnswers[AI_IP_RATE_LIMIT.name] = limitedRow(42)
    const res = await nameGroupPOST(nameReq({ 'x-real-ip': '203.0.113.7' }))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
    expect(await res.json()).toEqual({ error: 'rate_limited', code: 'rate_limited', retryAfterSeconds: 42 })
    expect(mockGetUser).not.toHaveBeenCalled()
    expect(sdk.countTokens).not.toHaveBeenCalled()
    expect(rpcCalls('rate_limit_take')).toEqual([
      expect.objectContaining({ p_bucket: 'ai-ip', p_key: hashIpKey('4:203.0.113.7'), p_windows: [60, 3600], p_maxes: [120, 1500] }),
    ])
  })

  it('counts every address of one IPv6 /64 against the same key', async () => {
    await nameGroupPOST(nameReq({ 'x-vercel-forwarded-for': '2001:db8:aa:bb::1' }))
    await nameGroupPOST(nameReq({ 'x-vercel-forwarded-for': '2001:db8:aa:bb:ffff:1:2:3' }))
    const ipKeys = rpcCalls('rate_limit_take').filter((a) => a.p_bucket === 'ai-ip').map((a) => a.p_key)
    const sameNet = hashIpKey('6:2001:db8:aa:bb::/64')
    expect(ipKeys).toEqual([sameNet, sameNet])
  })

  it('503s ai_overloaded when the limiter is unavailable (fail closed), before auth', async () => {
    bucketAnswers[AI_IP_RATE_LIMIT.name] = { data: null, error: { code: '55P03' } }
    const res = await nameGroupPOST(nameReq({ 'x-real-ip': '203.0.113.7' }))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'ai_overloaded' })
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('is skipped where no trusted IP header exists (off Vercel); the user limit still applies', async () => {
    vi.stubEnv('VERCEL', '')
    const res = await nameGroupPOST(nameReq({ 'x-real-ip': '203.0.113.7' }))
    expect(res.status).toBe(200)
    expect(rpcCalls('rate_limit_take').map((a) => a.p_bucket)).toEqual(['ai-user'])
  })

  it('stops an unauthenticated flood at the IP limit, not at auth', async () => {
    bucketAnswers[AI_IP_RATE_LIMIT.name] = limitedRow(5)
    const res = await nameGroupPOST(req('name-group', { tabs: TABS }, { authorization: '', 'x-real-ip': '203.0.113.9' }))
    expect(res.status).toBe(429)
    expect(mockGetUser).not.toHaveBeenCalled()
  })
})

// ─── Per-user limit (after auth) ──────────────────────────────────────────────

describe('per-user rate limit', () => {
  it('429s a user over the limit before the plan check, the body and the model', async () => {
    bucketAnswers[AI_USER_RATE_LIMIT.name] = limitedRow(30)
    const res = await nameGroupPOST(nameReq())
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('30')
    expect((await res.json()).error).toBe('rate_limited')
    expect(mockFrom).not.toHaveBeenCalled()
    expect(sdk.countTokens).not.toHaveBeenCalled()
    expect(rpcCalls('rate_limit_take')).toEqual([
      { p_bucket: 'ai-user', p_key: USER_ID, p_windows: [60, 3600, 86400], p_maxes: [30, 300, 1500] },
    ])
  })

  it('503s ai_overloaded when the limiter is unavailable (fail closed)', async () => {
    bucketAnswers[AI_USER_RATE_LIMIT.name] = { data: null, error: { code: 'PGRST202' } }
    const res = await groupTabsPOST(req('group-tabs', { tabs: TABS }))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'ai_overloaded' })
    expect(sdk.countTokens).not.toHaveBeenCalled()
  })

  it('503s when the limiter call throws', async () => {
    mockRpc.mockImplementationOnce(async () => {
      throw new Error('network')
    })
    const res = await tabSummaryPOST(req('tab-summary', { url: 'https://react.dev', title: 'React' }))
    expect(res.status).toBe(503)
  })

  it('every bucket fails closed', () => {
    for (const b of [AI_IP_RATE_LIMIT, AI_USER_RATE_LIMIT, AI_BYOK_VERIFY_RATE_LIMIT]) expect(b.onError).toBe('deny')
  })
})

// ─── byok/verify ──────────────────────────────────────────────────────────────

describe('/api/ai/byok/verify limits', () => {
  beforeEach(() => withSubscription(BYOK))

  it('takes its own, tighter bucket instead of the model routes’ one', async () => {
    sdk.countTokens.mockResolvedValue({ input_tokens: 1 })
    const res = await verifyPOST(req('byok/verify', {}, { 'x-ai-key': BYOK_KEY }))
    expect(res.status).toBe(200)
    expect(rpcCalls('rate_limit_take')).toEqual([
      { p_bucket: 'ai-byok-verify', p_key: USER_ID, p_windows: [60, 3600, 86400], p_maxes: [5, 20, 50] },
    ])
    expect(AI_BYOK_VERIFY_RATE_LIMIT.limits[0].max).toBeLessThan(AI_USER_RATE_LIMIT.limits[0].max)
  })

  it('429s over the limit without calling the provider', async () => {
    bucketAnswers[AI_BYOK_VERIFY_RATE_LIMIT.name] = limitedRow(60)
    const res = await verifyPOST(req('byok/verify', {}, { 'x-ai-key': BYOK_KEY }))
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe('rate_limited')
    expect(sdk.countTokens).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('503s when its limiter is unavailable', async () => {
    bucketAnswers[AI_BYOK_VERIFY_RATE_LIMIT.name] = { data: null, error: { code: 'XX000' } }
    expect((await verifyPOST(req('byok/verify', {}, { 'x-ai-key': BYOK_KEY }))).status).toBe(503)
    expect(sdk.countTokens).not.toHaveBeenCalled()
  })

  it('holds a concurrency slot around the key check and releases it', async () => {
    sdk.countTokens.mockRejectedValue(Object.assign(new Error('bad key'), { status: 401 }))
    const res = await verifyPOST(req('byok/verify', {}, { 'x-ai-key': BYOK_KEY }))
    expect(res.status).toBe(400)
    expect(rpcCalls('ai_slot_acquire')).toEqual([{ p_user: USER_ID, p_max: AI_MAX_CONCURRENT_REQUESTS, p_lease_seconds: verifyMax + AI_SLOT_LEASE_MARGIN_SECONDS }])
    expect(rpcCalls('ai_slot_release')).toEqual([{ p_user: USER_ID, p_slot: TEST_SLOT_ID }])
  })

  it('gives count_tokens a deadline', async () => {
    sdk.countTokens.mockResolvedValue({ input_tokens: 1 })
    await verifyPOST(req('byok/verify', {}, { 'x-ai-key': BYOK_KEY }))
    const options = sdk.countTokens.mock.calls[0][1] as { timeout: number; signal: AbortSignal }
    expect(options.timeout).toBeGreaterThan(0)
    expect(options.timeout).toBeLessThanOrEqual(verifyMax * 1000 - AI_DEADLINE_MARGIN_MS)
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('413s an oversized body', async () => {
    const res = await verifyPOST(req('byok/verify', { model: 'x'.repeat(AI_MAX_BODY_BYTES_SMALL) }, { 'x-ai-key': BYOK_KEY }))
    expect(res.status).toBe(413)
    expect(sdk.countTokens).not.toHaveBeenCalled()
  })
})

// ─── Credit pre-check ─────────────────────────────────────────────────────────

describe('managed credit pre-check', () => {
  it('answers 429 ai_quota_exceeded at 0 credits without count_tokens, a reservation or a slot', async () => {
    rpcAnswers.ai_credits_exhausted = { data: true, error: null }
    const res = await nameGroupPOST(nameReq())
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'ai_quota_exceeded', remaining: 0 })
    expect(res.headers.get('X-AI-Credits-Remaining')).toBe('0')
    expect(sdk.countTokens).not.toHaveBeenCalled()
    expect(sdk.create).not.toHaveBeenCalled()
    expect(rpcNames()).not.toContain('ai_reserve_credits')
    expect(rpcNames()).not.toContain('ai_slot_acquire')
    expect(rpcCalls('ai_credits_exhausted')).toEqual([{ p_user: USER_ID, p_month: expect.stringMatching(/^\d{4}-\d{2}$/) }])
  })

  it('checks the same month the reservation uses', async () => {
    await nameGroupPOST(nameReq())
    expect(rpcCalls('ai_credits_exhausted')[0].p_month).toBe(rpcCalls('ai_reserve_credits')[0].p_month)
  })

  it('leaves the decision to the reservation when the pre-check fails', async () => {
    rpcAnswers.ai_credits_exhausted = { data: null, error: { code: 'XX000' } }
    const res = await nameGroupPOST(nameReq())
    expect(res.status).toBe(200)
    expect(sdk.countTokens).toHaveBeenCalledTimes(1)
  })

  it('is skipped for own-key subscribers (nothing is metered)', async () => {
    withSubscription(BYOK)
    const res = await nameGroupPOST(nameReq({ 'x-ai-key': BYOK_KEY }))
    expect(res.status).toBe(200)
    expect(rpcNames()).not.toContain('ai_credits_exhausted')
  })

  it('managedCreditsExhausted is true only for a true answer, false on errors', async () => {
    const supabase = { rpc: vi.fn() }
    supabase.rpc.mockResolvedValueOnce({ data: true, error: null })
    expect(await managedCreditsExhausted(supabase as never, USER_ID, '2026-10')).toBe(true)
    supabase.rpc.mockResolvedValueOnce({ data: false, error: null })
    expect(await managedCreditsExhausted(supabase as never, USER_ID, '2026-10')).toBe(false)
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { code: 'x' } })
    expect(await managedCreditsExhausted(supabase as never, USER_ID, '2026-10')).toBe(false)
    supabase.rpc.mockRejectedValueOnce(new Error('down'))
    expect(await managedCreditsExhausted(supabase as never, USER_ID, '2026-10')).toBe(false)
  })
})

// ─── Concurrency slot ─────────────────────────────────────────────────────────

describe('concurrency slot', () => {
  const slotLease = (max: number) => ({ p_user: USER_ID, p_max: AI_MAX_CONCURRENT_REQUESTS, p_lease_seconds: max + AI_SLOT_LEASE_MARGIN_SECONDS })

  it('is acquired after the pre-check and released after a successful call', async () => {
    const res = await nameGroupPOST(nameReq())
    expect(res.status).toBe(200)
    expect(rpcCalls('ai_slot_acquire')).toEqual([slotLease(nameGroupMax)])
    expect(rpcCalls('ai_slot_release')).toEqual([{ p_user: USER_ID, p_slot: TEST_SLOT_ID }])
    const order = rpcNames()
    expect(order.indexOf('ai_credits_exhausted')).toBeLessThan(order.indexOf('ai_slot_acquire'))
    expect(order.indexOf('ai_slot_acquire')).toBeLessThan(order.indexOf('ai_reserve_credits'))
    expect(order.at(-1)).toBe('ai_slot_release')
  })

  it('is released when the model call fails', async () => {
    sdk.create.mockRejectedValue(Object.assign(new Error('Overloaded'), { status: 529 }))
    const res = await nameGroupPOST(nameReq())
    expect(res.status).toBe(503)
    expect(rpcCalls('ai_slot_release')).toHaveLength(1)
  })

  it('is released when the route throws something unexpected', async () => {
    sdk.countTokens.mockRejectedValue(new TypeError('boom'))
    const res = await groupTabsPOST(req('group-tabs', { tabs: TABS }))
    expect(res.status).toBe(500)
    expect(rpcCalls('ai_slot_release')).toHaveLength(1)
  })

  it('429s rate_limited when all the user’s slots are in use, before count_tokens', async () => {
    rpcAnswers.ai_slot_acquire = { data: null, error: null }
    const res = await nameGroupPOST(nameReq())
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('2')
    expect((await res.json()).error).toBe('rate_limited')
    expect(sdk.countTokens).not.toHaveBeenCalled()
    expect(rpcNames()).not.toContain('ai_slot_release')
  })

  it('503s when the slot cannot be checked (fail closed)', async () => {
    rpcAnswers.ai_slot_acquire = { data: null, error: { code: '55P03' } }
    const res = await nameGroupPOST(nameReq())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'ai_overloaded' })
    expect(sdk.countTokens).not.toHaveBeenCalled()
  })

  it('acquireAiSlot: odd answers refuse, a thrown call refuses, release runs once and never throws', async () => {
    const supabase = { rpc: vi.fn() }
    supabase.rpc.mockResolvedValueOnce({ data: 42, error: null })
    expect((await acquireAiSlot(supabase as never, USER_ID, 60)).kind).toBe('refused')
    supabase.rpc.mockRejectedValueOnce(new Error('down'))
    expect((await acquireAiSlot(supabase as never, USER_ID, 60)).kind).toBe('refused')

    supabase.rpc.mockResolvedValueOnce({ data: 'slot-x', error: null })
    const slot = await acquireAiSlot(supabase as never, USER_ID, 60)
    if (slot.kind !== 'acquired') throw new Error('expected a slot')
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { code: 'x' } })
    await slot.release()
    await slot.release()
    expect(supabase.rpc.mock.calls.filter(([fn]) => fn === 'ai_slot_release')).toHaveLength(1)

    supabase.rpc.mockResolvedValueOnce({ data: 'slot-y', error: null })
    const other = await acquireAiSlot(supabase as never, USER_ID, 60)
    if (other.kind !== 'acquired') throw new Error('expected a slot')
    supabase.rpc.mockRejectedValueOnce(new Error('down'))
    await expect(other.release()).resolves.toBeUndefined()
  })
})

// ─── Timeouts and maxDuration ─────────────────────────────────────────────────

describe('model-call deadline', () => {
  it('maxDuration fits Vercel (≤ 300 s with fluid compute on every plan) and leaves the margin', () => {
    for (const max of [groupTabsMax, suggestMax, organizeMax]) expect(max).toBe(300)
    for (const max of [nameGroupMax, describeMax, tabSummaryMax]) expect(max).toBe(120)
    expect(verifyMax).toBe(45)
    for (const max of [groupTabsMax, suggestMax, organizeMax, nameGroupMax, describeMax, tabSummaryMax, verifyMax]) {
      expect(max * 1000).toBeGreaterThan(AI_DEADLINE_MARGIN_MS)
    }
  })

  it('builds clients with a bounded timeout and one retry (not the SDK’s 10 min and 2)', async () => {
    await nameGroupPOST(nameReq())
    expect(sdk.options[0]).toMatchObject({ timeout: ANTHROPIC_CLIENT_TIMEOUT_MS, maxRetries: ANTHROPIC_MAX_RETRIES })
  })

  it('sends the metered managed create with no retry, so "sent" is exactly one request', async () => {
    const res = await nameGroupPOST(nameReq())
    expect(res.status).toBe(200)
    expect(sdk.create.mock.calls[0][1]).toMatchObject({ maxRetries: 0 })
    // count_tokens is free and keeps the client's retry.
    expect(sdk.countTokens.mock.calls[0][1]).not.toHaveProperty('maxRetries')
  })

  it('keeps the client retry on an own-key Claude create (not metered)', async () => {
    withSubscription(BYOK)
    const res = await nameGroupPOST(nameReq({ 'x-ai-key': BYOK_KEY }))
    expect(res.status).toBe(200)
    expect(sdk.create.mock.calls[0][1]).not.toHaveProperty('maxRetries')
    expect(sdk.options[0]).toMatchObject({ maxRetries: ANTHROPIC_MAX_RETRIES })
  })

  it('gives count_tokens and create the time left before maxDuration minus the margin', async () => {
    const t0 = 1_800_000_000_000
    vi.spyOn(Date, 'now').mockReturnValue(t0)
    await organizePOST(req('organize', { groups: [{ id: 'g1', name: 'Docs', tabs: TABS }] }))
    const budget = organizeMax * 1000 - AI_DEADLINE_MARGIN_MS
    for (const call of [sdk.countTokens.mock.calls[0], sdk.create.mock.calls[0]]) {
      const options = call[1] as { timeout: number; signal: AbortSignal }
      expect(options.timeout).toBe(budget)
      expect(options.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it('a call that runs into the deadline releases the reservation and the slot (503)', async () => {
    const t0 = 1_800_000_000_000
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0)
    // count_tokens returns, but by then the deadline has passed: create must not be sent.
    sdk.countTokens.mockImplementation(async () => {
      now.mockReturnValue(t0 + nameGroupMax * 1000)
      return { input_tokens: 400 }
    })
    const res = await nameGroupPOST(nameReq())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'ai_overloaded' })
    expect(sdk.create).not.toHaveBeenCalled()
    const [reserve] = rpcCalls('ai_reserve_credits') as { p_amount: number }[]
    expect(rpcCalls('ai_settle_credits')).toEqual([expect.objectContaining({ p_delta: -reserve.p_amount })])
    expect(rpcCalls('ai_slot_release')).toHaveLength(1)
  })

  it.each(['APIUserAbortError', 'APIConnectionTimeoutError', 'APIConnectionError'])(
    'a call cut off after it was sent (%s) keeps its reservation as the charge, and releases the slot (503)',
    async (name) => {
      sdk.create.mockRejectedValueOnce(Object.assign(new Error('cut off'), { name }))
      const res = await nameGroupPOST(nameReq())
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'ai_overloaded' })
      expect(rpcCalls('ai_reserve_credits')).toHaveLength(1)
      expect(rpcCalls('ai_settle_credits')).toEqual([])
      expect(rpcCalls('ai_slot_release')).toHaveLength(1)
    }
  )

  it.each([
    ['an overload (529)', 529, 503],
    ['a server error (500)', 500, 503],
    ['a bad request (400)', 400, 500],
  ])('a call Anthropic answered with %s releases the whole reservation', async (_label, status, expected) => {
    sdk.create.mockRejectedValueOnce(Object.assign(new Error('http error'), { status }))
    const res = await nameGroupPOST(nameReq())
    expect(res.status).toBe(expected)
    const [reserve] = rpcCalls('ai_reserve_credits') as { p_amount: number }[]
    expect(rpcCalls('ai_settle_credits')).toEqual([expect.objectContaining({ p_delta: -reserve.p_amount })])
    expect(rpcCalls('ai_slot_release')).toHaveLength(1)
  })

  it('providerAnswered: only an error with an HTTP status', () => {
    expect(providerAnswered(Object.assign(new Error('x'), { status: 529 }))).toBe(true)
    expect(providerAnswered({ status: 400 })).toBe(true)
    expect(providerAnswered(Object.assign(new Error('x'), { name: 'APIUserAbortError' }))).toBe(false)
    expect(providerAnswered(new AiRouteError(503, 'ai_overloaded'))).toBe(false)
    expect(providerAnswered('boom')).toBe(false)
  })

  it('deadlineOptions: nothing without a deadline, 503 once it passed', () => {
    expect(deadlineOptions(undefined)).toEqual({})
    expect(() => deadlineOptions(Date.now() - 1)).toThrow(AiRouteError)
    const options = deadlineOptions(Date.now() + 5000)
    expect(options.timeout).toBeGreaterThan(4000)
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('maps an abort to ai_overloaded in both modes', () => {
    const abort = Object.assign(new Error('aborted'), { name: 'APIUserAbortError' })
    expect(mapAnthropicError(abort, 'managed').code).toBe('ai_overloaded')
    expect(mapAnthropicError(abort, 'byok').code).toBe('ai_overloaded')
  })

  it('own-key OpenAI and Google calls time out at the route’s deadline', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })))
    const prompt = {
      model: 'gpt-6-luna' as const,
      system: 's',
      user: 'u',
      schema: {},
      schemaName: 'x',
      maxOutputTokens: 10,
      effort: 'none' as const,
      timeoutMs: 12_345,
    }
    await callOpenAi('sk-test', prompt).catch(() => {})
    await callGoogle('AIza-test', { ...prompt, model: 'gemini-3.1-flash-lite' }).catch(() => {})
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([12_345, 12_345])
  })

  it('own-key calls through a route get the deadline too', async () => {
    withSubscription(BYOK)
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(NAME_ANSWER) }] }] }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)
    const t0 = 1_800_000_000_000
    vi.spyOn(Date, 'now').mockReturnValue(t0)
    await nameGroupPOST(req('name-group', { tabs: TABS }, { 'x-ai-key': `sk-proj-${'a'.repeat(48)}` }))
    expect(fetchMock).toHaveBeenCalled()
    expect(timeout).toHaveBeenCalledWith(nameGroupMax * 1000 - AI_DEADLINE_MARGIN_MS)
  })
})

// ─── Body size ────────────────────────────────────────────────────────────────

describe('request body size', () => {
  it('caps follow the routes’ real ceilings', () => {
    expect(AI_MAX_BODY_BYTES_ONE_TAB).toBe(64 * 1024)
    expect(AI_MAX_BODY_BYTES_TAB_LIST).toBe(1024 * 1024)
    expect(AI_MAX_BODY_BYTES_GROUPS).toBe(2 * 1024 * 1024)
    expect(AI_MAX_BODY_BYTES_SMALL).toBe(4 * 1024)
  })

  it('413s a body over the cap after the plan check, before parsing and the model', async () => {
    const big = { url: 'https://example.com', title: 'x'.repeat(AI_MAX_BODY_BYTES_ONE_TAB) }
    const res = await tabSummaryPOST(req('tab-summary', big))
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'ai_invalid_request', message: 'request body too large' })
    expect(mockFrom).toHaveBeenCalledWith('subscriptions')
    expect(sdk.countTokens).not.toHaveBeenCalled()
    expect(rpcNames()).not.toContain('ai_slot_acquire')
  })

  it('403s a free account before reading its body at all', async () => {
    withSubscription({ tier: 'free', status: 'active' })
    const request = req('tab-summary', { url: 'https://example.com', title: 'x' })
    const read = vi.spyOn(request, 'json')
    const res = await tabSummaryPOST(request)
    expect(res.status).toBe(403)
    expect(read).not.toHaveBeenCalled()
    expect(request.bodyUsed).toBe(false)
  })

  it('accepts a body just under the cap', async () => {
    const title = 'x'.repeat(AI_MAX_BODY_BYTES_ONE_TAB - 200)
    sdk.create.mockResolvedValue(message({ summary: 'A page.' }))
    const res = await tabSummaryPOST(req('tab-summary', { url: 'https://example.com', title }))
    expect(res.status).toBe(200)
  })

  it('the dev usage route caps its body too', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await devUsagePOST(req('dev-usage', { count: 1, pad: 'x'.repeat(AI_MAX_BODY_BYTES_SMALL) }))
    expect(res.status).toBe(413)
  })

  describe('readJsonBodyWithin', () => {
    const stream = (chunks: string[]) =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const c of chunks) controller.enqueue(new TextEncoder().encode(c))
          controller.close()
        },
      })
    const streamed = (chunks: string[], headers: Record<string, string> = {}) =>
      new Request('http://localhost/x', { method: 'POST', body: stream(chunks), headers, duplex: 'half' } as RequestInit)

    it('refuses at once when content-length is over the cap', async () => {
      const request = new Request('http://localhost/x', { method: 'POST', body: '{}', headers: { 'content-length': '2000' } })
      const read = vi.spyOn(request, 'json')
      expect(await readJsonBodyWithin(request, 1000)).toEqual({ ok: false, reason: 'too_large' })
      expect(read).not.toHaveBeenCalled()
    })

    it('stops reading a body without content-length once it passes the cap', async () => {
      const result = await readJsonBodyWithin(streamed(['{"a":"', 'x'.repeat(600), 'x'.repeat(600), '"}']), 1000)
      expect(result).toEqual({ ok: false, reason: 'too_large' })
    })

    it('does not trust a content-length that understates the body', async () => {
      const result = await readJsonBodyWithin(streamed(['x'.repeat(800), 'x'.repeat(800)], { 'content-length': '10' }), 1000)
      expect(result).toEqual({ ok: false, reason: 'too_large' })
    })

    it('parses a streamed body within the cap', async () => {
      expect(await readJsonBodyWithin(streamed(['{"a":', '1}']), 1000)).toEqual({ ok: true, body: { a: 1 } })
    })

    it('reads an empty, malformed or unreadable body as undefined', async () => {
      expect(await readJsonBodyWithin(new Request('http://localhost/x', { method: 'POST' }), 1000)).toEqual({ ok: true, body: undefined })
      expect(await readJsonBodyWithin(streamed(['{"a":']), 1000)).toEqual({ ok: true, body: undefined })
      const broken = new Request('http://localhost/x', {
        method: 'POST',
        body: new ReadableStream({ pull(c) { c.error(new Error('reset')) } }),
        duplex: 'half',
      } as RequestInit)
      expect(await readJsonBodyWithin(broken, 1000)).toEqual({ ok: true, body: undefined })
    })

    it('gives up on a body that is still arriving after the time limit, and cancels its reader', async () => {
      let cancelled = false
      const stalled = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"a":'))
        },
        cancel() {
          cancelled = true
        },
      })
      const request = new Request('http://localhost/x', { method: 'POST', body: stalled, duplex: 'half' } as RequestInit)
      expect(await readJsonBodyWithin(request, 1000, 30)).toEqual({ ok: false, reason: 'timeout' })
      await Promise.resolve()
      expect(cancelled).toBe(true)
    })

    it('waits 10 s by default', () => {
      expect(AI_BODY_READ_TIMEOUT_MS).toBe(10_000)
    })

    it('ignores a non-numeric content-length and reads with the bound', async () => {
      const request = new Request('http://localhost/x', { method: 'POST', body: '{"a":2}', headers: { 'content-length': 'abc' } })
      expect(await readJsonBodyWithin(request, 1000)).toEqual({ ok: true, body: { a: 2 } })
    })
  })
})

// ─── Own-key failure bucket ───────────────────────────────────────────────────

describe('own-key failure bucket', () => {
  const OPENAI_KEY = `sk-proj-${'a'.repeat(48)}`
  const peekCalls = () => rpcCalls('rate_limit_peek')
  const failureTakes = () => rpcCalls('rate_limit_take').filter((a) => a.p_bucket === AI_BYOK_KEY_FAILURE_LIMIT.name)

  beforeEach(() => withSubscription(BYOK))

  it('is 5 an hour and 10 a day, and fails closed', () => {
    expect(AI_BYOK_KEY_FAILURE_LIMIT.limits).toEqual([
      { windowSeconds: 3600, max: 5 },
      { windowSeconds: 86400, max: 10 },
    ])
    expect(AI_BYOK_KEY_FAILURE_LIMIT.onError).toBe('deny')
  })

  it('is peeked (not counted) before an own-key model call', async () => {
    const res = await nameGroupPOST(nameReq({ 'x-ai-key': BYOK_KEY }))
    expect(res.status).toBe(200)
    expect(peekCalls()).toEqual([{ p_bucket: 'ai-byok-key-failure', p_key: USER_ID, p_windows: [3600, 86400], p_maxes: [5, 10] }])
    expect(failureTakes()).toEqual([])
  })

  it('is peeked only once the slot is held, so a request waiting for a slot cannot slip past it', async () => {
    await nameGroupPOST(nameReq({ 'x-ai-key': BYOK_KEY }))
    const order = rpcNames()
    expect(order.indexOf('ai_slot_acquire')).toBeLessThan(order.indexOf('rate_limit_peek'))
    expect(order.indexOf('rate_limit_peek')).toBeLessThan(order.indexOf('ai_slot_release'))
  })

  it('refuses own-key requests with 429 once used up, before the provider, and frees the slot once', async () => {
    rpcAnswers.rate_limit_peek = limitedRow(1800)
    const res = await nameGroupPOST(nameReq({ 'x-ai-key': BYOK_KEY }))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('1800')
    expect((await res.json()).error).toBe('rate_limited')
    expect(sdk.create).not.toHaveBeenCalled()
    expect(rpcCalls('ai_slot_acquire')).toHaveLength(1)
    expect(rpcCalls('ai_slot_release')).toEqual([{ p_user: USER_ID, p_slot: TEST_SLOT_ID }])
    expect(rpcNames().at(-1)).toBe('ai_slot_release')
    // A refusal is not a key failure: nothing is counted.
    expect(failureTakes()).toEqual([])
  })

  it('is not peeked when no slot is free (the slot refusal comes first)', async () => {
    rpcAnswers.ai_slot_acquire = { data: null, error: null }
    const res = await nameGroupPOST(nameReq({ 'x-ai-key': BYOK_KEY }))
    expect(res.status).toBe(429)
    expect(peekCalls()).toEqual([])
    expect(rpcNames()).not.toContain('ai_slot_release')
  })

  it('503s when the bucket cannot be read, and frees the slot once', async () => {
    rpcAnswers.rate_limit_peek = { data: null, error: { code: 'XX000' } }
    const res = await nameGroupPOST(nameReq({ 'x-ai-key': BYOK_KEY }))
    expect(res.status).toBe(503)
    expect(sdk.create).not.toHaveBeenCalled()
    expect(rpcCalls('ai_slot_release')).toHaveLength(1)
  })

  it.each([
    ['a rejected key (401)', { status: 401 }, 'byok_key_invalid'],
    ['an unfunded key (402)', { status: 402 }, 'byok_billing'],
  ])('counts %s as one failure', async (_label, error, code) => {
    sdk.create.mockRejectedValueOnce(Object.assign(new Error('provider'), error))
    const res = await nameGroupPOST(nameReq({ 'x-ai-key': BYOK_KEY }))
    expect((await res.json()).error).toBe(code)
    expect(failureTakes()).toEqual([{ p_bucket: 'ai-byok-key-failure', p_key: USER_ID, p_windows: [3600, 86400], p_maxes: [5, 10] }])
  })

  it('counts an OpenAI key the provider rejects, too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'invalid_api_key' } }), { status: 401 })))
    const res = await groupTabsPOST(req('group-tabs', { tabs: TABS }, { 'x-ai-key': OPENAI_KEY }))
    expect((await res.json()).error).toBe('byok_key_invalid')
    expect(failureTakes()).toHaveLength(1)
  })

  it('does not count other failures (an overloaded provider)', async () => {
    sdk.create.mockRejectedValueOnce(Object.assign(new Error('busy'), { status: 529 }))
    await nameGroupPOST(nameReq({ 'x-ai-key': BYOK_KEY }))
    expect(failureTakes()).toEqual([])
  })

  it('is not used for managed requests', async () => {
    withSubscription(MANAGED)
    await nameGroupPOST(nameReq())
    expect(peekCalls()).toEqual([])
  })

  it('is shared with byok/verify: peeked with the slot held, counted on a rejected key', async () => {
    sdk.countTokens.mockRejectedValueOnce(Object.assign(new Error('bad key'), { status: 401 }))
    const res = await verifyPOST(req('byok/verify', {}, { 'x-ai-key': BYOK_KEY }))
    expect(res.status).toBe(400)
    expect(peekCalls()).toHaveLength(1)
    expect(failureTakes()).toHaveLength(1)
    const order = rpcNames()
    expect(order.indexOf('ai_slot_acquire')).toBeLessThan(order.indexOf('rate_limit_peek'))
    // The failure is counted before the slot is released.
    const failureAt = mockRpc.mock.calls.findIndex(
      ([fn, args]) => fn === 'rate_limit_take' && (args as { p_bucket?: string }).p_bucket === AI_BYOK_KEY_FAILURE_LIMIT.name
    )
    expect(failureAt).toBeLessThan(order.indexOf('ai_slot_release'))
    expect(rpcCalls('ai_slot_release')).toHaveLength(1)
  })

  it('byok/verify refuses once used up, without calling the provider, and frees the slot once', async () => {
    rpcAnswers.rate_limit_peek = limitedRow(60)
    const res = await verifyPOST(req('byok/verify', {}, { 'x-ai-key': BYOK_KEY }))
    expect(res.status).toBe(429)
    expect(sdk.countTokens).not.toHaveBeenCalled()
    expect(rpcCalls('ai_slot_acquire')).toHaveLength(1)
    expect(rpcCalls('ai_slot_release')).toEqual([{ p_user: USER_ID, p_slot: TEST_SLOT_ID }])
    expect(failureTakes()).toEqual([])
  })

  it('byok/verify does not peek when no slot is free', async () => {
    rpcAnswers.ai_slot_acquire = { data: null, error: null }
    const res = await verifyPOST(req('byok/verify', {}, { 'x-ai-key': BYOK_KEY }))
    expect(res.status).toBe(429)
    expect(peekCalls()).toEqual([])
    expect(sdk.countTokens).not.toHaveBeenCalled()
  })

  it('peekRateLimit reads odd answers and failures per the bucket', async () => {
    const supabase = { rpc: vi.fn() }
    supabase.rpc.mockResolvedValueOnce({ data: [{ allowed: false, retry_after_seconds: 0 }], error: null })
    expect(await peekRateLimit(AI_BYOK_KEY_FAILURE_LIMIT, USER_ID, supabase as never)).toEqual({ kind: 'limited', retryAfterSeconds: 1 })
    supabase.rpc.mockResolvedValueOnce({ data: [], error: null })
    expect((await peekRateLimit(AI_BYOK_KEY_FAILURE_LIMIT, USER_ID, supabase as never)).kind).toBe('unavailable')
    supabase.rpc.mockRejectedValueOnce(new Error('down'))
    expect((await peekRateLimit({ ...AI_BYOK_KEY_FAILURE_LIMIT, onError: 'allow' }, USER_ID, supabase as never)).kind).toBe('allowed')
  })
})

// ─── Slow body upload through a route ─────────────────────────────────────────

describe('slow request body', () => {
  it('408s a body still arriving after 10 s, before the model and the slot', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const stalled = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"tabs":'))
        },
      })
      const request = new NextRequest('http://localhost/api/ai/name-group', {
        method: 'POST',
        headers: { authorization: 'Bearer jwt-token' },
        body: stalled,
        duplex: 'half',
      } as ConstructorParameters<typeof NextRequest>[1])
      const pending = nameGroupPOST(request)
      await vi.advanceTimersByTimeAsync(AI_BODY_READ_TIMEOUT_MS + 1)
      const res = await pending
      expect(res.status).toBe(408)
      expect(await res.json()).toEqual({ error: 'ai_invalid_request', message: 'request body took too long' })
      expect(sdk.countTokens).not.toHaveBeenCalled()
      expect(rpcNames()).not.toContain('ai_slot_acquire')
    } finally {
      vi.useRealTimers()
    }
  })
})
