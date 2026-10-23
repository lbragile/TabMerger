import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TIERS } from '@/lib/tiers'

describe('TIERS.pro.features', () => {
  it('starts with "Everything in Free"', () => {
    expect(TIERS.pro.features[0]).toBe('Everything in Free')
  })

  // The save shortcuts are registered for every user, so they are sold as part of Free.
  it('does not sell keyboard shortcuts as a Pro feature: they are listed under Free', () => {
    expect(TIERS.pro.features).not.toContain('Keyboard shortcuts')
    expect(TIERS.proAi.features).not.toContain('Keyboard shortcuts')
    expect(TIERS.free.features).toContain('Keyboard shortcuts')
  })
})

describe('getStripePriceId / getPriceInfo', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.STRIPE_PRO_MONTHLY_PRICE_ID = 'price_pro_monthly'
    process.env.STRIPE_PRO_YEARLY_PRICE_ID = 'price_pro_yearly'
    process.env.STRIPE_PRO_AI_MONTHLY_PRICE_ID = 'price_proai_monthly'
    process.env.STRIPE_PRO_AI_YEARLY_PRICE_ID = 'price_proai_yearly'
    process.env.STRIPE_PRO_AI_BYOK_MONTHLY_PRICE_ID = 'price_byok_monthly'
    process.env.STRIPE_PRO_AI_BYOK_YEARLY_PRICE_ID = 'price_byok_yearly'
  })

  it('returns the monthly/yearly price id for a tier', async () => {
    const { getStripePriceId } = await import('@/lib/tiers')
    expect(getStripePriceId('pro', 'monthly')).toBe('price_pro_monthly')
    expect(getStripePriceId('pro', 'yearly')).toBe('price_pro_yearly')
    expect(getStripePriceId('proAi', 'monthly')).toBe('price_proai_monthly')
    expect(getStripePriceId('proAi', 'yearly')).toBe('price_proai_yearly')
  })

  it('picks Pro AI managed by default and the own-key prices for aiMode byok', async () => {
    const { getStripePriceId } = await import('@/lib/tiers')
    expect(getStripePriceId('proAi', 'monthly', 'managed')).toBe('price_proai_monthly')
    expect(getStripePriceId('proAi', 'monthly', 'byok')).toBe('price_byok_monthly')
    expect(getStripePriceId('proAi', 'yearly', 'byok')).toBe('price_byok_yearly')
    // Pro has no AI option: aiMode is ignored.
    expect(getStripePriceId('pro', 'yearly', 'byok')).toBe('price_pro_yearly')
  })

  it('reads the env at call time, and an unset or empty price id is undefined', async () => {
    const { getStripePriceId } = await import('@/lib/tiers')
    process.env.STRIPE_PRO_AI_BYOK_MONTHLY_PRICE_ID = ''
    expect(getStripePriceId('proAi', 'monthly', 'byok')).toBeUndefined()
    delete process.env.STRIPE_PRO_AI_BYOK_MONTHLY_PRICE_ID
    expect(getStripePriceId('proAi', 'monthly', 'byok')).toBeUndefined()
  })

  it('lists every configured price of a plan, or of one Pro AI option', async () => {
    const { getPlanPriceIds } = await import('@/lib/tiers')
    expect(getPlanPriceIds('pro')).toEqual(['price_pro_monthly', 'price_pro_yearly'])
    expect(getPlanPriceIds('proAi')).toEqual([
      'price_proai_monthly',
      'price_proai_yearly',
      'price_byok_monthly',
      'price_byok_yearly',
    ])
    expect(getPlanPriceIds('proAi', 'byok')).toEqual(['price_byok_monthly', 'price_byok_yearly'])
  })

  it('maps a price id to its tier, interval, AI option and USD list price', async () => {
    const { getPlanForPriceId } = await import('@/lib/tiers')
    expect(getPlanForPriceId('price_byok_yearly')).toMatchObject({
      tierKey: 'proAi',
      tier: 'pro_ai',
      interval: 'yearly',
      aiMode: 'byok',
      amount: 64.99,
    })
    expect(getPlanForPriceId('price_proai_monthly')).toMatchObject({ tier: 'pro_ai', aiMode: 'managed', amount: 7.99 })
    expect(getPlanForPriceId('price_pro_monthly')).toMatchObject({ tier: 'pro', aiMode: null, amount: 3.99 })
    expect(getPlanForPriceId('price_unknown')).toBeNull()
    expect(getPlanForPriceId(undefined)).toBeNull()
  })

  it('resolves a known pro monthly price id to its display cost', async () => {
    const { getPriceInfo } = await import('@/lib/tiers')
    expect(getPriceInfo('price_pro_monthly')).toEqual({ amount: 3.99, interval: 'monthly', aiMode: null })
  })

  it('resolves a known pro AI yearly price id to its display cost', async () => {
    const { getPriceInfo } = await import('@/lib/tiers')
    expect(getPriceInfo('price_proai_yearly')).toEqual({ amount: 85.99, interval: 'yearly', aiMode: 'managed' })
  })

  it('resolves the own-key Pro AI prices and reports aiMode byok', async () => {
    const { getPriceInfo } = await import('@/lib/tiers')
    expect(getPriceInfo('price_byok_monthly')).toEqual({ amount: 5.99, interval: 'monthly', aiMode: 'byok' })
    expect(getPriceInfo('price_byok_yearly')).toEqual({ amount: 64.99, interval: 'yearly', aiMode: 'byok' })
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

describe('yearlySavings', () => {
  it('gives the per-month equivalent and the saving against twelve monthly payments', async () => {
    const { yearlySavings } = await import('@/lib/tiers')
    const { perMonth, percent } = yearlySavings(3.99, 42.99)
    expect(perMonth).toBeCloseTo(3.5825)
    expect(percent).toBe(10) // 10.21%, rounded down
  })

  it('rounds the percentage down so it never overstates the discount', async () => {
    const { yearlySavings } = await import('@/lib/tiers')
    expect(yearlySavings(10, 101).percent).toBe(15) // 15.83%
  })

  it('is 0% when there is no discount or no monthly price', async () => {
    const { yearlySavings } = await import('@/lib/tiers')
    expect(yearlySavings(5, 60).percent).toBe(0)
    expect(yearlySavings(0, 0).percent).toBe(0)
  })
})

// The yearly line's wording: __tests__/i18n-infrastructure.test.tsx (useYearlySubtext).

describe('YEARLY_DISCOUNT_PERCENT', () => {
  it('is the smallest of every paid option’s savings, so the toggle badge is true for each', async () => {
    const { YEARLY_DISCOUNT_PERCENT, YEARLY_SAVINGS } = await import('@/lib/tiers')
    expect(YEARLY_DISCOUNT_PERCENT).toBe(
      Math.min(YEARLY_SAVINGS.pro.percent, YEARLY_SAVINGS.proAi.percent, YEARLY_SAVINGS.proAiByok.percent)
    )
    // $64.99 against 12 × $5.99 is 9.6% off, rounded down to 9: the own-key option sets the badge.
    expect(YEARLY_SAVINGS.proAiByok.percent).toBe(9)
    expect(YEARLY_DISCOUNT_PERCENT).toBe(9)
  })
})

describe('TIERS.proAi.byok', () => {
  it('copies the own-key prices and features from PRICING_TIERS', async () => {
    const { TIERS } = await import('@/lib/tiers')
    const { getPricingTier } = await import('@tabmerger/shared')
    const byok = getPricingTier('pro_ai').byok!
    expect(TIERS.proAi.byok).toMatchObject({
      monthlyPrice: byok.monthlyPrice,
      yearlyPrice: byok.yearlyPrice,
      features: byok.features,
    })
    expect(TIERS.proAi.byok.monthlyPrice).toBe(5.99)
    expect(TIERS.proAi.byok.yearlyPrice).toBe(64.99)
  })
})

describe('formatUsd', () => {
  it('always shows cents', async () => {
    const { formatUsd } = await import('@/lib/tiers')
    // Always marked as US dollars: a bare "$" reads as local dollars in Canada and elsewhere.
    expect(formatUsd(3.5825)).toBe('US$3.58')
    expect(formatUsd(7)).toBe('US$7.00')
  })

  it('formatListPrice leaves the currency to the listing footnote', async () => {
    const { formatListPrice, PRICES_IN_USD_NOTE } = await import('@/lib/tiers')
    expect(formatListPrice(3.5825)).toBe('$3.58')
    expect(formatListPrice(7)).toBe('$7.00')
    expect(PRICES_IN_USD_NOTE).toMatch(/US dollars \(USD\)/)
  })
})
