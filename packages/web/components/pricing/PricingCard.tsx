'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Check } from 'lucide-react'
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
        'flex flex-col border p-5',
        highlighted
          ? 'border-2 border-foreground p-[26px] bg-muted/30'
          : 'border-border bg-background'
      )}
      style={highlighted ? { boxShadow: '0 4px 24px rgba(0,0,0,0.10)' } : undefined}
    >
      {/* Title row */}
      <div className="flex items-center gap-2 mb-3">
        <h6 className={cn('text-sm font-semibold', highlighted ? 'text-foreground' : 'text-muted-foreground')}>
          {name}
        </h6>
        {highlighted && (
          <span
            className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 text-primary-foreground"
            style={{ background: 'hsl(var(--primary))' }}
          >
            Recommended
          </span>
        )}
      </div>

      {/* Price */}
      <div className="flex items-baseline gap-1 mb-1">
        <span className="font-extrabold" style={{ fontSize: '42px' }}>
          {displayPrice}
        </span>
      </div>
      {interval === 'yearly' && rawPrice > 0 && yearlySubtext && (
        <p className="text-muted-foreground mb-4" style={{ fontSize: '11.5px' }}>
          {yearlySubtext}
        </p>
      )}
      {(!yearlySubtext || interval !== 'yearly' || rawPrice === 0) && (
        <div className="mb-4" />
      )}

      {/* AI demo placeholder — proAi only */}
      {tier === 'proAi' && (
        <div
          className="bg-muted border border-border flex items-center justify-center text-xs text-muted-foreground mb-4"
          style={{ height: '56px' }}
        >
          Live AI demo
        </div>
      )}

      {/* Feature list */}
      <ul className="flex flex-col flex-1">
        {features.map((feature) => (
          <li
            key={feature}
            className={cn(
              'flex items-center gap-2 border-t border-border py-1.5 text-sm',
              highlighted && 'font-medium'
            )}
          >
            <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      {/* CTA button */}
      <div className="mt-4">
        {isFree ? (
          <Button
            variant="outline"
            className="w-full"
            onClick={handleClick}
            disabled={isCurrentPlan}
          >
            {isCurrentPlan ? 'Current plan' : 'Install free'}
          </Button>
        ) : (
          <Button
            variant={highlighted ? 'default' : 'outline'}
            className="w-full"
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
