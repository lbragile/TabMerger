/** The one Current / Recommended rule the pricing cards and the home teaser share. */
import { describe, expect, it } from 'vitest'
import { normalizeTier, planCardStatus } from '@/components/pricing/planStatus'

describe('normalizeTier', () => {
  it('maps the wire name proAi to the database name, and leaves the rest', () => {
    expect(normalizeTier('proAi')).toBe('pro_ai')
    for (const tier of ['free', 'pro', 'pro_ai']) expect(normalizeTier(tier)).toBe(tier)
  })
})

describe('planCardStatus', () => {
  it.each([
    [undefined, true],
    ['free', true],
    ['pro', false],
    ['pro_ai', false],
  ])('Pro (highlighted) with currentTier %s: recommended %s', (currentTier, recommended) => {
    expect(planCardStatus({ tier: 'pro', currentTier, highlighted: true }).showRecommended).toBe(recommended)
  })

  it('never recommends a card that is not highlighted', () => {
    expect(planCardStatus({ tier: 'proAi' }).showRecommended).toBe(false)
  })

  it('reads either tier name shape', () => {
    expect(planCardStatus({ tier: 'proAi', currentTier: 'pro_ai' }).isCurrentPlan).toBe(true)
    expect(planCardStatus({ tier: 'pro', currentTier: 'proAi' }).isBelowCurrentTier).toBe(true)
  })

  it('makes only the subscriber’s own Pro AI option Current (managed when unknown)', () => {
    const base = { tier: 'proAi', currentTier: 'pro_ai' }
    expect(planCardStatus({ ...base, aiMode: 'byok', currentAiMode: 'byok' }).isCurrentPlan).toBe(true)
    const other = planCardStatus({ ...base, aiMode: 'byok', currentAiMode: 'managed' })
    expect(other.isCurrentPlan).toBe(false)
    expect(other.isSameTier).toBe(true)
    expect(planCardStatus({ ...base, aiMode: 'managed' }).isCurrentPlan).toBe(true)
  })

  it('has nothing current or below for a visitor with no plan', () => {
    expect(planCardStatus({ tier: 'free' })).toEqual({
      isSameTier: false,
      isCurrentPlan: false,
      isBelowCurrentTier: false,
      showRecommended: false,
    })
  })
})
