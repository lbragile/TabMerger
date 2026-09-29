'use client'

import { useState } from 'react'
import { PricingCard } from './PricingCard'
import { TIERS, formatUsd, yearlySavings } from '@/lib/tiers'
import { cn } from '@/lib/utils'

interface PricingTableProps {
  currentTier?: string
}

const PRO_SAVINGS = yearlySavings(TIERS.pro.monthlyPrice, TIERS.pro.yearlyPrice)
const PRO_AI_SAVINGS = yearlySavings(TIERS.proAi.monthlyPrice, TIERS.proAi.yearlyPrice)
// The toggle badge claims the smaller of the two discounts, so it's true for every plan.
const YEARLY_DISCOUNT_PERCENT = Math.min(PRO_SAVINGS.percent, PRO_AI_SAVINGS.percent)

/** "$3.58/mo billed yearly · save 10%": the yearly plan's monthly equivalent, under its price. */
function yearlySubtext({ perMonth, percent }: ReturnType<typeof yearlySavings>): string {
  return `${formatUsd(perMonth)}/mo billed yearly${percent > 0 ? ` · save ${percent}%` : ''}`
}

export function PricingTable({ currentTier }: PricingTableProps) {
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly')

  return (
    <div className="flex flex-col items-center gap-10">
      {/* Segmented toggle */}
      <div className="inline-flex rounded-md p-[3px] bg-surface3 border border-border text-sm">
        {(['monthly', 'yearly'] as const).map((opt) => (
          <button
            key={opt}
            onClick={() => setInterval(opt)}
            className={cn(
              'h-[30px] px-4 rounded-lg font-medium transition-colors text-[13px] flex items-center gap-1.5 cursor-pointer',
              interval === opt
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {opt === 'monthly' ? 'Monthly' : 'Yearly'}
            {opt === 'yearly' && YEARLY_DISCOUNT_PERCENT > 0 && (
              <span className="text-[11px] font-semibold text-primary">−{YEARLY_DISCOUNT_PERCENT}%</span>
            )}
          </button>
        ))}
      </div>

      {/* Grid: 1fr 1.1fr 1fr */}
      <div
        className="w-full max-w-5xl grid grid-cols-1 md:[grid-template-columns:1fr_1.1fr_1fr] gap-4 items-center"
      >
        <PricingCard
          tier="free"
          name={TIERS.free.name}
          monthlyPrice={TIERS.free.monthlyPrice}
          yearlyPrice={TIERS.free.yearlyPrice}
          features={TIERS.free.features}
          interval={interval}
          currentTier={currentTier}
          displayMonthly="$0"
          displayYearly="$0"
        />

        {/* Pro — highlighted, same order as desktop */}
        <div>
          <PricingCard
            tier="pro"
            name={TIERS.pro.name}
            monthlyPrice={TIERS.pro.monthlyPrice}
            yearlyPrice={TIERS.pro.yearlyPrice}
            features={TIERS.pro.features}
            interval={interval}
            highlighted
            currentTier={currentTier}
            displayMonthly={`$${TIERS.pro.monthlyPrice}`}
            displayYearly={`$${TIERS.pro.yearlyPrice}`}
            yearlySubtext={yearlySubtext(PRO_SAVINGS)}
          />
        </div>

        <PricingCard
          tier="proAi"
          name={TIERS.proAi.name}
          monthlyPrice={TIERS.proAi.monthlyPrice}
          yearlyPrice={TIERS.proAi.yearlyPrice}
          features={TIERS.proAi.features}
          interval={interval}
          currentTier={currentTier}
          displayMonthly={`$${TIERS.proAi.monthlyPrice}`}
          displayYearly={`$${TIERS.proAi.yearlyPrice}`}
          yearlySubtext={yearlySubtext(PRO_AI_SAVINGS)}
        />
      </div>

      <p className="text-sm text-muted-foreground text-center">
        Cancel anytime from your account — no lock-in, no questions asked.
        <br />
        You keep access until the end of your billing period.
      </p>
    </div>
  )
}
