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
      <div className="flex rounded-sm border border-border overflow-hidden text-sm">
        {(['monthly', 'yearly'] as const).map((opt) => (
          <button
            key={opt}
            onClick={() => setInterval(opt)}
            className={cn(
              'px-5 py-2 font-medium transition-colors',
              interval === opt
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:text-foreground'
            )}
          >
            {opt === 'monthly' ? 'Monthly' : 'Yearly'}
            {opt === 'yearly' && (
              <span className="ml-1.5 text-[10px] font-bold">
                {interval === 'yearly' ? '↓ Save ~27%' : 'Save ~27%'}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Grid: 1fr 1.15fr 1fr */}
      <div
        className="w-full max-w-5xl grid gap-4 items-start"
        style={{ gridTemplateColumns: '1fr 1.15fr 1fr' }}
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

        {/* Pro — highlighted, comes first on mobile */}
        <div className="order-first md:order-none">
          <PricingCard
            tier="pro"
            name={TIERS.pro.name}
            monthlyPrice={TIERS.pro.monthlyPrice}
            yearlyPrice={TIERS.pro.yearlyPrice}
            features={TIERS.pro.features}
            interval={interval}
            highlighted
            currentTier={currentTier}
            displayMonthly="$4/mo"
            displayYearly="$38/yr"
            yearlySubtext="$38/yr billed yearly"
          />
        </div>

        <PricingCard
          tier="proAi"
          name="Pro + AI"
          monthlyPrice={TIERS.proAi.monthlyPrice}
          yearlyPrice={TIERS.proAi.yearlyPrice}
          features={TIERS.proAi.features}
          interval={interval}
          currentTier={currentTier}
          displayMonthly="$8/mo"
          displayYearly="$76/yr"
          yearlySubtext="$76/yr billed yearly"
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
