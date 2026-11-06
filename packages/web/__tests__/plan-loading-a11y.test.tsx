/**
 * Accessibility and no-layout-shift details of the plan listings and the header's account button,
 * now that both resolve in the browser:
 * - the account menu's lazy chunk keeps the 36px box with a busy skeleton while it loads, and is
 *   preloaded as soon as the header knows (or the cookie suggests) the visitor is signed in;
 * - without scripts the pricing page's paid cards offer the guest's way in (`<noscript>`);
 * - the CTA skeleton is sized by the taller of the two non-subscriber labels;
 * - the plan arriving never remounts a card (focus and the visitor's choices stay);
 * - a stalled lookup gives up after 8 s; one polite status line announces a signed-in plan.
 */
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IntlWrapper } from './helpers/intl'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/pricing',
}))
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn() } }))

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
}))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth }) }))

vi.mock('@/components/layout/AccountMenu', async () => {
  return {
    AccountMenu: ({ initials }: { initials?: string }) => (
      <button type="button" aria-label="Account menu">
        {initials}
      </button>
    ),
  }
})

import { AccountButtonSkeleton, AccountMenuLoader, loadAccountMenu, preloadAccountMenu } from '@/components/layout/AccountMenuLoader'
import { PricingTable } from '@/components/pricing/PricingTable'
import { PricingTableForVisitor } from '@/components/pricing/PricingTableForVisitor'
import { PricingTeaser } from '@/components/marketing/PricingTeaser'
import { PLAN_LOOKUP_TIMEOUT_MS, useVisitorPlan } from '@/components/pricing/useVisitorPlan'

const INSTALL = 'https://store.example/tabmerger'
const fetchMock = vi.fn()
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const signedIn = () => auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1', email: 'ab@example.test' } } } })
const signedOut = () => auth.getSession.mockResolvedValue({ data: { session: null } })

function cards() {
  const all = Array.from(document.querySelectorAll<HTMLElement>('[data-tier]'))
  const byTier = (tier: string) => all.find((el) => el.dataset.tier === tier)!
  return { pro: byTier('pro'), proAi: byTier('proAi') }
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  auth.getSession.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('account button chunk', () => {
  it('holds the 36px box with a busy, labelled skeleton while the chunk loads', () => {
    const html = renderToStaticMarkup(
      <IntlWrapper>
        <AccountButtonSkeleton />
      </IntlWrapper>
    )
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('Loading account')
    expect(html).toMatch(/class="[^"]*h-9 w-9[^"]*motion-reduce:animate-none/)
  })

  it('preloads the same module the button renders, and never throws', async () => {
    expect(() => preloadAccountMenu()).not.toThrow()
    const Menu = await loadAccountMenu()
    render(<Menu email="ab@example.test" initials="AB" />)
    expect(screen.getByRole('button', { name: 'Account menu' })).toHaveTextContent('AB')
  })

  it('shows the skeleton first, then the menu, in the same box', async () => {
    render(<AccountMenuLoader email="ab@example.test" initials="AB" />)
    expect(await screen.findByRole('button', { name: 'Account menu' })).toHaveTextContent('AB')
  })
})

describe('pricing without scripts', () => {
  it('hides the CTA skeletons and offers each paid plan through sign-in, back to pricing', () => {
    const html = renderToStaticMarkup(
      <IntlWrapper>
        <PricingTable installHref={INSTALL} planLoading />
      </IntlWrapper>
    )
    expect(html).toContain('<noscript><style>[data-plan-cta-skeleton]{display:none}</style></noscript>')
    expect(html.match(/data-plan-cta-skeleton=""/g)).toHaveLength(2)
    const noscripts = html.match(/<noscript>(?!<style>).*?<\/noscript>/g) ?? []
    expect(noscripts.some((n) => n.includes('href="/auth/sign-in?redirectTo=/pricing"') && n.includes('Get Pro'))).toBe(true)
  })

  it('shows Pro AI as Coming soon without scripts while AI is off', () => {
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', '')
    const html = renderToStaticMarkup(
      <IntlWrapper>
        <PricingTable installHref={INSTALL} planLoading />
      </IntlWrapper>
    )
    const noscripts = html.match(/<noscript>(?!<style>).*?<\/noscript>/g) ?? []
    expect(noscripts).toHaveLength(2)
    expect(noscripts[1]).toContain('Coming soon')
    expect(noscripts[1]).not.toContain('href=')
  })

  it('renders no noscript once the plan is known', () => {
    const html = renderToStaticMarkup(
      <IntlWrapper>
        <PricingTable installHref={INSTALL} />
      </IntlWrapper>
    )
    expect(html).not.toContain('<noscript>')
  })
})

describe('CTA skeleton sizing', () => {
  it('stacks both non-subscriber labels, hidden, in one grid cell', () => {
    render(<PricingTable installHref={INSTALL} planLoading />)
    const loading = within(cards().pro).getByTestId('cta-loading')
    expect(loading).toHaveClass('grid')
    const labels = Array.from(loading.querySelectorAll('.invisible'))
    expect(labels.map((l) => l.textContent)).toEqual(['Get Pro', 'Upgrade to Pro'])
    for (const label of labels) {
      expect(label).toHaveClass('[grid-area:1/1]')
      expect(label).toHaveAttribute('aria-hidden', 'true')
    }
  })
})

describe('no remount when the plan arrives', () => {
  it('keeps focus and the visitor\'s option choice on the pricing page', async () => {
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
    vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', 'true')
    let answer!: (value: unknown) => void
    signedIn()
    fetchMock.mockReturnValue(new Promise((r) => (answer = r)))
    const user = userEvent.setup()
    render(<PricingTableForVisitor installHref={INSTALL} />)
    const proAiCard = cards().proAi
    const own = within(proAiCard).getByRole('radio', { name: 'You' })
    await user.click(own)
    expect(own).toHaveFocus()
    await act(async () => answer(json({ signedIn: true, tier: 'pro_ai', interval: 'monthly', aiMode: 'managed', periodEnd: null })))
    await waitFor(() => expect(screen.queryByTestId('cta-loading')).toBeNull())
    // Same element, still focused, still the visitor's choice (not the subscriber's seed).
    expect(cards().proAi).toBe(proAiCard)
    expect(within(proAiCard).getByRole('radio', { name: 'You' })).toBe(own)
    expect(own).toHaveFocus()
    expect(own).toBeChecked()
  })

  it('opens on the subscriber\'s option when the visitor hasn\'t touched the switch', async () => {
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
    vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', 'true')
    signedIn()
    fetchMock.mockResolvedValue(json({ signedIn: true, tier: 'pro_ai', interval: 'monthly', aiMode: 'byok', periodEnd: null }))
    render(<PricingTableForVisitor installHref={INSTALL} />)
    const proAiCard = cards().proAi
    await waitFor(() => expect(within(proAiCard).getByRole('radio', { name: 'You' })).toBeChecked())
    expect(cards().proAi).toBe(proAiCard)
  })

  it('keeps the home teaser\'s Monthly/Yearly choice and its elements when a paid plan arrives', async () => {
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
    vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', 'true')
    const user = userEvent.setup()
    const { rerender } = render(<PricingTeaser />)
    const yearly = screen.getByRole('button', { name: /Yearly/ })
    await user.click(yearly)
    expect(yearly).toHaveFocus()
    rerender(<PricingTeaser currentTier="pro_ai" currentAiMode="byok" />)
    expect(screen.getByRole('button', { name: /Yearly/ })).toBe(yearly)
    expect(yearly).toHaveFocus()
    expect(screen.getByRole('radio', { name: 'You' })).toBeChecked()
  })
})

describe('plan lookup timeout', () => {
  it('settles to the guest plan when the lookup stalls past the timeout, and aborts the request', async () => {
    vi.useFakeTimers()
    signedIn()
    let signal: AbortSignal | undefined
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined
      return new Promise(() => {})
    })
    const { result } = renderHook(() => useVisitorPlan())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLAN_LOOKUP_TIMEOUT_MS - 1)
    })
    expect(result.current).toBeUndefined()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(result.current).toEqual({ signedIn: false, tier: 'free', periodEnd: null })
    expect(signal?.aborted).toBe(true)
    expect(PLAN_LOOKUP_TIMEOUT_MS).toBe(8000)
  })
})

describe('plan status announcement', () => {
  it('is one empty polite status region while loading and for guests', async () => {
    signedOut()
    render(<PricingTableForVisitor installHref={INSTALL} />)
    const status = screen.getByRole('status')
    expect(screen.getAllByRole('status').filter((el) => el.dataset.testid === 'plan-status')).toHaveLength(1)
    expect(status).toHaveClass('sr-only')
    expect(status).toHaveTextContent('')
    await waitFor(() => expect(screen.queryByTestId('cta-loading')).toBeNull())
    expect(screen.getByTestId('plan-status')).toBe(status)
    expect(status).toHaveTextContent('')
  })

  it('says the signed-in visitor\'s plan once it is known', async () => {
    signedIn()
    fetchMock.mockResolvedValue(json({ signedIn: true, tier: 'pro', interval: 'yearly', periodEnd: null }))
    render(<PricingTableForVisitor installHref={INSTALL} />)
    const status = screen.getByTestId('plan-status')
    expect(status).toHaveTextContent('')
    await waitFor(() => expect(status).toHaveTextContent('Your plan: Pro'))
  })

  it('names Free for a signed-in free account', async () => {
    signedIn()
    fetchMock.mockResolvedValue(json({ signedIn: true, tier: 'free', periodEnd: null }))
    render(<PricingTableForVisitor installHref={INSTALL} />)
    await waitFor(() => expect(screen.getByTestId('plan-status')).toHaveTextContent('Your plan: Free'))
  })
})
