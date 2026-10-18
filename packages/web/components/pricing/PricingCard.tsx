'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRouter as useLocaleRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Check, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ALREADY_SUBSCRIBED_ERROR } from '@/lib/checkoutErrors'
import { AI_MONTHLY_CAP } from '@/lib/ai-usage'
import { AI_ENABLED } from '@/lib/aiFlag'
import { CHECKOUT_TIERS, trackBeginCheckout, type CheckoutTier } from '@/lib/checkoutAnalytics'
import { isExternalStoreLink } from '@/lib/storeLinks'
import { useListPrice, useZeroPrice } from './priceFormat'
import type { TierFeature } from './tierFeatures'

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
  /** Already translated; `inherited` lines ("Everything in Free") get a check mark, the rest a +. */
  features: readonly TierFeature[]
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
  // For links into the localized site (the Firefox beta guide): keeps the visitor's language prefix.
  // `/auth/*` has no prefixed version, so those pushes use the plain router.
  const localeRouter = useLocaleRouter()
  const t = useTranslations('pricing')
  const common = useTranslations('common')
  const listPrice = useListPrice()
  const zeroPrice = useZeroPrice()
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
          : t('switchFailed')
      )
    } finally {
      setLoading(false)
    }
  }

  // Display price: use override strings if provided, otherwise format from number
  const displayPrice =
    interval === 'monthly'
      ? (displayMonthly ?? (rawPrice === 0 ? zeroPrice : listPrice(rawPrice)))
      : (displayYearly ?? (rawPrice === 0 ? zeroPrice : listPrice(rawPrice)))

  async function handleClick() {
    if (isComingSoon) return
    if (isFree) {
      // A store listing opens in a new tab. A link into this site (the Firefox beta guide) is a
      // client-side navigation, so the guide's install still counts as this click (see StoreLink).
      if (isExternalStoreLink(installHref)) window.open(installHref, '_blank', 'noopener')
      else localeRouter.push(installHref)
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

      // Funnel start: counted when the checkout request starts, whatever it answers.
      if ((CHECKOUT_TIERS as readonly string[]).includes(tier)) {
        trackBeginCheckout({
          tier: tier as CheckoutTier,
          interval,
          source: 'pricing_page',
          component: 'pricing_card',
        })
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
        toast.info(t('alreadySubscribed'))
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

    toast.error(t('portalFailed'))
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
        <h2 className="text-sm font-semibold">{name}</h2>
        {isCurrentPlan && (
          <span className="inline-flex items-center text-[9.5px] font-semibold uppercase tracking-wider leading-none px-1.5 pt-[0.2656rem] pb-[0.2344rem] rounded-md bg-primary text-primary-foreground self-center">
            {t('current')}
          </span>
        )}
        {showRecommended && (
          <span className="inline-flex items-center text-[9.5px] font-semibold uppercase tracking-wider leading-none px-1.5 pt-[0.2656rem] pb-[0.2344rem] rounded-md bg-primary/15 text-primary self-center">
            {t('recommended')}
          </span>
        )}
        {tier === 'proAi' && !isComingSoon && <span className="text-primary text-xs">✦</span>}
        {isComingSoon && (
          <span className="inline-flex items-center text-[9.5px] font-semibold uppercase tracking-wider leading-none px-1.5 pt-[0.2656rem] pb-[0.2344rem] rounded-md bg-muted text-muted-foreground self-center">
            {common('comingSoon')}
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
          {rawPrice === 0 ? t('forever') : interval === 'monthly' ? t('perMonth') : t('perYear')}
        </span>
      </div>
      {interval === 'yearly' && rawPrice > 0 && yearlySubtext && (
        <p className="-mt-4 mb-5 text-[11.5px] text-text3">
          {yearlySubtext}
        </p>
      )}
      {isFree && <p className="-mt-4 mb-5 text-[11.5px] text-text3">{t('noCard')}</p>}

      {/* Feature list */}
      <ul className="flex flex-col gap-2 mb-6 text-[13.5px]">
        {features.map((feature) => (
          <li key={feature.text} className="flex items-center gap-2 text-text2">
            {/* ponytail: "Everything in X" line confirms an already-established capability →
                checkmark. Every other line is new to this tier → +. Free has no "Everything in"
                line, so all of its features are +. */}
            {feature.inherited ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
            ) : (
              <Plus className="h-3.5 w-3.5 shrink-0 text-primary" />
            )}
            <span>{feature.text}</span>
          </li>
        ))}
        {tier === 'proAi' && !isComingSoon && (
          <li className="flex items-center gap-2 text-text2">
            <Plus className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span>{t('features.aiCredits', { count: AI_MONTHLY_CAP })}</span>
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
            {common('comingSoon')}
          </Button>
        ) : isFree ? (
          <Button
            variant="outline"
            className="w-full rounded-lg"
            onClick={handleClick}
          >
            {t('installFree')}
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
              {switchTarget === 'yearly' ? t('switchToYearly') : t('switchToMonthly')}
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
            {t('downgradeTo', { name })}
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
            {t('upgradeTo', { name })}
          </Button>
        )}
      </div>
    </div>
  )
}
