import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TIERS } from '@/lib/tiers'

describe('TIERS.pro.features', () => {
  it('starts with "Everything in Free"', () => {
    expect(TIERS.pro.features[0]).toBe('Everything in Free')
  })
})

describe('getStripePriceId / getPriceInfo', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.STRIPE_PRO_MONTHLY_PRICE_ID = 'price_pro_monthly'
    process.env.STRIPE_PRO_YEARLY_PRICE_ID = 'price_pro_yearly'
    process.env.STRIPE_PRO_AI_MONTHLY_PRICE_ID = 'price_proai_monthly'
    process.env.STRIPE_PRO_AI_YEARLY_PRICE_ID = 'price_proai_yearly'
  })

  it('returns the monthly/yearly price id for a tier', async () => {
    const { getStripePriceId } = await import('@/lib/tiers')
    expect(getStripePriceId('pro', 'monthly')).toBe('price_pro_monthly')
    expect(getStripePriceId('pro', 'yearly')).toBe('price_pro_yearly')
    expect(getStripePriceId('proAi', 'monthly')).toBe('price_proai_monthly')
    expect(getStripePriceId('proAi', 'yearly')).toBe('price_proai_yearly')
  })

  it('resolves a known pro monthly price id to its display cost', async () => {
    const { getPriceInfo } = await import('@/lib/tiers')
    expect(getPriceInfo('price_pro_monthly')).toEqual({ amount: 3.99, interval: 'monthly' })
  })

  it('resolves a known pro AI yearly price id to its display cost', async () => {
    const { getPriceInfo } = await import('@/lib/tiers')
    expect(getPriceInfo('price_proai_yearly')).toEqual({ amount: 85.99, interval: 'yearly' })
  })

  it('returns null for an unknown/legacy price id', async () => {
    const { getPriceInfo } = await import('@/lib/tiers')
    expect(getPriceInfo('price_discontinued')).toBeNull()
  })

  it('returns null for null/undefined input', async () => {
    const { getPriceInfo } = await import('@/lib/tiers')
    expect(getPriceInfo(null)).toBeNull()
    expect(getPriceInfo(undefined)).toBeNull()
  })
})
