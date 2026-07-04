'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
}: PricingCardProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const price = interval === 'monthly' ? monthlyPrice : yearlyPrice
  const isCurrentPlan = currentTier === tier

  async function handleClick() {
    if (tier === 'free') {
      router.push('https://chrome.google.com/webstore')
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
        'relative flex flex-col rounded-2xl border p-8',
        highlighted
          ? 'border-primary bg-primary text-primary-foreground shadow-xl'
          : 'bg-background'
      )}
    >
      {highlighted && (
        <Badge
          className="absolute -top-3 left-1/2 -translate-x-1/2 bg-yellow-500 text-yellow-950 hover:bg-yellow-500"
        >
          Most Popular
        </Badge>
      )}
      <div className="mb-6">
        <h3 className={cn('text-lg font-semibold', highlighted && 'text-primary-foreground')}>
          {name}
        </h3>
        <div className="mt-2 flex items-baseline gap-1">
          <span className="text-4xl font-bold">
            {price === 0 ? 'Free' : `$${price}`}
          </span>
          {price > 0 && (
            <span className={cn('text-sm', highlighted ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
              /{interval === 'monthly' ? 'mo' : 'yr'}
            </span>
          )}
        </div>
        {interval === 'yearly' && price > 0 && (
          <p className={cn('mt-1 text-xs', highlighted ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
            Billed annually
          </p>
        )}
      </div>

      <ul className="mb-8 flex flex-col gap-3 flex-1">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm">
            <Check
              className={cn(
                'h-4 w-4 shrink-0 mt-0.5',
                highlighted ? 'text-primary-foreground' : 'text-primary'
              )}
            />
            <span className={highlighted ? 'text-primary-foreground/90' : ''}>
              {feature}
            </span>
          </li>
        ))}
      </ul>

      <Button
        onClick={handleClick}
        disabled={loading || isCurrentPlan}
        variant={highlighted ? 'secondary' : 'default'}
        className="w-full"
      >
        {loading
          ? 'Loading...'
          : isCurrentPlan
            ? 'Current plan'
            : tier === 'free'
              ? 'Get started free'
              : `Upgrade to ${name}`}
      </Button>
    </div>
  )
}
