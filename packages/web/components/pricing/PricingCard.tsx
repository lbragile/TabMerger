'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Check, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PricingCardProps {
  name: string
  monthlyPrice: number
  yearlyPrice: number
  features: readonly string[]
  interval: 'monthly' | 'yearly'
  tier: string
  highlighted?: boolean
  currentTier?: string
  displayMonthly?: string
  displayYearly?: string
  yearlySubtext?: string
}

export function PricingCard({
  name,
  monthlyPrice,
  yearlyPrice,
  features,
  interval,
  tier,
  highlighted = false,
  currentTier,
  displayMonthly,
  displayYearly,
  yearlySubtext,
}: PricingCardProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const rawPrice = interval === 'monthly' ? monthlyPrice : yearlyPrice
  const isCurrentPlan = currentTier === tier
  const isFree = tier === 'free'

  // Display price: use override strings if provided, otherwise format from number
  const displayPrice =
    interval === 'monthly'
      ? (displayMonthly ?? (rawPrice === 0 ? '$0' : `$${rawPrice}`))
      : (displayYearly ?? (rawPrice === 0 ? '$0' : `$${rawPrice}`))

  async function handleClick() {
    if (isFree) {
      window.open('https://chrome.google.com/webstore', '_blank', 'noopener')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, interval }),
      })

      if (res.status === 401) {
        router.push('/auth/sign-in?redirectTo=/pricing')
        return
      }

      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className={cn(
        'flex flex-col rounded-2xl p-6 border border-border bg-surface',
        highlighted && 'shadow-[var(--sh3)] border-primary/30 p-7'
      )}
    >
      {/* Title row */}
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <h6 className="text-sm font-semibold">{name}</h6>
        {highlighted && (
          <span className="text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-primary/15 text-primary">
            Recommended
          </span>
        )}
        {tier === 'proAi' && <span className="text-primary text-xs">✦</span>}
      </div>

      {/* Price */}
      <div className="flex items-baseline gap-1.5 mb-5">
        <span
          className={cn('font-semibold tracking-tight', highlighted ? 'text-[44px]' : 'text-4xl')}
        >
          {displayPrice}
        </span>
        <span className="text-[13px] text-text3">
          {rawPrice === 0 ? 'forever' : interval === 'monthly' ? '/mo' : '/yr'}
        </span>
      </div>
      {interval === 'yearly' && rawPrice > 0 && yearlySubtext && (
        <p className="-mt-4 mb-5 text-[11.5px] text-text3">
          {yearlySubtext}
        </p>
      )}
      {isFree && <p className="-mt-4 mb-5 text-[11.5px] text-text3">No credit card required</p>}

      {/* Feature list */}
      <ul className="flex flex-col gap-2 mb-6 text-[13.5px]">
        {features.map((feature) => (
          <li key={feature} className="flex items-center gap-2 text-text2">
            {/* ponytail: "Everything in X" line confirms an already-established capability →
                checkmark. Every other line is new to this tier → +. Free has no "Everything in"
                line, so all of its features are +. */}
            {feature.startsWith('Everything in ') ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
            ) : (
              <Plus className="h-3.5 w-3.5 shrink-0 text-primary" />
            )}
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      {/* CTA button */}
      <div className="mt-auto">
        {isFree ? (
          <Button
            variant="outline"
            className="w-full rounded-[10px]"
            onClick={handleClick}
            disabled={isCurrentPlan}
          >
            {isCurrentPlan ? 'Current plan' : 'Install free'}
          </Button>
        ) : (
          <Button
            className={cn(
              'w-full rounded-[10px]',
              highlighted && 'bg-primary text-primary-foreground shadow-[0_10px_26px_-10px_rgba(0,180,204,0.9)] hover:bg-primary/90'
            )}
            variant={highlighted ? 'default' : 'secondary'}
            onClick={handleClick}
            disabled={loading || isCurrentPlan}
          >
            {loading
              ? 'Loading...'
              : isCurrentPlan
                ? 'Current plan'
                : `Upgrade to ${name}`}
          </Button>
        )}
      </div>
    </div>
  )
}
