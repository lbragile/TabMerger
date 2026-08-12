'use client'

import { useState } from 'react'
import Link from 'next/link'
import { TIERS } from '@/lib/tiers'
import { cn } from '@/lib/utils'

const tiers = [
  { key: 'free', highlighted: false, blurb: 'For casual users trying it out' },
  { key: 'pro', highlighted: true, blurb: 'For users who want extra premium features' },
  { key: 'proAi', highlighted: false, blurb: 'For power users who want AI related features' },
] as const

export function PricingTeaser() {
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly')

  return (
    <section className="py-16 sm:py-[72px] px-6 sm:px-11 border-b border-border">
      <div className="container max-w-[960px] text-center">
        <h2 className="font-semibold tracking-tight mb-6 text-[28px] sm:text-[34px] leading-tight">
          Simple, transparent pricing
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
              {opt === 'monthly' ? 'Monthly' : 'Yearly'}
              {opt === 'yearly' && <span className="text-[11px] font-semibold text-primary">−10%</span>}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {tiers.map((t) => {
            const tier = TIERS[t.key]
            const rawPrice = interval === 'monthly' ? tier.monthlyPrice : tier.yearlyPrice
            const price = rawPrice === 0 ? '$0' : `$${rawPrice}`
            const period = rawPrice === 0 ? 'forever' : interval === 'monthly' ? '/mo' : '/yr'
            return (
              <div
                key={t.key}
                className={cn(
                  'rounded-2xl border p-6 relative',
                  t.highlighted ? 'bg-surface shadow-sh3 border-primary/30' : 'bg-surface border-border'
                )}
              >
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 mb-2">
                  <span />
                  <p className="text-sm font-semibold">{tier.name}</p>
                  {t.highlighted ? (
                    <span className="inline-flex items-center justify-self-end self-center text-[9.5px] font-semibold uppercase tracking-wider leading-none px-1.5 pt-[0.2656rem] pb-[0.2344rem] rounded-md bg-primary/15 text-primary">
                      Recommended
                    </span>
                  ) : (
                    <span />
                  )}
                </div>
                <p className="text-3xl font-semibold tracking-tight">
                  {price}
                  <span className="text-[13px] font-normal text-text3 ml-1">{period}</span>
                </p>
                <p className="text-[11.5px] text-text3 mt-1">{t.blurb}</p>
                {t.key === 'free' && (
                  <p className="text-[11.5px] text-text3 mt-1">No credit card required</p>
                )}
              </div>
            )
          })}
        </div>

        <Link
          href="/pricing"
          className="inline-flex items-center gap-1.5 h-10 px-5 rounded-lg bg-primary text-primary-foreground text-[13.5px] font-medium hover:bg-primary/90 transition-colors mb-4"
        >
          See full pricing
          <span aria-hidden="true">→</span>
        </Link>

        <p className="text-[12.5px] text-text3">
          Cancel anytime from your account — no lock-in, no questions asked.
        </p>
      </div>
    </section>
  )
}
