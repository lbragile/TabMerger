/**
 * Checkout-funnel analytics sent by the Stripe webhook:
 *   - `checkout.session.expired` → `checkout_abandoned`: signature checked first, writes nothing,
 *     always 200, the same payload on a redelivery, and nothing for a session it can't attribute.
 *   - `checkout.session.completed` → `purchase` (GA4 recommended) alongside the original
 *     `checkout_completed`.
 * Privacy: no `user_id`, a random client id per event (never derived from the account or the
 * browser session), and Stripe session ids only as an HMAC keyed with STRIPE_WEBHOOK_SECRET, which
 * is never sent to Google. Everything is sent after the response.
 */
import { createHmac } from 'crypto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ANALYTICS_EVENTS } from '@tabmerger/shared'

const { mockConstructEvent, mockSubscriptionsRetrieve, mockFrom, mockUpsert, mockUpdate, mockInsert } =
  vi.hoisted(() => ({
    mockConstructEvent: vi.fn(),
    mockSubscriptionsRetrieve: vi.fn(),
    mockFrom: vi.fn(),
    mockUpsert: vi.fn(),
    mockUpdate: vi.fn(),
    mockInsert: vi.fn(),
  }))

// next/server's after() needs a live request scope: collect the callbacks and run them with
// flushAfter(), as Next does once the response is sent.
const { afterTasks } = vi.hoisted(() => ({ afterTasks: [] as Array<() => unknown> }))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => {
    afterTasks.push(task)
  },
}))
async function flushAfter() {
  while (afterTasks.length) await afterTasks.shift()!()
}

vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: { constructEvent: mockConstructEvent },
    subscriptions: { retrieve: mockSubscriptionsRetrieve },
    checkout: { sessions: { listLineItems: vi.fn() } },
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn().mockResolvedValue({ from: mockFrom }),
}))

const USER_ID = '3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b'
const SESSION_ID = 'cs_test_abandoned_1'
const GA_SECRET = 'secret_test'
const WEBHOOK_SECRET = 'whsec_test'
/** The opaque id GA gets for a session: HMAC-SHA256 keyed with a subkey of STRIPE_WEBHOOK_SECRET. */
const subkey = createHmac('sha256', WEBHOOK_SECRET).update('tabmerger:ga-session-id:v1').digest()
const hmac = (id: string) => createHmac('sha256', subkey).update(id).digest('hex')
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function makeRequest(sig: string | null = 'test-sig') {
  return new NextRequest('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { ...(sig ? { 'stripe-signature': sig } : {}), 'content-type': 'text/plain' },
    body: '{}',
  })
}

function expiredEvent(session: Record<string, unknown> = {}) {
  return {
    id: 'evt_expired_1',
    type: 'checkout.session.expired',
    data: {
      object: {
        id: SESSION_ID,
        object: 'checkout.session',
        mode: 'subscription',
        status: 'expired',
        metadata: { user_id: USER_ID, tier: 'pro', interval: 'yearly' },
        ...session,
      },
    },
  }
}

const fetchMock = vi.fn()

/** The GA4 Measurement Protocol bodies sent, parsed. */
function gaBodies() {
  return fetchMock.mock.calls.map((call) => JSON.parse(call[1].body))
}

/** No payload may identify the account or carry a raw Stripe id. */
function expectNoIdentifiers() {
  for (const call of fetchMock.mock.calls) {
    const raw = call[1].body as string
    expect(JSON.parse(raw)).not.toHaveProperty('user_id')
    expect(raw).not.toContain(USER_ID)
    expect(raw).not.toMatch(/cs_(test|live)_/)
    expect(raw).not.toMatch(/sub_|cus_/)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  afterTasks.length = 0
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET)
  vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', 'G-TEST123')
  vi.stubEnv('GA_API_SECRET', GA_SECRET)
  vi.stubEnv('STRIPE_PRO_MONTHLY_PRICE_ID', 'price_pro_monthly')
  vi.stubEnv('STRIPE_PRO_YEARLY_PRICE_ID', 'price_pro_yearly')
  vi.stubEnv('STRIPE_PRO_AI_MONTHLY_PRICE_ID', 'price_pro_ai_monthly')
  vi.stubEnv('STRIPE_PRO_AI_YEARLY_PRICE_ID', 'price_pro_ai_yearly')
  fetchMock.mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', fetchMock)

  mockUpsert.mockResolvedValue({ error: null })
  mockInsert.mockResolvedValue({ error: null })
  mockUpdate.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
  mockFrom.mockImplementation(() => ({
    upsert: mockUpsert,
    update: mockUpdate,
    insert: mockInsert,
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: USER_ID } }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null }),
  }))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('checkout.session.expired → checkout_abandoned', () => {
  it('sends one checkout_abandoned after the response, under a random client id and no user_id', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    mockConstructEvent.mockReturnValue(expiredEvent())

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
    await flushAfter()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('measurement_id=G-TEST123&api_secret=secret_test')
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    const [body] = gaBodies()
    expect(body.client_id).toMatch(UUID_V4)
    expectNoIdentifiers()
    expect(body.events).toEqual([
      {
        name: ANALYTICS_EVENTS.checkoutAbandoned,
        params: {
          checkout_session_id: hmac(SESSION_ID),
          environment: expect.any(String),
          tier: 'pro',
          billing_interval: 'yearly',
          value: 42.99,
          currency: 'USD',
          items: [{ item_id: 'pro', item_name: 'Pro', item_variant: 'yearly', price: 42.99, quantity: 1 }],
        },
      },
    ])
  })

  it('writes nothing and calls nothing at Stripe', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    mockConstructEvent.mockReturnValue(expiredEvent())

    await POST(makeRequest())
    await flushAfter()

    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
  })

  it('is idempotent: a redelivery answers 200 again with the same payload and still writes nothing', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    mockConstructEvent.mockReturnValue(expiredEvent())

    const first = await POST(makeRequest())
    await flushAfter()
    const second = await POST(makeRequest())
    await flushAfter()

    expect([first.status, second.status]).toEqual([200, 200])
    // Same event, same opaque checkout_session_id; only the random client id differs.
    const [a, b] = gaBodies()
    expect(b.events).toEqual(a.events)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('still answers 200 when GA is down, so Stripe has no reason to send it again', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    mockConstructEvent.mockReturnValue(expiredEvent())

    const res = await POST(makeRequest())
    await flushAfter()

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  describe('signature path', () => {
    it('a request without a signature is 400 and reports nothing', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')

      const res = await POST(makeRequest(null))
      await flushAfter()

      expect(res.status).toBe(400)
      expect(mockConstructEvent).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('a forged signature is 400 and reports nothing', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockConstructEvent.mockImplementation(() => {
        throw new Error('No signatures found matching the expected signature for payload')
      })

      const res = await POST(makeRequest('t=1,v1=forged'))
      await flushAfter()

      expect(res.status).toBe(400)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('verifies the raw body text with the webhook secret', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockConstructEvent.mockReturnValue(expiredEvent())

      await POST(makeRequest())
      await flushAfter()

      expect(mockConstructEvent).toHaveBeenCalledWith('{}', 'test-sig', 'whsec_test')
    })
  })

  describe('a session it cannot attribute', () => {
    it.each([
      ['no metadata', { metadata: {} }],
      ['metadata of null', { metadata: null }],
      ['a user id that is not a uuid', { metadata: { user_id: 'not-a-uuid', tier: 'pro', interval: 'monthly' } }],
    ])('%s: 200, nothing sent', async (_label, session) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockConstructEvent.mockReturnValue(expiredEvent(session))

      const res = await POST(makeRequest())
      await flushAfter()

      expect(res.status).toBe(200)
      expect(fetchMock).not.toHaveBeenCalled()
      // One line, the session id only: never the metadata.
      expect(warn.mock.calls).toEqual([
        [`Stripe webhook: checkout.session.expired was not created by this app; not reported (session ${SESSION_ID})`],
      ])
      warn.mockRestore()
    })

    it('a one-time (credit pack) session: 200, nothing sent', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockConstructEvent.mockReturnValue(
        expiredEvent({ mode: 'payment', metadata: { user_id: USER_ID, type: 'ai_credit_pack' } })
      )

      const res = await POST(makeRequest())
      await flushAfter()

      expect(res.status).toBe(200)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('tier and interval values that are not known ones are left out, not forwarded', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockConstructEvent.mockReturnValue(
        expiredEvent({ metadata: { user_id: USER_ID, tier: 'enterprise<script>', interval: 'weekly' } })
      )

      const res = await POST(makeRequest())
      await flushAfter()

      expect(res.status).toBe(200)
      expect(gaBodies()[0].events[0].params).toEqual({
        checkout_session_id: hmac(SESSION_ID),
        environment: expect.any(String),
      })
    })

    it('a session created before tier/interval were stamped still counts, without them', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockConstructEvent.mockReturnValue(expiredEvent({ metadata: { user_id: USER_ID } }))

      await POST(makeRequest())
      await flushAfter()

      expect(gaBodies()[0].events[0]).toEqual({
        name: ANALYTICS_EVENTS.checkoutAbandoned,
        params: { checkout_session_id: hmac(SESSION_ID), environment: expect.any(String) },
      })
    })
  })

  describe('client id and session id', () => {
    it('every event gets a fresh random client id, never one derived from the account', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockConstructEvent.mockReturnValue(expiredEvent())

      await POST(makeRequest())
      await POST(makeRequest())
      await flushAfter()

      const [a, b] = gaBodies()
      expect(a.client_id).toMatch(UUID_V4)
      expect(b.client_id).toMatch(UUID_V4)
      expect(a.client_id).not.toBe(b.client_id)
      expectNoIdentifiers()
    })

    it('ignores any ga_client_id on the session: server events are never joined to a browser', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockConstructEvent.mockReturnValue(
        expiredEvent({ metadata: { user_id: USER_ID, ga_client_id: '1234567890.1700000000' } })
      )

      await POST(makeRequest())
      await flushAfter()

      expect(gaBodies()[0].client_id).toMatch(UUID_V4)
    })

    it('the session id is keyed with STRIPE_WEBHOOK_SECRET, not GA_API_SECRET (which Google receives)', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockConstructEvent.mockReturnValue(expiredEvent())

      await POST(makeRequest())
      await flushAfter()

      const id = gaBodies()[0].events[0].params.checkout_session_id
      expect(id).toBe(hmac(SESSION_ID))
      expect(id).not.toBe(createHmac('sha256', GA_SECRET).update(SESSION_ID).digest('hex'))
      // Keyed with the derived subkey, never the raw webhook secret.
      expect(id).not.toBe(createHmac('sha256', WEBHOOK_SECRET).update(SESSION_ID).digest('hex'))
      // The key itself never reaches Google: not in the URL, not in the body.
      expect(fetchMock.mock.calls[0][0]).not.toContain(WEBHOOK_SECRET)
      expect(fetchMock.mock.calls[0][1].body).not.toContain(WEBHOOK_SECRET)
    })

    it('rotating STRIPE_WEBHOOK_SECRET changes the id from then on', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockConstructEvent.mockReturnValue(expiredEvent())

      await POST(makeRequest())
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_rotated')
      await flushAfter()

      const id = gaBodies()[0].events[0].params.checkout_session_id
      expect(id).toMatch(/^[0-9a-f]{64}$/)
      expect(id).not.toBe(hmac(SESSION_ID))
    })

    it('without STRIPE_WEBHOOK_SECRET there is no session id, so nothing is sent', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockConstructEvent.mockReturnValue(expiredEvent())

      const res = await POST(makeRequest())
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', '')
      await flushAfter()

      expect(res.status).toBe(200)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  it('sends nothing when GA is not configured, and still answers 200', async () => {
    vi.stubEnv('GA_API_SECRET', '')
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    mockConstructEvent.mockReturnValue(expiredEvent())

    const res = await POST(makeRequest())
    await flushAfter()

    expect(res.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('checkout.session.completed → purchase', () => {
  function completedEvent(session: Record<string, unknown> = {}) {
    return {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_paid_1',
          mode: 'subscription',
          subscription: 'sub_test123',
          customer: 'cus_test123',
          metadata: { user_id: USER_ID },
          ...session,
        },
      },
    }
  }

  beforeEach(() => {
    mockSubscriptionsRetrieve.mockResolvedValue({
      id: 'sub_test123',
      customer: 'cus_test123',
      status: 'active',
      cancel_at_period_end: false,
      metadata: { user_id: USER_ID },
      items: {
        data: [{ price: { id: 'price_pro_ai_yearly', unit_amount: 8599 }, current_period_end: 1800000000 }],
      },
    })
  })

  it('keeps checkout_completed unchanged and adds purchase with transaction_id, value, currency and items', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    mockConstructEvent.mockReturnValue(completedEvent({ amount_total: 8599, currency: 'usd' }))

    const res = await POST(makeRequest())
    await flushAfter()

    expect(res.status).toBe(200)
    const bodies = gaBodies()
    expect(bodies.map((b) => b.events[0].name)).toEqual([
      ANALYTICS_EVENTS.checkoutCompleted,
      ANALYTICS_EVENTS.purchase,
    ])
    expect(bodies[0].events[0].params).toEqual({ tier: 'pro_ai', value: 85.99, currency: 'usd', billing: 'yearly' })
    expect(bodies[0].client_id).toMatch(UUID_V4)
    expect(bodies[1]).toEqual({
      client_id: expect.stringMatching(UUID_V4),
      events: [
        {
          name: 'purchase',
          params: {
            transaction_id: hmac('cs_test_paid_1'),
            value: 85.99,
            currency: 'USD',
            tier: 'pro_ai',
            billing_interval: 'yearly',
            environment: expect.any(String),
            items: [{ item_id: 'pro_ai', item_name: 'Pro AI', item_variant: 'yearly', price: 85.99, quantity: 1 }],
          },
        },
      ],
    })
    expectNoIdentifiers()
  })

  it('the two completion events get separate random client ids', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    mockConstructEvent.mockReturnValue(completedEvent())

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
    await flushAfter()
    const [a, b] = gaBodies().map((body) => body.client_id)
    expect(a).toMatch(UUID_V4)
    expect(b).toMatch(UUID_V4)
    expect(a).not.toBe(b)
    expectNoIdentifiers()
  })

  it('purchase value is what was paid after a promotion code', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    mockConstructEvent.mockReturnValue(completedEvent({ amount_total: 4299, currency: 'usd' }))

    await POST(makeRequest())
    await flushAfter()

    expect(gaBodies()[1].events[0].params.value).toBe(42.99)
  })

  it('a buyer paying in a local currency: the USD amount from currency_conversion', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    mockConstructEvent.mockReturnValue(
      completedEvent({
        amount_total: 12000,
        currency: 'cad',
        currency_conversion: { amount_total: 8599, source_currency: 'usd', fx_rate: '1.39' },
      })
    )

    await POST(makeRequest())
    await flushAfter()

    expect(gaBodies()[1].events[0].params).toEqual(expect.objectContaining({ value: 85.99, currency: 'USD' }))
  })

  it('no USD total in the payload: falls back to the list price', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    mockConstructEvent.mockReturnValue(completedEvent({ amount_total: 12000, currency: 'cad' }))

    await POST(makeRequest())
    await flushAfter()

    expect(gaBodies()[1].events[0].params.value).toBe(85.99)
  })

  it('a redelivery sends the same transaction_id, which GA4 deduplicates', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    mockConstructEvent.mockReturnValue(completedEvent({ amount_total: 8599, currency: 'usd' }))

    await POST(makeRequest())
    await flushAfter()
    await POST(makeRequest())
    await flushAfter()

    const purchases = gaBodies().filter((b) => b.events[0].name === 'purchase')
    expect(purchases.map((b) => b.events[0].params.transaction_id)).toEqual([hmac('cs_test_paid_1'), hmac('cs_test_paid_1')])
  })
})
