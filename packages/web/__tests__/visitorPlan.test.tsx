/**
 * The plan listings read the visitor's plan in the browser (`useVisitorPlan`): no request without
 * a session, `GET /api/plan` with one, the guest listing on any failure. While it is read the
 * pricing page's paid cards show a busy skeleton the size of a guest's button (no layout shift).
 */
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/pricing',
}))
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn() } }))

const auth = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth }) }))

import { GUEST_VISITOR_PLAN, parseVisitorPlan, useVisitorPlan } from '@/components/pricing/useVisitorPlan'
import { PricingTable } from '@/components/pricing/PricingTable'
import { PricingTableForVisitor } from '@/components/pricing/PricingTableForVisitor'
import { GUEST_PLAN } from '@/lib/currentPlan'

const INSTALL = 'https://store.example/tabmerger'
const fetchMock = vi.fn()
const signedIn = () => auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })
const signedOut = () => auth.getSession.mockResolvedValue({ data: { session: null } })
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

function cards() {
  const all = Array.from(document.querySelectorAll<HTMLElement>('[data-tier]'))
  const byTier = (tier: string) => all.find((el) => el.dataset.tier === tier)!
  return { free: byTier('free'), pro: byTier('pro'), proAi: byTier('proAi') }
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  auth.getSession.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('parseVisitorPlan', () => {
  it('matches the server guest plan', () => {
    expect(GUEST_VISITOR_PLAN).toEqual(GUEST_PLAN)
  })

  it('keeps the known fields of a subscriber plan', () => {
    expect(
      parseVisitorPlan({
        signedIn: true,
        tier: 'pro_ai',
        interval: 'yearly',
        aiMode: 'byok',
        periodEnd: '2026-12-01T00:00:00.000Z',
        setToEnd: true,
        pendingChange: { plan: { tierKey: 'pro', interval: 'monthly', aiMode: null }, effectiveAt: '2026-12-01T00:00:00.000Z' },
        extra: '<script>',
      })
    ).toEqual({
      signedIn: true,
      tier: 'pro_ai',
      interval: 'yearly',
      aiMode: 'byok',
      periodEnd: '2026-12-01T00:00:00.000Z',
      setToEnd: true,
      pendingChange: { plan: { tierKey: 'pro', interval: 'monthly', aiMode: null }, effectiveAt: '2026-12-01T00:00:00.000Z' },
    })
  })

  it.each([
    ['null', null],
    ['an array', []],
    ['a guest', { signedIn: false, tier: 'pro' }],
    ['an unknown tier', { signedIn: true, tier: 'enterprise' }],
    ['a non-string tier', { signedIn: true, tier: 1 }],
  ])('is the guest plan for %s', (_label, body) => {
    expect(parseVisitorPlan(body)).toEqual(GUEST_PLAN)
  })

  it('drops malformed optional fields', () => {
    expect(
      parseVisitorPlan({ signedIn: true, tier: 'pro', interval: 'weekly', aiMode: 'other', periodEnd: 5, setToEnd: 'yes' })
    ).toEqual({ signedIn: true, tier: 'pro', periodEnd: null })
  })

  it.each([
    ['a missing date', { plan: null }],
    ['an unparseable date', { plan: null, effectiveAt: 'soon' }],
    ['an unknown tier', { plan: { tierKey: 'gold', interval: 'monthly' }, effectiveAt: '2026-12-01T00:00:00.000Z' }],
    ['an unknown interval', { plan: { tierKey: 'pro', interval: 'daily' }, effectiveAt: '2026-12-01T00:00:00.000Z' }],
    ['a non-object', 'next month'],
  ])('reads no scheduled change from %s', (_label, pendingChange) => {
    expect(parseVisitorPlan({ signedIn: true, tier: 'pro', periodEnd: null, pendingChange }).pendingChange).toBeNull()
  })

  it('keeps a scheduled change to a price this deployment does not sell (plan null)', () => {
    expect(
      parseVisitorPlan({ signedIn: true, tier: 'pro', periodEnd: null, pendingChange: { plan: null, effectiveAt: '2026-12-01T00:00:00.000Z' } })
        .pendingChange
    ).toEqual({ plan: null, effectiveAt: '2026-12-01T00:00:00.000Z' })
  })
})

describe('useVisitorPlan', () => {
  it('is undefined at first, then the guest plan without any request when there is no session', async () => {
    signedOut()
    const { result } = renderHook(() => useVisitorPlan())
    expect(result.current).toBeUndefined()
    await waitFor(() => expect(result.current).toEqual(GUEST_PLAN))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks /api/plan with a session, and for the scheduled change when told to', async () => {
    signedIn()
    fetchMock.mockResolvedValue(json({ signedIn: true, tier: 'pro', periodEnd: null }))
    const { result } = renderHook(() => useVisitorPlan({ withPendingChange: true }))
    await waitFor(() => expect(result.current).toEqual({ signedIn: true, tier: 'pro', periodEnd: null }))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/plan?pendingChange=1',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store', signal: expect.any(AbortSignal) })
    )
  })

  it('asks /api/plan without the scheduled change by default', async () => {
    signedIn()
    fetchMock.mockResolvedValue(json({ signedIn: true, tier: 'free', periodEnd: null }))
    renderHook(() => useVisitorPlan())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/plan', expect.anything()))
  })

  it.each([
    ['a failed response', () => fetchMock.mockResolvedValue(json(null, 500))],
    ['a network error', () => fetchMock.mockRejectedValue(new Error('offline'))],
    ['an unreadable session', () => auth.getSession.mockRejectedValue(new Error('storage'))],
  ])('is the guest plan after %s', async (_label, arrange) => {
    signedIn()
    arrange()
    const { result } = renderHook(() => useVisitorPlan())
    await waitFor(() => expect(result.current).toEqual(GUEST_PLAN))
  })

  it('ignores an answer that arrives after unmount', async () => {
    let answer!: (value: unknown) => void
    signedIn()
    fetchMock.mockReturnValue(new Promise((r) => (answer = r)))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = renderHook(() => useVisitorPlan())
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    unmount()
    await act(async () => answer(json({ signedIn: true, tier: 'pro', periodEnd: null })))
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })
})

describe('PricingTable while the plan is read', () => {
  it('shows a busy, labelled skeleton the size of a guest button on each paid card, never on Free', () => {
    render(<PricingTable installHref={INSTALL} planLoading />)
    const { free, pro, proAi } = cards()
    expect(within(free).getByRole('button', { name: 'Install free' })).toBeInTheDocument()
    expect(within(free).queryByTestId('cta-loading')).toBeNull()
    for (const card of [pro, proAi]) {
      const loading = within(card).getByTestId('cta-loading')
      expect(loading).toHaveAttribute('aria-busy', 'true')
      expect(within(loading).getByText('Loading your plan')).toHaveClass('sr-only')
      // The hidden guest button keeps the box; nothing in it can be clicked or is announced.
      const box = loading.querySelector('.invisible')!
      expect(box).toHaveAttribute('aria-hidden', 'true')
      expect(box.textContent).toMatch(/^Get /)
      expect(box.className).toContain('min-h-10')
      expect(loading.querySelector('.animate-pulse')).toHaveClass('motion-reduce:animate-none')
      expect(within(card).queryByRole('button', { name: /^(Get|Upgrade to) / })).toBeNull()
    }
    // The badges show as for a guest meanwhile.
    expect(within(pro).getByText('Recommended')).toBeInTheDocument()
  })
})

describe('PricingTableForVisitor', () => {
  it('shows the skeleton, then the guest buttons, without a request when signed out', async () => {
    signedOut()
    render(<PricingTableForVisitor installHref={INSTALL} />)
    expect(within(cards().pro).getByTestId('cta-loading')).toBeInTheDocument()
    expect(await within(cards().pro).findByRole('button', { name: 'Get Pro' })).toBeInTheDocument()
    expect(screen.queryByTestId('cta-loading')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the interval the visitor picked while the plan loaded', async () => {
    let answer!: (value: unknown) => void
    signedIn()
    fetchMock.mockReturnValue(new Promise((r) => (answer = r)))
    render(<PricingTableForVisitor installHref={INSTALL} />)
    await act(async () => screen.getByRole('button', { name: /Yearly/ }).click())
    await act(async () => answer(json({ signedIn: true, tier: 'free', periodEnd: null })))
    expect(await within(cards().pro).findByRole('button', { name: 'Upgrade to Pro' })).toBeInTheDocument()
    expect(within(cards().pro).getByText(/\/year|per year|year/i)).toBeInTheDocument()
  })

  it('formats a scheduled change date in UTC, as the server did', async () => {
    signedIn()
    fetchMock.mockResolvedValue(
      json({
        signedIn: true,
        tier: 'pro_ai',
        interval: 'monthly',
        aiMode: 'managed',
        periodEnd: '2026-11-27T00:30:00.000Z',
        pendingChange: { plan: { tierKey: 'pro', interval: 'monthly', aiMode: null }, effectiveAt: '2026-11-27T00:30:00.000Z' },
      })
    )
    render(<PricingTableForVisitor installHref={INSTALL} />)
    expect(await within(cards().pro).findByTestId('cta-scheduled')).toHaveTextContent('Starts November 27, 2026')
  })

  it('opens the Pro AI card on an own-key subscriber option once the plan arrives', async () => {
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
    vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', 'true')
    signedIn()
    fetchMock.mockResolvedValue(json({ signedIn: true, tier: 'pro_ai', interval: 'monthly', aiMode: 'byok', periodEnd: null }))
    render(<PricingTableForVisitor installHref={INSTALL} />)
    await waitFor(() => expect(screen.queryByTestId('cta-loading')).toBeNull())
    const proAi = cards().proAi
    expect(within(proAi).getByRole('radio', { name: 'You' })).toBeChecked()
  })
})
