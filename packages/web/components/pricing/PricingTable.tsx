'use client'

import { useState } from 'react'
import { PricingCard } from './PricingCard'
import { TIERS } from '@/lib/tiers'
import { cn } from '@/lib/utils'

interface PricingTableProps {
  currentTier?: string
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
            {opt === 'yearly' && (
              <span className="text-[11px] font-semibold text-primary">−10%</span>
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
            yearlySubtext={`$${TIERS.pro.yearlyPrice}/yr billed yearly`}
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
          yearlySubtext={`$${TIERS.proAi.yearlyPrice}/yr billed yearly`}
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
