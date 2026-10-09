'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Check, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ALREADY_SUBSCRIBED_ERROR } from '@/lib/checkoutErrors'
import { AI_MONTHLY_CAP } from '@/lib/ai-usage'
import { AI_ENABLED } from '@/lib/aiFlag'
import { AI_COMING_SOON_LABEL } from '@tabmerger/shared'
import { formatListPrice } from '@/lib/tiers'

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
  /** How the current paid plan is billed. On that plan's card it enables "Switch to …". */
  currentInterval?: 'monthly' | 'yearly'
  displayMonthly?: string
  displayYearly?: string
  yearlySubtext?: string
  /**
   * Where the Free card's "Install free" goes. Resolved on the server (`getStoreLinks()`) and
   * passed down: this client component cannot tell which deployment it is running on.
   */
  installHref: string
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
  currentInterval,
  displayMonthly,
  displayYearly,
  yearlySubtext,
  installHref,
}: PricingCardProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [switchError, setSwitchError] = useState<string | null>(null)

  const isComingSoon = tier === 'proAi' && !AI_ENABLED
  const rawPrice = interval === 'monthly' ? monthlyPrice : yearlyPrice
  const isCurrentPlan = !!currentTier && normalizeTier(currentTier) === normalizeTier(tier)
  const isFree = tier === 'free'
  // A signed-out visitor has no currentTier — treat as free/below every paid card.
  const isBelowCurrentTier =
    !!currentTier && TIER_RANK[normalizeTier(tier)] < TIER_RANK[normalizeTier(currentTier)]
  // The pricing page passes a paid currentTier only while that subscription is entitled.
  const hasPaidPlan = !!currentTier && normalizeTier(currentTier) !== 'free'
  // Never recommend a tier the user already has or has surpassed.
  const showRecommended = highlighted && !isCurrentPlan && !isBelowCurrentTier
  // A paid current plan can move to the other billing interval (same plan, new price).
  const switchTarget =
    isCurrentPlan && !isFree && currentInterval
      ? currentInterval === 'monthly' ? 'yearly' : 'monthly'
      : null

  /** Opens Stripe's "confirm plan change" page for the same plan on the other interval. */
  async function handleSwitchInterval() {
    if (!switchTarget) return
    setLoading(true)
    setSwitchError(null)
    try {
      const res = await fetch('/api/billing/switch-interval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval: switchTarget }),
      })
      if (res.status === 401) {
        router.push('/auth/sign-in?redirectTo=/pricing')
        return
      }
      const data = await res.json().catch(() => ({}))
      if (data.url) {
        window.location.href = data.url
        return
      }
      // 409s explain themselves ("already scheduled…"); anything else gets the generic fallback.
      setSwitchError(
        res.status === 409 && typeof data.error === 'string'
          ? data.error
          : "Couldn't start the switch. Try Manage billing on your account page."
      )
    } finally {
      setLoading(false)
    }
  }

  // Display price: use override strings if provided, otherwise format from number
  const displayPrice =
    interval === 'monthly'
      ? (displayMonthly ?? (rawPrice === 0 ? '$0' : formatListPrice(rawPrice)))
      : (displayYearly ?? (rawPrice === 0 ? '$0' : formatListPrice(rawPrice)))

  async function handleClick() {
    if (isComingSoon) return
    if (isFree) {
      window.open(installHref, '_blank', 'noopener')
      return
    }

    setLoading(true)
    try {
      // An account holds one subscription, so a subscriber moving to another paid plan (up or
      // down) changes that subscription in the billing portal. Checkout only starts a first one.
      if (hasPaidPlan) {
        await openBillingPortal()
        return
      }

      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, interval }),
      })

      if (res.status === 401) {
        router.push('/auth/sign-in?redirectTo=/pricing')
        return
      }

      const data = await res.json().catch(() => ({}))

      // The server found a paid plan this page didn't know about (e.g. the page was loaded
      // before subscribing in another tab). Same destination as above: the billing portal.
      if (res.status === 409 && data.error === ALREADY_SUBSCRIBED_ERROR) {
        toast.info('You already have a plan. Opening billing so you can change it.')
        await openBillingPortal()
        return
      }

      if (data.url) {
        window.location.href = data.url
      }
    } finally {
      setLoading(false)
    }
  }

  /**
   * Sends the user to the Stripe billing portal, where an existing subscription is changed.
   * Says where to go instead when the portal can't be opened.
   */
  async function openBillingPortal() {
    const res = await fetch('/api/billing-portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    if (res.status === 401) {
      router.push('/auth/sign-in?redirectTo=/pricing')
      return
    }

    const data = await res.json().catch(() => ({}))
    if (data.url) {
      window.location.href = data.url
      return
    }

    toast.error("Couldn't open billing. Use Manage billing on your account page to change your plan.")
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
        ) : switchTarget ? (
          <>
            <Button
              variant="default"
              className="w-full rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={handleSwitchInterval}
              disabled={loading}
              loading={loading}
            >
              {switchTarget === 'yearly' ? 'Switch to yearly billing' : 'Switch to monthly billing'}
            </Button>
            {switchError && (
              <p role="alert" className="mt-2 text-center text-[11.5px] text-destructive">
                {switchError}
              </p>
            )}
          </>
        ) : isCurrentPlan ? null : isBelowCurrentTier ? (
          // A plan change is a price change on the *existing* subscription, not a new one:
          // handleClick sends every subscriber to /api/billing-portal, never /api/checkout.
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
