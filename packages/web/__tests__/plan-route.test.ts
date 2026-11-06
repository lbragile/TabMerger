/**
 * GET /api/plan: the signed-in visitor's plan for the plan listings, which are rendered without
 * reading the session and ask for it from the browser. Read from the session cookie
 * (`getCurrentPlan`), never stored by a shared cache.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const getCurrentPlan = vi.hoisted(() => vi.fn())
vi.mock('@/lib/currentPlan', () => ({ getCurrentPlan }))

import { GET } from '@/app/api/plan/route'

const req = (query = '') => new NextRequest(`http://localhost/api/plan${query}`)

afterEach(() => getCurrentPlan.mockReset())

describe('GET /api/plan', () => {
  it('answers the plan without the scheduled change by default', async () => {
    const plan = { signedIn: true, tier: 'pro', interval: 'yearly', periodEnd: '2026-12-01T00:00:00.000Z' }
    getCurrentPlan.mockResolvedValue(plan)
    const res = await GET(req())
    expect(getCurrentPlan).toHaveBeenCalledWith({ withPendingChange: false })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(plan)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })

  it('also reads a scheduled change with pendingChange=1 (the pricing page)', async () => {
    getCurrentPlan.mockResolvedValue({ signedIn: false, tier: 'free', periodEnd: null })
    await GET(req('?pendingChange=1'))
    expect(getCurrentPlan).toHaveBeenCalledWith({ withPendingChange: true })
  })

  it.each(['?pendingChange=true', '?pendingChange=0', '?pendingChange='])('treats %s as no scheduled change', async (query) => {
    getCurrentPlan.mockResolvedValue({ signedIn: false, tier: 'free', periodEnd: null })
    await GET(req(query))
    expect(getCurrentPlan).toHaveBeenCalledWith({ withPendingChange: false })
  })

  it('answers the guest plan for a guest (what getCurrentPlan returns without a user)', async () => {
    getCurrentPlan.mockResolvedValue({ signedIn: false, tier: 'free', periodEnd: null })
    expect(await (await GET(req())).json()).toEqual({ signedIn: false, tier: 'free', periodEnd: null })
  })

  it('answers 500 with no body, still uncacheable, when the plan cannot be read', async () => {
    getCurrentPlan.mockRejectedValue(new Error('database down'))
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })
})
