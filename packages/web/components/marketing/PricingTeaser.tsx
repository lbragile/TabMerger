'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import {
  TIERS,
  YEARLY_DISCOUNT_PERCENT,
  YEARLY_SAVINGS,
} from '@/lib/tiers'
import { useYearlySubtext } from '@/components/pricing/useYearlySubtext'
import { useListPrice, useZeroPrice } from '@/components/pricing/priceFormat'
import { cn } from '@/lib/utils'
import { AI_ENABLED } from '@/lib/aiFlag'

const tiers = [
  { key: 'free', highlighted: false, blurb: 'blurbFree' },
  { key: 'pro', highlighted: true, blurb: 'blurbPro' },
  { key: 'proAi', highlighted: false, blurb: 'blurbProAi' },
] as const

/** The small muted lines under a card's price: the blurb, and the note below it. */
const SUB_LINE = 'text-[11.5px] text-text3 mt-1'

export function PricingTeaser() {
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly')
  const t = useTranslations('home.pricing')
  const p = useTranslations('pricing')
  const common = useTranslations('common')
  const yearlySubtext = useYearlySubtext()
  const listPrice = useListPrice()
  const zeroPrice = useZeroPrice()

  return (
    <section className="py-16 sm:py-[72px] px-6 sm:px-11 border-b border-border">
      <div className="container max-w-[960px] text-center">
        <h2 className="font-semibold tracking-tight mb-6 text-[28px] sm:text-[34px] leading-tight">
          {t('title')}
        </h2>

        {/* Monthly/Yearly toggle — mirrors the full pricing page's pill toggle */}
        <div className="inline-flex rounded-lg p-[3px] bg-surface3 border border-border text-sm mb-8">
          {(['monthly', 'yearly'] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setInterval(opt)}
              className={cn(
                'h-[30px] px-4 rounded-lg font-medium transition-colors text-[13px] flex items-center gap-1.5',
                interval === opt
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {opt === 'monthly' ? p('monthly') : p('yearly')}
              {opt === 'yearly' && YEARLY_DISCOUNT_PERCENT > 0 && (
                // Left-to-right isolate: keeps the minus sign before the number in RTL pages.
                <span dir="ltr" className="text-[11px] font-semibold text-primary">{p('discountBadge', { percent: YEARLY_DISCOUNT_PERCENT })}</span>
              )}
            </button>
          ))}
        </div>

        {/* auto-rows-fr: stacked on mobile, every card is as tall as the tallest one (a blurb
            that wraps makes its card taller); side by side, the single row already does that. */}
        <div className="grid grid-cols-1 auto-rows-fr sm:grid-cols-3 gap-4 mb-6">
          {tiers.map((row) => {
            const tier = TIERS[row.key]
            const isComingSoon = row.key === 'proAi' && !AI_ENABLED
            const rawPrice = interval === 'monthly' ? tier.monthlyPrice : tier.yearlyPrice
            const price = rawPrice === 0 ? zeroPrice : listPrice(rawPrice)
            const period = rawPrice === 0 ? p('forever') : interval === 'monthly' ? p('perMonth') : p('perYear')
            // Same wording and numbers as the pricing page's yearly cards.
            const monthlyEquivalent = row.key === 'free' ? null : yearlySubtext(YEARLY_SAVINGS[row.key])
            return (
              <div
                key={row.key}
                className={cn(
                  'rounded-2xl border p-6 relative',
                  row.highlighted ? 'bg-surface shadow-sh3 border-primary/30' : 'bg-surface border-border'
                )}
              >
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 mb-2">
                  <span />
                  <p className="text-sm font-semibold">{tier.name}</p>
                  {row.highlighted ? (
                    <span className="inline-flex items-center justify-self-end self-center text-[9.5px] font-semibold uppercase tracking-wider leading-none px-1.5 pt-[0.2656rem] pb-[0.2344rem] rounded-md bg-primary/15 text-primary">
                      {p('recommended')}
                    </span>
                  ) : isComingSoon ? (
                    <span className="inline-flex items-center justify-self-end self-center text-[9.5px] font-semibold uppercase tracking-wider leading-none px-1.5 pt-[0.2656rem] pb-[0.2344rem] rounded-md bg-muted text-muted-foreground">
                      {common('comingSoon')}
                    </span>
                  ) : (
                    <span />
                  )}
                </div>
                <p className="text-3xl font-semibold tracking-tight">
                  {price}
                  <span className="text-[13px] font-normal text-text3 ms-1">{period}</span>
                </p>
                <p className={SUB_LINE}>{t(row.blurb)}</p>
                {/* Every card has a note line, so the three stay the same height when stacked. A
                    paid card's line is the yearly price per month: on Monthly it stays in place,
                    hidden from sight and from assistive tech, so its space (however it wraps) is
                    already reserved and nothing moves on toggling. */}
                {monthlyEquivalent === null ? (
                  <p className={SUB_LINE}>{p('noCard')}</p>
                ) : (
                  <p
                    className={cn(SUB_LINE, interval === 'monthly' && 'invisible')}
                    aria-hidden={interval === 'monthly' ? true : undefined}
                  >
                    {monthlyEquivalent}
                  </p>
                )}
              </div>
            )
          })}
        </div>

        <Link
          href="/pricing"
          className="inline-flex items-center gap-1.5 h-10 px-5 rounded-lg bg-primary text-primary-foreground text-[13.5px] font-medium hover:bg-primary/90 transition-colors mb-4"
        >
          {t('seeFull')}
          {/* Points forward: mirrored right to left. */}
          <span aria-hidden="true" className="inline-block rtl:-scale-x-100">→</span>
        </Link>

        <p className="text-[12.5px] text-text3">
          {t('cancelNote')}
        </p>
        <p className="text-xs text-text3 mt-1">{p('usdNote')}</p>
      </div>
    </section>
  )
}
