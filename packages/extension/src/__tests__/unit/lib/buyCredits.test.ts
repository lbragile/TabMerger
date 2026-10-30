import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ACCOUNT_AI_CREDITS_ANCHOR } from '@tabmerger/shared'
import { LOW_CREDIT_BALANCE_RATIO, buyCreditsUrl, isLowCreditBalance, openBuyCredits } from '@/lib/buyCredits'

describe('buyCreditsUrl', () => {
  it("defaults to the build's web app, at the account page's AI credits section", () => {
    expect(buyCreditsUrl()).toBe(`${import.meta.env.VITE_WEB_APP_URL}/account#${ACCOUNT_AI_CREDITS_ANCHOR}`)
  })

  it('a build without a web app URL gives a relative path, not "undefined/account"', () => {
    vi.stubEnv('VITE_WEB_APP_URL', undefined)
    try {
      expect(buyCreditsUrl()).toBe(`/account#${ACCOUNT_AI_CREDITS_ANCHOR}`)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('builds on the web app URL it is given', () => {
    expect(buyCreditsUrl('https://example.com')).toBe(`https://example.com/account#${ACCOUNT_AI_CREDITS_ANCHOR}`)
  })
})

describe('openBuyCredits', () => {
  const create = vi.fn()
  beforeEach(() => {
    create.mockReset()
    globalThis.chrome = { tabs: { create } } as unknown as typeof chrome
  })

  it('opens the buy-credits page in a new active tab', () => {
    openBuyCredits()
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith({ url: buyCreditsUrl(), active: true })
  })
})

describe('isLowCreditBalance', () => {
  it('uses a 10% threshold', () => {
    expect(LOW_CREDIT_BALANCE_RATIO).toBe(0.1)
  })

  it.each([
    [251, 2500, false],
    [250, 2500, false],
    [249, 2500, true],
    [0, 2500, true],
    [2498, 2500, false],
    // packs bought this month raise the total the share is taken of
    [299, 3000, true],
    [300, 3000, false]
  ])('%i of %i left: low = %s', (remaining, total, low) => {
    expect(isLowCreditBalance(remaining, total)).toBe(low)
  })

  it('is exact at 10% for every whole total', () => {
    for (let total = 10; total <= 20000; total += 10) {
      expect(isLowCreditBalance(total / 10, total)).toBe(false)
      expect(isLowCreditBalance(total / 10 - 1, total)).toBe(true)
    }
  })

  it('a total of 0 is low only when nothing is left, without dividing by zero', () => {
    expect(isLowCreditBalance(0, 0)).toBe(true)
    expect(isLowCreditBalance(5, 0)).toBe(false)
    expect(isLowCreditBalance(0, -1)).toBe(true)
  })

  it('a balance that is not a number is never low', () => {
    expect(isLowCreditBalance(Number.NaN, 2500)).toBe(false)
    expect(isLowCreditBalance(Number.NaN, 0)).toBe(false)
    expect(isLowCreditBalance(10, Number.NaN)).toBe(false)
    expect(isLowCreditBalance(0, Number.POSITIVE_INFINITY)).toBe(true)
  })
})

describe('the anchor', () => {
  it("is the shared id the web app's account page puts on its AI credits section", () => {
    expect(ACCOUNT_AI_CREDITS_ANCHOR).toBe('ai-credits')
    expect(buyCreditsUrl('https://example.com').endsWith(`#${ACCOUNT_AI_CREDITS_ANCHOR}`)).toBe(true)
  })
})
