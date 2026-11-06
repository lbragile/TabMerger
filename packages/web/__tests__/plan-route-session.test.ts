/**
 * GET /api/plan end to end with the real `getCurrentPlan` and a mocked cookie-session Supabase
 * client: a guest gets the guest plan, a signed-in caller gets only their own plan, every response
 * (including errors) is uncacheable, and a failure leaks nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const db = vi.hoisted(() => ({
  user: null as { id: string } | null,
  subscriptions: [] as Record<string, unknown>[],
  eqs: [] as [string, string, unknown][],
  createClientCalls: 0,
  createClientError: null as Error | null,
  getUserError: null as Error | null,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    db.createClientCalls += 1
    if (db.createClientError) throw db.createClientError
    return {
      auth: {
        getUser: async () => {
          if (db.getUserError) throw db.getUserError
          return { data: { user: db.user } }
        },
      },
      from: (table: string) => {
        let filter: [string, unknown] | null = null
        const builder: Record<string, unknown> = {}
        const chain = () => builder
        builder.select = chain
        builder.order = chain
        builder.limit = chain
        builder.eq = (column: string, value: unknown) => {
          db.eqs.push([table, column, value])
          filter = [column, value]
          return builder
        }
        builder.maybeSingle = async () => {
          const rows = table === 'subscriptions' ? db.subscriptions : []
          const own = filter ? rows.filter((r) => r[filter![0]] === filter![1]) : rows
          return { data: own[0] ?? null }
        }
        return builder
      },
    }
  },
}))
vi.mock('@/lib/stripe', () => ({ getPendingPlanChange: vi.fn().mockResolvedValue(null) }))

import { GET } from '@/app/api/plan/route'

const req = (query = '') => new NextRequest(`http://localhost/api/plan${query}`)
const END = '2026-12-01T00:00:00.000Z'

beforeEach(() => {
  vi.stubEnv('STRIPE_PRO_MONTHLY_PRICE_ID', 'price_pro_m')
  db.user = null
  db.subscriptions = []
  db.eqs = []
  db.createClientCalls = 0
  db.createClientError = null
  db.getUserError = null
})
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/plan with a real plan reader', () => {
  it('answers the guest plan to a caller without a session, reading no subscription', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ signedIn: false, tier: 'free', periodEnd: null })
    expect(db.eqs).toEqual([])
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })

  it('answers only the caller own plan, filtered by the session user id', async () => {
    db.user = { id: 'user-1' }
    db.subscriptions = [
      { user_id: 'user-2', id: 'sub_other', tier: 'pro_ai', status: 'active', stripe_price_id: 'x', current_period_end: END },
      { user_id: 'user-1', id: 'sub_1', tier: 'pro', status: 'active', stripe_price_id: 'price_pro_m', current_period_end: END },
    ]
    const res = await GET(req())
    const body = await res.json()
    expect(body).toMatchObject({ signedIn: true, tier: 'pro', interval: 'monthly', periodEnd: END })
    expect(db.eqs).toContainEqual(['subscriptions', 'user_id', 'user-1'])
    expect(db.eqs.every(([, , value]) => value === 'user-1')).toBe(true)
    expect(JSON.stringify(body)).not.toMatch(/user-2|sub_other|sub_1/)
  })

  it('answers free for a signed-in caller with no subscription', async () => {
    db.user = { id: 'user-3' }
    expect(await (await GET(req())).json()).toEqual({ signedIn: true, tier: 'free', periodEnd: null })
  })

  it('does not trust any identity in the URL: a userId query param changes nothing', async () => {
    db.user = { id: 'user-1' }
    db.subscriptions = [{ user_id: 'user-2', id: 's', tier: 'pro', status: 'active', stripe_price_id: 'price_pro_m' }]
    const body = await (await GET(req('?userId=user-2&user_id=user-2'))).json()
    expect(body.tier).toBe('free')
    expect(db.eqs.every(([, , value]) => value === 'user-1')).toBe(true)
  })

  it('reads the session once per request, through the cookie client', async () => {
    await GET(req('?pendingChange=1'))
    expect(db.createClientCalls).toBe(1)
  })

  it('also reads the scheduled change for a subscribed caller with pendingChange=1', async () => {
    db.user = { id: 'user-1' }
    db.subscriptions = [{ user_id: 'user-1', id: 'sub_1', tier: 'pro', status: 'active', stripe_price_id: 'price_pro_m' }]
    const body = await (await GET(req('?pendingChange=1'))).json()
    expect(body).toHaveProperty('pendingChange')
    const without = await (await GET(req())).json()
    expect(without).not.toHaveProperty('pendingChange')
  })

  it.each([
    ['the client cannot be created', () => (db.createClientError = new Error('cookies unavailable: secret-token-abc'))],
    ['the session lookup fails', () => (db.getUserError = new Error('auth down at db.internal:5432 password=hunter2'))],
  ])('answers 500 with an empty uncacheable body, and no internal detail, when %s', async (_label, arrange) => {
    arrange()
    const res = await GET(req('?pendingChange=1'))
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).toBe('')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect([...res.headers.values()].join(' ')).not.toMatch(/secret-token|hunter2|db\.internal/)
  })
})
