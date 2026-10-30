/**
 * Credit packs granted only once paid, and disputes and refunds (lib/creditPacks.ts,
 * lib/paymentReversals.ts) through the Stripe webhook:
 *
 * - a credit pack is granted on `checkout.session.completed` only when the session is `paid`, and
 *   on `checkout.session.async_payment_succeeded` for a delayed payment method;
 * - a pack whose charge is disputed (open or lost) or fully refunded is revoked
 *   (`ai_credit_purchases.revoked_at`), and restored when the dispute is won. The handler reads
 *   the charge and its disputes from Stripe, so redelivery and any order of events end the same;
 * - a subscription whose payment becomes a chargeback is cancelled at Stripe and written as ended.
 *
 * `ai_credit_purchases` is a small in-memory table here, so idempotency and ordering are checked
 * on the rows themselves. What `ai_reserve_credits` does with `revoked_at` is covered by the
 * pgTAP test supabase/tests/027_ai_credit_revocation_and_past_due_allowance.test.sql.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { creditsForPayment } from '@tabmerger/shared'

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: () => {},
}))

const mockConstructEvent = vi.fn()
const mockChargesRetrieve = vi.fn()
const mockDisputesList = vi.fn()
const mockSessionsList = vi.fn()
const mockInvoicePaymentsList = vi.fn()
const mockSubscriptionsRetrieve = vi.fn()
const mockSubscriptionsCancel = vi.fn()

vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: { constructEvent: mockConstructEvent },
    charges: { retrieve: mockChargesRetrieve },
    disputes: { list: mockDisputesList },
    checkout: { sessions: { list: mockSessionsList, listLineItems: vi.fn() } },
    invoicePayments: { list: mockInvoicePaymentsList },
    subscriptions: { retrieve: mockSubscriptionsRetrieve, cancel: mockSubscriptionsCancel },
    coupons: { retrieve: vi.fn() },
  },
}))

const USER = '11111111-1111-4111-8111-111111111111'

type PackRow = { user_id: string; month: string; credits: number; stripe_checkout_session_id: string; revoked_at: string | null }
let packs: PackRow[] = []
let packInsertError: { code: string; message: string } | null = null
let packUpdateError: { code: string; message: string } | null = null
/** Simulates the grant inserting the row (unrevoked) between a revoke's update and its insert. */
let grantRacesRevokeInsert = false
const subscriptionUpdates: Array<{ values: Record<string, unknown>; id: string }> = []

/** A tiny PostgREST stand-in: ai_credit_purchases insert/update and subscriptions update by id. */
function from(table: string) {
  if (table === 'ai_credit_purchases') {
    return {
      insert: vi.fn(async (row: Omit<PackRow, 'revoked_at'> & { revoked_at?: string }) => {
        if (packInsertError) return { error: packInsertError }
        if (grantRacesRevokeInsert && row.revoked_at) {
          grantRacesRevokeInsert = false
          packs.push({ ...row, revoked_at: null })
          return { error: { code: '23505', message: 'duplicate key value' } }
        }
        if (packs.some((p) => p.stripe_checkout_session_id === row.stripe_checkout_session_id)) {
          return { error: { code: '23505', message: 'duplicate key value' } }
        }
        packs.push({ revoked_at: null, ...row })
        return { error: null }
      }),
      update: (values: { revoked_at: string | null }) => {
        const filters: Array<(p: PackRow) => boolean> = []
        const chain = {
          eq: (column: keyof PackRow, value: unknown) => {
            filters.push((p) => p[column] === value)
            return chain
          },
          is: (column: keyof PackRow, value: null) => {
            filters.push((p) => p[column] === value)
            return chain
          },
          not: (column: keyof PackRow, _op: 'is', value: null) => {
            filters.push((p) => p[column] !== value)
            return chain
          },
          select: async () => {
            if (packUpdateError) return { data: null, error: packUpdateError }
            const hit = packs.filter((p) => filters.every((f) => f(p)))
            for (const p of hit) p.revoked_at = values.revoked_at
            return { data: hit.map((p) => ({ id: p.stripe_checkout_session_id })), error: null }
          },
        }
        return chain
      },
    }
  }
  if (table === 'subscriptions') {
    return {
      update: (values: Record<string, unknown>) => ({
        eq: (_column: string, id: string) => ({
          select: async () => {
            subscriptionUpdates.push({ values, id })
            return { data: [{ id }], error: null }
          },
        }),
      }),
    }
  }
  throw new Error(`unexpected table ${table}`)
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn(async () => ({ from })),
}))

function request() {
  return new NextRequest('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': 'sig' },
    body: '{}',
  })
}

async function post(event: { type: string; data: { object: Record<string, unknown> } }) {
  mockConstructEvent.mockReturnValue(event)
  const { POST } = await import('@/app/api/webhooks/stripe/route')
  return POST(request())
}

/** A $25 credit-pack Checkout Session. */
function packSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cs_pack',
    object: 'checkout.session',
    mode: 'payment',
    customer: 'cus_1',
    metadata: { user_id: USER, type: 'ai_credit_pack' },
    payment_status: 'paid',
    amount_total: 2500,
    currency: 'usd',
    payment_intent: 'pi_pack',
    created: 1_800_000_000,
    ...overrides,
  }
}

const PACK_CREDITS = creditsForPayment(25)

/** Stripe's current state of the charge `ch_1` and its disputes. */
function stripeCharge({
  paymentIntent = 'pi_pack',
  refunded = false,
  disputes = [] as string[],
}: { paymentIntent?: string | null; refunded?: boolean; disputes?: string[] } = {}) {
  mockChargesRetrieve.mockResolvedValue({ id: 'ch_1', object: 'charge', payment_intent: paymentIntent, refunded, amount_refunded: refunded ? 2500 : 0 })
  mockDisputesList.mockResolvedValue({ data: disputes.map((status, i) => ({ id: `dp_${i}`, object: 'dispute', charge: 'ch_1', status })) })
}

const disputeEvent = (type: string, status = 'needs_response') => ({
  type,
  data: { object: { id: 'dp_0', object: 'dispute', charge: 'ch_1', status } },
})
const refundEvent = () => ({ type: 'charge.refunded', data: { object: { id: 'ch_1', object: 'charge', refunded: true } } })

let warnSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [mockChargesRetrieve, mockDisputesList, mockSessionsList, mockInvoicePaymentsList, mockSubscriptionsRetrieve, mockSubscriptionsCancel]) {
    m.mockReset()
  }
  packs = []
  packInsertError = null
  packUpdateError = null
  grantRacesRevokeInsert = false
  subscriptionUpdates.length = 0
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
  vi.stubEnv('STRIPE_PRO_AI_MONTHLY_PRICE_ID', 'price_ai_m')
  mockSessionsList.mockResolvedValue({ data: [packSession()] })
  mockInvoicePaymentsList.mockResolvedValue({ data: [] })
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  warnSpy.mockRestore()
  errorSpy.mockRestore()
})

describe('a credit pack is granted only once paid', () => {
  it('a paid session grants the pack', async () => {
    const res = await post({ type: 'checkout.session.completed', data: { object: packSession() } })
    expect(res.status).toBe(200)
    expect(packs).toEqual([expect.objectContaining({ user_id: USER, credits: PACK_CREDITS, stripe_checkout_session_id: 'cs_pack', revoked_at: null })])
  })

  it.each(['unpaid', 'no_payment_required'])('a completed session whose payment_status is %s grants nothing', async (status) => {
    const res = await post({ type: 'checkout.session.completed', data: { object: packSession({ payment_status: status }) } })
    expect(res.status).toBe(200)
    expect(packs).toEqual([])
    expect(warnSpy.mock.calls).toEqual([
      [`Stripe webhook: checkout.session.completed credit pack not paid (${status}); nothing granted (session cs_pack)`],
    ])
  })

  it('a delayed payment: nothing at completion, the pack once async_payment_succeeded arrives, once', async () => {
    await post({ type: 'checkout.session.completed', data: { object: packSession({ payment_status: 'unpaid' }) } })
    expect(packs).toEqual([])

    const paid = { type: 'checkout.session.async_payment_succeeded', data: { object: packSession() } }
    expect((await post(paid)).status).toBe(200)
    expect((await post(paid)).status).toBe(200)
    expect(packs).toHaveLength(1)
    expect(packs[0]).toMatchObject({ credits: PACK_CREDITS, revoked_at: null })
  })

  it('async_payment_succeeded for a subscription checkout writes nothing (its own update event does)', async () => {
    const res = await post({
      type: 'checkout.session.async_payment_succeeded',
      data: { object: { id: 'cs_sub', mode: 'subscription', subscription: 'sub_1', payment_status: 'paid', metadata: { user_id: USER } } },
    })
    expect(res.status).toBe(200)
    expect(packs).toEqual([])
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
  })
})

describe('a credit pack whose payment is disputed or refunded', () => {
  beforeEach(() => {
    packs = [{ user_id: USER, month: '2027-01', credits: PACK_CREDITS, stripe_checkout_session_id: 'cs_pack', revoked_at: null }]
  })

  it.each([
    ['a chargeback opened', 'charge.dispute.created', ['needs_response']],
    ['an inquiry opened', 'charge.dispute.created', ['warning_needs_response']],
    ['evidence under review', 'charge.dispute.updated', ['under_review']],
    ['a dispute lost', 'charge.dispute.closed', ['lost']],
  ])('%s: revoked, and a redelivery changes nothing more', async (_label, type, disputes) => {
    stripeCharge({ disputes })
    expect((await post(disputeEvent(type, disputes[0]))).status).toBe(200)
    const revokedAt = packs[0].revoked_at
    expect(revokedAt).not.toBeNull()
    expect(packs[0].credits).toBe(PACK_CREDITS)

    expect((await post(disputeEvent(type, disputes[0]))).status).toBe(200)
    expect(packs).toHaveLength(1)
    expect(packs[0].revoked_at).toBe(revokedAt)
    expect(mockSessionsList).toHaveBeenCalledWith({ payment_intent: 'pi_pack', limit: 1 })
    expect(mockSubscriptionsCancel).not.toHaveBeenCalled()
  })

  it.each([
    ['charge.dispute.funds_withdrawn', ['needs_response'], true],
    ['charge.dispute.funds_reinstated', ['won'], false],
  ])('%s is handled like the other dispute events', async (type, disputes, revoked) => {
    if (!revoked) packs[0].revoked_at = '2027-01-02T00:00:00.000Z'
    stripeCharge({ disputes })
    expect((await post(disputeEvent(type, disputes[0]))).status).toBe(200)
    expect(packs[0].revoked_at === null).toBe(!revoked)
  })

  it('the grant inserting the row between the revoke update and its insert: the row is still revoked', async () => {
    packs = []
    grantRacesRevokeInsert = true
    stripeCharge({ disputes: ['needs_response'] })
    expect((await post(disputeEvent('charge.dispute.created'))).status).toBe(200)
    expect(packs).toHaveLength(1)
    expect(packs[0].revoked_at).not.toBeNull()
  })

  it('two events racing: the state changed after the write, so it is written again and ends on the answer Stripe has now', async () => {
    // First read (and the decision): a chargeback. By the time the write is done the dispute is
    // won (the other event's handler already wrote "restored" before this one's "revoked").
    mockChargesRetrieve.mockResolvedValue({ id: 'ch_1', payment_intent: 'pi_pack', refunded: false })
    mockDisputesList
      .mockResolvedValueOnce({ data: [{ id: 'dp_0', status: 'needs_response' }] })
      .mockResolvedValue({ data: [{ id: 'dp_0', status: 'won' }] })

    expect((await post(disputeEvent('charge.dispute.created'))).status).toBe(200)
    expect(packs[0].revoked_at).toBeNull()
    // Read, write (revoke), re-read (won), write (restore), re-read (won): settled.
    expect(mockChargesRetrieve).toHaveBeenCalledTimes(3)
    expect(warnSpy.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      'Stripe webhook: charge.dispute.created credit pack revoked (charge ch_1, session cs_pack)',
      'Stripe webhook: charge.dispute.created credit pack restored (charge ch_1, session cs_pack)',
    ])
  })

  it('a state that keeps changing answers 500 after three writes, so Stripe sends the event again', async () => {
    mockChargesRetrieve.mockResolvedValue({ id: 'ch_1', payment_intent: 'pi_pack', refunded: false })
    let call = 0
    mockDisputesList.mockImplementation(async () => ({
      data: [{ id: 'dp_0', status: call++ % 2 === 0 ? 'needs_response' : 'won' }],
    }))

    expect((await post(disputeEvent('charge.dispute.created'))).status).toBe(500)
    expect(errorSpy.mock.calls).toEqual([
      ['Stripe webhook: charge.dispute.created credit pack state kept changing; not settled after 3 writes (charge ch_1, session cs_pack)'],
    ])
  })

  it('a full refund revokes it', async () => {
    stripeCharge({ refunded: true })
    expect((await post(refundEvent())).status).toBe(200)
    expect(packs[0].revoked_at).not.toBeNull()
  })

  it('a partial refund leaves it (refunds are only issued by hand; the owner decides)', async () => {
    mockChargesRetrieve.mockResolvedValue({ id: 'ch_1', payment_intent: 'pi_pack', refunded: false, amount_refunded: 500 })
    mockDisputesList.mockResolvedValue({ data: [] })
    expect((await post(refundEvent())).status).toBe(200)
    expect(packs[0].revoked_at).toBeNull()
  })

  it('a dispute won restores it; a refund afterwards revokes it again', async () => {
    stripeCharge({ disputes: ['needs_response'] })
    await post(disputeEvent('charge.dispute.created'))
    expect(packs[0].revoked_at).not.toBeNull()

    stripeCharge({ disputes: ['won'] })
    await post(disputeEvent('charge.dispute.closed', 'won'))
    expect(packs[0].revoked_at).toBeNull()

    stripeCharge({ disputes: ['won'], refunded: true })
    await post(refundEvent())
    expect(packs[0].revoked_at).not.toBeNull()
  })

  it.each([['warning_closed'], ['prevented']])('a dispute that ends %s restores it', async (status) => {
    packs[0].revoked_at = '2027-01-02T00:00:00.000Z'
    stripeCharge({ disputes: [status] })
    await post(disputeEvent('charge.dispute.closed', status))
    expect(packs[0].revoked_at).toBeNull()
  })

  it('out of order: a late `created` after the dispute was won reads the current state and leaves the pack on', async () => {
    stripeCharge({ disputes: ['won'] })
    await post(disputeEvent('charge.dispute.closed', 'won'))
    await post(disputeEvent('charge.dispute.created', 'needs_response'))
    expect(packs[0].revoked_at).toBeNull()
  })

  it('out of order: a late `closed` (won) after the dispute was lost later still keeps it revoked', async () => {
    // Stripe now says lost (e.g. a second dispute on the charge): the won event is stale.
    stripeCharge({ disputes: ['won', 'lost'] })
    await post(disputeEvent('charge.dispute.closed', 'won'))
    expect(packs[0].revoked_at).not.toBeNull()
  })

  it('a dispute handled before the pack was granted inserts the row revoked; the grant then leaves it revoked', async () => {
    packs = []
    stripeCharge({ disputes: ['needs_response'] })
    await post(disputeEvent('charge.dispute.created'))
    expect(packs).toEqual([
      expect.objectContaining({ user_id: USER, credits: PACK_CREDITS, stripe_checkout_session_id: 'cs_pack', month: '2027-01' }),
    ])
    expect(packs[0].revoked_at).not.toBeNull()

    expect((await post({ type: 'checkout.session.completed', data: { object: packSession() } })).status).toBe(200)
    expect(packs).toHaveLength(1)
    expect(packs[0].revoked_at).not.toBeNull()
  })

  it('a won dispute with no row yet writes nothing (the grant inserts it)', async () => {
    packs = []
    stripeCharge({ disputes: ['won'] })
    await post(disputeEvent('charge.dispute.closed', 'won'))
    expect(packs).toEqual([])
  })

  it('a failed revoke write answers 500 so Stripe sends the event again', async () => {
    packUpdateError = { code: '08006', message: 'connection failure' }
    stripeCharge({ disputes: ['needs_response'] })
    expect((await post(disputeEvent('charge.dispute.created'))).status).toBe(500)
    expect(errorSpy.mock.calls).toEqual([
      ['Stripe webhook: charge.dispute.created credit pack revoke failed (session cs_pack, code 08006): connection failure'],
    ])
  })

  it.each([
    ['the charge', () => mockChargesRetrieve.mockRejectedValue({ type: 'StripeAPIError', statusCode: 503 }), 'charge retrieve'],
    ['the disputes', () => mockDisputesList.mockRejectedValue({ type: 'StripeAPIError', statusCode: 503 }), 'dispute list'],
    ['the session', () => mockSessionsList.mockRejectedValue({ type: 'StripeAPIError', statusCode: 503 }), 'checkout session list'],
  ])('a failed Stripe read of %s answers 500 and writes nothing', async (_label, fail, step) => {
    stripeCharge({ disputes: ['needs_response'] })
    fail()
    expect((await post(disputeEvent('charge.dispute.created'))).status).toBe(500)
    expect(packs[0].revoked_at).toBeNull()
    expect(errorSpy.mock.calls).toEqual([
      [`Stripe webhook: charge.dispute.created ${step} failed (charge ch_1, StripeAPIError, status 503)`],
    ])
  })

  it('a charge Stripe does not have is 200 and logged', async () => {
    mockChargesRetrieve.mockRejectedValue({ code: 'resource_missing', statusCode: 404 })
    expect((await post(disputeEvent('charge.dispute.created'))).status).toBe(200)
    expect(warnSpy.mock.calls).toEqual([['Stripe webhook: charge.dispute.created matched no charge (charge ch_1)']])
  })
})

describe('a subscription whose payment is disputed', () => {
  function subscriptionCharge(disputes: string[], subscriptionStatus = 'active') {
    stripeCharge({ paymentIntent: 'pi_sub', disputes })
    mockSessionsList.mockResolvedValue({ data: [] })
    mockInvoicePaymentsList.mockResolvedValue({
      data: [{ id: 'inpay_1', invoice: { id: 'in_1', parent: { subscription_details: { subscription: 'sub_1' } } } }],
    })
    mockSubscriptionsRetrieve.mockResolvedValue({ id: 'sub_1', status: subscriptionStatus, items: { data: [] } })
    mockSubscriptionsCancel.mockResolvedValue({ id: 'sub_1', status: 'canceled' })
  }

  it.each([['needs_response'], ['under_review'], ['lost']])(
    'a chargeback (%s): cancelled at Stripe at once, with no proration or refund options, and the row ended',
    async (status) => {
      subscriptionCharge([status])
      expect((await post(disputeEvent('charge.dispute.created', status))).status).toBe(200)

      expect(mockInvoicePaymentsList).toHaveBeenCalledWith({
        payment: { type: 'payment_intent', payment_intent: 'pi_sub' },
        expand: ['data.invoice'],
        limit: 10,
      })
      expect(mockSubscriptionsCancel).toHaveBeenCalledTimes(1)
      const [id, params] = mockSubscriptionsCancel.mock.calls[0]
      expect(id).toBe('sub_1')
      expect(Object.keys(params)).toEqual(['cancellation_details'])
      expect(subscriptionUpdates).toEqual([{ id: 'sub_1', values: { status: 'canceled', tier: 'free', ai_monthly_credits: 0 } }])
      expect(packs).toEqual([])
    }
  )

  it('a subscription with a schedule attached (a pending downgrade) is cancelled directly', async () => {
    // Measured in test mode (2026-10-28): cancel succeeds and Stripe cancels the schedule; no
    // release first. The Stripe mock has no subscriptionSchedules, so any schedule call would 500.
    subscriptionCharge(['needs_response'])
    mockSubscriptionsRetrieve.mockResolvedValue({ id: 'sub_1', status: 'active', schedule: 'sub_sched_1', items: { data: [] } })
    expect((await post(disputeEvent('charge.dispute.created'))).status).toBe(200)
    expect(mockSubscriptionsCancel).toHaveBeenCalledTimes(1)
    expect(subscriptionUpdates).toEqual([{ id: 'sub_1', values: { status: 'canceled', tier: 'free', ai_monthly_credits: 0 } }])
  })

  it('a redelivery after the cancel only writes the ended row again (no second cancel)', async () => {
    subscriptionCharge(['needs_response'], 'canceled')
    expect((await post(disputeEvent('charge.dispute.created'))).status).toBe(200)
    expect(mockSubscriptionsCancel).not.toHaveBeenCalled()
    expect(subscriptionUpdates).toEqual([{ id: 'sub_1', values: { status: 'canceled', tier: 'free', ai_monthly_credits: 0 } }])
  })

  it.each([['warning_needs_response'], ['warning_under_review'], ['warning_closed'], ['won'], ['prevented']])(
    'no chargeback (%s): the subscription is left alone',
    async (status) => {
      subscriptionCharge([status])
      expect((await post(disputeEvent('charge.dispute.updated', status))).status).toBe(200)
      expect(mockSubscriptionsCancel).not.toHaveBeenCalled()
      expect(subscriptionUpdates).toEqual([])
    }
  )

  it('an inquiry that escalates (charge.dispute.updated → needs_response) cancels', async () => {
    subscriptionCharge(['warning_needs_response'])
    await post(disputeEvent('charge.dispute.created', 'warning_needs_response'))
    expect(mockSubscriptionsCancel).not.toHaveBeenCalled()

    subscriptionCharge(['needs_response'])
    await post(disputeEvent('charge.dispute.updated', 'needs_response'))
    expect(mockSubscriptionsCancel).toHaveBeenCalledTimes(1)
  })

  it('a refund of a subscription invoice changes nothing', async () => {
    subscriptionCharge([])
    mockChargesRetrieve.mockResolvedValue({ id: 'ch_1', payment_intent: 'pi_sub', refunded: true, amount_refunded: 799 })
    expect((await post(refundEvent())).status).toBe(200)
    expect(mockSubscriptionsCancel).not.toHaveBeenCalled()
    expect(subscriptionUpdates).toEqual([])
  })

  it('a failed cancel answers 500 and writes nothing, so the event is sent again', async () => {
    subscriptionCharge(['needs_response'])
    mockSubscriptionsCancel.mockRejectedValue({ type: 'StripeAPIError', statusCode: 500 })
    expect((await post(disputeEvent('charge.dispute.created'))).status).toBe(500)
    expect(subscriptionUpdates).toEqual([])
    expect(errorSpy.mock.calls).toEqual([
      ['Stripe webhook: charge.dispute.created disputed subscription cancel failed (subscription sub_1, StripeAPIError, status 500)'],
    ])
  })

  it('a charge that paid for neither a pack nor a subscription is 200 and logged', async () => {
    stripeCharge({ paymentIntent: 'pi_other', disputes: ['needs_response'] })
    mockSessionsList.mockResolvedValue({ data: [] })
    expect((await post(disputeEvent('charge.dispute.created'))).status).toBe(200)
    expect(mockSubscriptionsCancel).not.toHaveBeenCalled()
    expect(warnSpy.mock.calls).toEqual([
      ['Stripe webhook: charge.dispute.created charge paid for no credit pack or subscription; nothing to do (charge ch_1)'],
    ])
  })
})
