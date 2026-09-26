'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Check, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AI_MONTHLY_CAP } from '@/lib/ai-usage'
import { AI_ENABLED } from '@/lib/aiFlag'
import { AI_COMING_SOON_LABEL } from '@tabmerger/shared'

// ponytail: tier keys differ between the DB (subscriptions.tier: 'free'|'pro'|'pro_ai')
// and the checkout API / TIERS config ('free'|'pro'|'proAi'). Normalize to DB shape here
// so `currentTier` (always DB shape) compares correctly against this card's `tier` prop.
const TIER_RANK: Record<string, number> = { free: 0, pro: 1, proAi: 2, pro_ai: 2 }
function normalizeTier(tier: string) {
  return tier === 'proAi' ? 'pro_ai' : tier
}

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

  const isComingSoon = tier === 'proAi' && !AI_ENABLED
  const rawPrice = interval === 'monthly' ? monthlyPrice : yearlyPrice
  const isCurrentPlan = !!currentTier && normalizeTier(currentTier) === normalizeTier(tier)
  const isFree = tier === 'free'
  // A signed-out visitor has no currentTier — treat as free/below every paid card.
  const isBelowCurrentTier =
    !!currentTier && TIER_RANK[normalizeTier(tier)] < TIER_RANK[normalizeTier(currentTier)]
  // Never recommend a tier the user already has or has surpassed.
  const showRecommended = highlighted && !isCurrentPlan && !isBelowCurrentTier

  // Display price: use override strings if provided, otherwise format from number
  const displayPrice =
    interval === 'monthly'
      ? (displayMonthly ?? (rawPrice === 0 ? '$0' : `$${rawPrice}`))
      : (displayYearly ?? (rawPrice === 0 ? '$0' : `$${rawPrice}`))

  async function handleClick() {
    if (isComingSoon) return
    if (isFree) {
      window.open('https://chrome.google.com/webstore', '_blank', 'noopener')
      return
    }

    setLoading(true)
    try {
      // Downgrading to an already-active Stripe subscription must go through the billing
      // portal (which changes the existing subscription's price) — a fresh /api/checkout
      // call would create a second, separate subscription instead of switching plans.
      const res = await fetch(isBelowCurrentTier ? '/api/billing-portal' : '/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: isBelowCurrentTier ? undefined : JSON.stringify({ tier, interval }),
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
        highlighted && 'shadow-sh3 border-primary/30 p-7',
        isCurrentPlan && 'border-primary/40'
      )}
    >
      {/* Title row */}
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <h6 className="text-sm font-semibold">{name}</h6>
        {isCurrentPlan && (
          <span className="inline-flex items-center text-[9.5px] font-semibold uppercase tracking-wider leading-none px-1.5 pt-[0.2656rem] pb-[0.2344rem] rounded-md bg-primary text-primary-foreground self-center">
            Current
          </span>
        )}
        {showRecommended && (
          <span className="inline-flex items-center text-[9.5px] font-semibold uppercase tracking-wider leading-none px-1.5 pt-[0.2656rem] pb-[0.2344rem] rounded-md bg-primary/15 text-primary self-center">
            Recommended
          </span>
        )}
        {tier === 'proAi' && !isComingSoon && <span className="text-primary text-xs">✦</span>}
        {isComingSoon && (
          <span className="inline-flex items-center text-[9.5px] font-semibold uppercase tracking-wider leading-none px-1.5 pt-[0.2656rem] pb-[0.2344rem] rounded-md bg-muted text-muted-foreground self-center">
            Coming soon
          </span>
        )}
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
        {tier === 'proAi' && !isComingSoon && (
          <li className="flex items-center gap-2 text-text2">
            <Plus className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span>{AI_MONTHLY_CAP} AI credits / month</span>
          </li>
        )}
      </ul>

      {/* CTA button — omitted for the current plan (badge already says so), except Free,
          which always offers the install link since "installed" isn't a Stripe state. */}
      <div className="mt-auto">
        {isComingSoon ? (
          <Button
            variant="outline"
            className="w-full rounded-lg cursor-not-allowed opacity-60"
            disabled
            aria-disabled="true"
          >
            {AI_COMING_SOON_LABEL}
          </Button>
        ) : isFree ? (
          <Button
            variant="outline"
            className="w-full rounded-lg"
            onClick={handleClick}
          >
            Install free
          </Button>
        ) : isCurrentPlan ? null : isBelowCurrentTier ? (
          // Downgrading an active Stripe subscription is a price change on the *existing*
          // subscription, not a new one — route through the billing portal (handleClick
          // hits /api/billing-portal here), never /api/checkout.
          <Button
            variant="secondary"
            className="w-full rounded-lg"
            onClick={handleClick}
            disabled={loading}
            loading={loading}
          >
            {`Downgrade to ${name}`}
          </Button>
        ) : (
          <Button
            className={cn(
              'w-full rounded-lg',
              highlighted && 'bg-primary text-primary-foreground hover:bg-primary/90'
            )}
            variant={highlighted ? 'default' : 'secondary'}
            onClick={handleClick}
            disabled={loading}
            loading={loading}
          >
            {`Upgrade to ${name}`}
          </Button>
        )}
      </div>
    </div>
  )
}
