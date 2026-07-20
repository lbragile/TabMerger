'use client'

import { useState } from 'react'
import { PricingCard } from './PricingCard'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { TIERS } from '@/lib/tiers'

interface PricingTableProps {
  currentTier?: string
}

export function PricingTable({ currentTier }: PricingTableProps) {
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly')

  const savings = {
    pro: Math.round(
      (1 - TIERS.pro.yearlyPrice / (TIERS.pro.monthlyPrice * 12)) * 100
    ),
    proAi: Math.round(
      (1 - TIERS.proAi.yearlyPrice / (TIERS.proAi.monthlyPrice * 12)) * 100
    ),
  }

  return (
    <div className="flex flex-col items-center gap-10">
      <div className="flex items-center gap-3">
        <Label htmlFor="billing-toggle" className={interval === 'monthly' ? 'font-semibold' : 'text-muted-foreground'}>
          Monthly
        </Label>
        <Switch
          id="billing-toggle"
          checked={interval === 'yearly'}
          onCheckedChange={(checked) =>
            setInterval(checked ? 'yearly' : 'monthly')
          }
        />
        <Label htmlFor="billing-toggle" className={interval === 'yearly' ? 'font-semibold' : 'text-muted-foreground'}>
          Yearly{' '}
          <span className="ml-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            Save up to {savings.proAi}%
          </span>
        </Label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl">
        <PricingCard
          tier="free"
          name={TIERS.free.name}
          monthlyPrice={TIERS.free.monthlyPrice}
          yearlyPrice={TIERS.free.yearlyPrice}
          features={TIERS.free.features}
          interval={interval}
          currentTier={currentTier}
        />
        <PricingCard
          tier="pro"
          name={TIERS.pro.name}
          monthlyPrice={TIERS.pro.monthlyPrice}
          yearlyPrice={TIERS.pro.yearlyPrice}
          features={TIERS.pro.features}
          interval={interval}
          highlighted
          currentTier={currentTier}
        />
        <PricingCard
          tier="proAi"
          name={TIERS.proAi.name}
          monthlyPrice={TIERS.proAi.monthlyPrice}
          yearlyPrice={TIERS.proAi.yearlyPrice}
          features={TIERS.proAi.features}
          interval={interval}
          currentTier={currentTier}
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
