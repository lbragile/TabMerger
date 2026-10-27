/**
 * The home page's pricing teaser follows the signed-in visitor's plan with the pricing page's rule
 * (`planCardStatus`): Pro is Recommended unless the visitor already has it or a plan above it, and
 * the visitor's own paid plan shows "Current". The plan comes from the same server lookup the
 * pricing page uses (`getCurrentPlan`), so a paid tier counts only while its status is entitled.
 */
import { act, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface Row {
  tier: string
  status: string
  stripe_price_id: string | null
  ai_mode: string | null
  current_period_end: string | null
}

const db = vi.hoisted(() => ({
  user: null as { id: string } | null,
  subscription: null as Row | null,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: db.subscription }) }) }),
        }),
      }),
    }),
  }),
}))

import { PricingTeaserForVisitor } from '@/components/marketing/PricingTeaser'
import { getCurrentPlan } from '@/lib/currentPlan'

function subscription(tier: string, status: string, aiMode: string | null = null): Row {
  return { tier, status, stripe_price_id: null, ai_mode: aiMode, current_period_end: null }
}

/** Renders the teaser as the home page does and waits for the plan to arrive. */
async function renderFor(signedIn: boolean, row: Row | null = null) {
  db.user = signedIn ? { id: 'user-1' } : null
  db.subscription = row
  const planPromise = getCurrentPlan()
  await act(async () => {
    render(<PricingTeaserForVisitor planPromise={planPromise} />)
    await planPromise
  })
}

const card = (key: 'free' | 'pro' | 'proAi') => document.querySelector(`[data-tier="${key}"]`) as HTMLElement

/** The brand emphasis that goes with Recommended. */
const BRAND = /\bring-primary\b/

function expectProRecommended() {
  expect(within(card('pro')).getByText('Recommended')).toBeInTheDocument()
  expect(screen.getAllByText('Recommended')).toHaveLength(1)
  expect(card('pro').className).toMatch(BRAND)
  // Guests and free accounts see no "Current" (not even on Free): unchanged from before.
  expect(screen.queryByText('Current')).not.toBeInTheDocument()
}

beforeEach(() => {
  db.user = null
  db.subscription = null
})

describe('PricingTeaser: Recommended and Current by the visitor plan', () => {
  it('recommends Pro to a signed-out visitor', async () => {
    await renderFor(false)
    expectProRecommended()
  })

  it('recommends Pro to a signed-in free account', async () => {
    await renderFor(true, null)
    expectProRecommended()
  })

  it('does not recommend Pro to a Pro subscriber, and marks Pro as Current', async () => {
    await renderFor(true, subscription('pro', 'active'))
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument()
    expect(within(card('pro')).getByText('Current')).toBeInTheDocument()
    expect(screen.getAllByText('Current')).toHaveLength(1)
    expect(card('pro').className).not.toMatch(BRAND)
  })

  it.each(['active', 'trialing', 'past_due'])(
    'does not recommend Pro to a Pro AI subscriber (%s), and marks Pro AI as Current',
    async (status) => {
      await renderFor(true, subscription('pro_ai', status, 'managed'))
      expect(screen.queryByText('Recommended')).not.toBeInTheDocument()
      for (const key of ['free', 'pro', 'proAi'] as const) expect(card(key).className).not.toMatch(BRAND)
      expect(within(card('proAi')).getByText('Current')).toBeInTheDocument()
      expect(screen.getAllByText('Current')).toHaveLength(1)
    }
  )

  it('marks the own-key Pro AI option as Current for an own-key subscriber', async () => {
    await renderFor(true, subscription('pro_ai', 'active', 'byok'))
    expect(within(card('proAi')).getByRole('radio', { name: 'You' })).toBeChecked()
    expect(within(card('proAi')).getByText('Current')).toBeInTheDocument()
  })

  it.each(['canceled', 'incomplete', 'unpaid'])(
    'treats a Pro AI plan that is %s like a free account',
    async (status) => {
      await renderFor(true, subscription('pro_ai', status, 'managed'))
      expectProRecommended()
    }
  )
})
