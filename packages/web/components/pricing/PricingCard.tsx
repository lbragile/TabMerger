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
        'relative flex flex-col rounded-2xl border p-8 transition-all duration-200',
        'hover:-translate-y-1',
        highlighted
          ? 'border-primary bg-primary text-primary-foreground shadow-xl hover:shadow-2xl'
          : 'bg-background hover:shadow-md hover:border-primary/40'
      )}
    >
      {/* Corner ribbon — overflow-hidden is on the small 80×80 clip box, not the card,
          so the card's drop-shadow is not clipped. The rotated inner div then peeks out. */}
      {highlighted && (
        <div className="absolute top-0 right-0 w-20 h-20 overflow-hidden rounded-tr-2xl pointer-events-none">
          <div className="absolute top-[18px] -right-[18px] w-24 rotate-45 bg-amber-400 text-amber-950 text-[10px] font-bold py-1 text-center tracking-wide uppercase shadow-xs">
            Popular
          </div>
        </div>
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
        className="w-full transition-transform duration-150 hover:scale-[1.02] active:scale-[0.98]"
      >
        {loading
          ? 'Loading...'
          : isCurrentPlan
            ? 'Current plan'
            : tier === 'free'
              ? 'Get started free'
              : `Upgrade to ${name}`}
      </Button>

      {tier !== 'free' && !isCurrentPlan && (
        <p className={cn('mt-2 text-center text-xs', highlighted ? 'text-primary-foreground/50' : 'text-muted-foreground')}>
          Cancel anytime
        </p>
      )}
    </div>
  )
}
