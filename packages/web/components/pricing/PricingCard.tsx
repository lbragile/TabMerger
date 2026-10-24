'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRouter as useLocaleRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import type { AiMode } from '@tabmerger/shared'
import { Button } from '@/components/ui/button'
import { Check, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ALREADY_SUBSCRIBED_ERROR } from '@/lib/checkoutErrors'
import { CHECKOUT_TIERS, trackBeginCheckout, type CheckoutTier } from '@/lib/checkoutAnalytics'
import { isExternalStoreLink } from '@/lib/storeLinks'
import { useListPrice, useZeroPrice } from './priceFormat'
import type { TierFeature } from './tierFeatures'
import { AiOptionSwitch } from './AiOptionSwitch'
import { AI_OPTION_ORDER, initialAiMode, isAiOptionAvailable } from './aiOptions'
import { usePlanChange } from './usePlanChange'
import type { PaidTierKey } from '@/lib/tiers'

// ponytail: tier keys differ between the DB (subscriptions.tier: 'free'|'pro'|'pro_ai')
// and the checkout API / TIERS config ('free'|'pro'|'proAi'). Normalize to DB shape here
// so `currentTier` (always DB shape) compares correctly against this card's `tier` prop.
const TIER_RANK: Record<string, number> = { free: 0, pro: 1, proAi: 2, pro_ai: 2 }
function normalizeTier(tier: string) {
  return tier === 'proAi' ? 'pro_ai' : tier
}

/** One Pro AI option's prices and features, as the card shows them. */
export interface AiOptionDisplay {
  monthlyPrice: number
  yearlyPrice: number
  displayMonthly?: string
  displayYearly?: string
  yearlySubtext?: string
  features: readonly TierFeature[]
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
  /**
   * Pro AI only: both options (TabMerger's AI and your own key). Given, the card shows a switch
   * between them and takes the price, yearly line and features from the selected one; the
   * single-option props above are then unused.
   */
  aiOptions?: Record<AiMode, AiOptionDisplay>
  /** The Pro AI subscriber's option (`subscriptions.ai_mode`). The card opens on it. */
  currentAiMode?: AiMode
  /** When the current paid period ends: the date a scheduled plan change takes effect. */
  currentPeriodEnd?: string | null
}

export function PricingCard({
  name,
  interval,
  tier,
  highlighted = false,
  currentTier,
  currentInterval,
  installHref,
  aiOptions,
  currentAiMode,
  currentPeriodEnd,
  ...singleOption
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
  const isProAi = tier === 'proAi'
  // Pro AI's option on show. Other plans have none; 'managed' keeps their checks simple.
  const [aiMode, setAiMode] = useState<AiMode>(() => (isProAi ? initialAiMode(currentAiMode) : 'managed'))
  const { monthlyPrice, yearlyPrice, displayMonthly, displayYearly, yearlySubtext, features } =
    aiOptions?.[aiMode] ?? singleOption

  const rawPrice = interval === 'monthly' ? monthlyPrice : yearlyPrice
  const isSameTier = !!currentTier && normalizeTier(currentTier) === normalizeTier(tier)
  // A Pro AI subscriber's plan is one option: the other option's card is a switch, not "Current".
  const isCurrentPlan = isSameTier && (!isProAi || (currentAiMode ?? 'managed') === aiMode)
  // An option that isn't on sale yet, unless it's the one this account already has.
  const isComingSoon = isProAi && !isAiOptionAvailable(aiMode) && !isCurrentPlan
  // A Pro AI subscriber looking at the other option can move to it on the same subscription.
  const aiModeSwitchTarget = isSameTier && isProAi && !isCurrentPlan ? aiMode : null
  const isFree = tier === 'free'
  // A signed-out visitor has no currentTier — treat as free/below every paid card.
  const isBelowCurrentTier =
    !!currentTier && TIER_RANK[normalizeTier(tier)] < TIER_RANK[normalizeTier(currentTier)]
  // The pricing page passes a paid currentTier only while that subscription is entitled.
  const hasPaidPlan = !!currentTier && normalizeTier(currentTier) !== 'free'
  // A subscriber's changes (plan, interval, Pro AI option) go through one confirm-then-post flow.
  const change = usePlanChange(
    hasPaidPlan
      ? {
          tierKey: normalizeTier(currentTier ?? '') === 'pro_ai' ? 'proAi' : 'pro',
          interval: currentInterval,
          aiMode: currentAiMode ?? 'managed',
          periodEnd: currentPeriodEnd,
        }
      : null,
    '/pricing'
  )
  // Never recommend a tier the user already has or has surpassed.
  const showRecommended = highlighted && !isCurrentPlan && !isBelowCurrentTier
  // A paid current plan can move to the other billing interval (same plan, new price).
  const switchTarget =
    isCurrentPlan && !isFree && currentInterval
      ? currentInterval === 'monthly' ? 'yearly' : 'monthly'
      : null

  /** The same plan on the other interval (confirmed first when the server acts on it). */
  function handleSwitchInterval() {
    if (switchTarget) change.start({ interval: switchTarget })
  }

  /** Pro AI's other setup option, same interval (confirmed first when the server acts on it). */
  function handleSwitchAiMode() {
    if (aiModeSwitchTarget) change.start({ aiMode: aiModeSwitchTarget })
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

    // An account holds one subscription, so a subscriber moving to another paid plan (up or down)
    // changes that subscription; checkout only starts a first one. With the current interval known,
    // the change goes to the plan this card shows (its interval and, for Pro AI, its setup option)
    // through the confirm-then-post flow; otherwise the billing portal, where the user picks.
    if (hasPaidPlan && currentInterval) {
      change.start({ tier: tier as PaidTierKey, interval, ...(isProAi ? { aiMode } : {}) })
      return
    }

    setLoading(true)
    try {
      if (hasPaidPlan) {
        await openBillingPortal()
        return
      }

      // Funnel start: counted when the checkout request starts, whatever it answers.
      if ((CHECKOUT_TIERS as readonly string[]).includes(tier)) {
        trackBeginCheckout({
          tier: tier as CheckoutTier,
          interval,
          ...(isProAi ? { aiMode } : {}),
          source: 'pricing_page',
          component: 'pricing_card',
        })
      }

      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Pro AI names its option: TabMerger's AI or the customer's own key (a different Price).
        body: JSON.stringify(isProAi ? { tier, interval, aiMode } : { tier, interval }),
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
      // h-full fills the stretched grid cell, so the cards in a row are equally tall and the CTA
      // (mt-auto) sits at the bottom of each. The highlighted card is roomier on the sides only:
      // equal top and bottom padding keeps the title rows and the buttons on the same lines.
      className={cn(
        'flex flex-col h-full rounded-2xl p-6 border border-border bg-surface',
        highlighted && 'shadow-sh3 border-primary/30 px-7',
        isCurrentPlan && 'border-primary/40'
      )}
    >
      {/* Title row */}
      <div className="flex items-center justify-between gap-2 mb-2.5">
        {/* The plan name leads the card: larger than the feature text, still smaller than the price. */}
        <h2 className="text-xl font-semibold tracking-tight">{name}</h2>
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
        {isProAi && !isComingSoon && <span className="text-primary text-xs">✦</span>}
        {isComingSoon && (
          <span className="inline-flex items-center text-[9.5px] font-semibold uppercase tracking-wider leading-none px-1.5 pt-[0.2656rem] pb-[0.2344rem] rounded-md bg-muted text-muted-foreground self-center">
            {common('comingSoon')}
          </span>
        )}
      </div>

      {aiOptions && <AiOptionSwitch value={aiMode} onChange={setAiMode} className="mb-4" />}

      {/* Price */}
      <div className="flex items-baseline gap-1.5 mb-5">
        <span
          className={cn('font-semibold tracking-tight', highlighted ? 'text-[2.75rem]' : 'text-4xl')}
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

      {/* Feature list. With both Pro AI options, both lists (and their notes) share one grid cell
          and the one not on show is hidden from sight and from assistive tech: the card is as tall
          as the longer option, so switching never moves the button. */}
      {aiOptions ? (
        <div className="grid mb-6">
          {AI_OPTION_ORDER.map((mode) => (
            <div
              key={mode}
              className={cn('[grid-area:1/1]', mode !== aiMode && 'invisible')}
              aria-hidden={mode !== aiMode ? true : undefined}
            >
              <FeatureList features={aiOptions[mode].features} />
              <AiOptionNote mode={mode} />
            </div>
          ))}
        </div>
      ) : (
        <FeatureList features={features} className="mb-6" />
      )}

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
        ) : switchTarget || aiModeSwitchTarget ? (
          <>
            <Button
              variant="default"
              className="w-full rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={switchTarget ? handleSwitchInterval : handleSwitchAiMode}
              disabled={change.loading}
              loading={change.loading}
            >
              {switchTarget === 'yearly'
                ? t('switchToYearly')
                : switchTarget === 'monthly'
                  ? t('switchToMonthly')
                  : aiModeSwitchTarget === 'byok'
                    ? t('aiOptions.switchToByok')
                    : t('aiOptions.switchToManaged')}
            </Button>
          </>
        ) : isCurrentPlan ? null : isBelowCurrentTier ? (
          // A plan change is a price change on the *existing* subscription, not a new one:
          // handleClick sends every subscriber to /api/billing-portal, never /api/checkout.
          <Button
            variant="secondary"
            className="w-full rounded-lg"
            onClick={handleClick}
            disabled={loading || change.loading}
            loading={loading || change.loading}
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
            disabled={loading || change.loading}
            loading={loading || change.loading}
          >
            {t('upgradeTo', { name })}
          </Button>
        )}
        {/* A plan change's outcome: done (with the date for a scheduled one) or why it failed. */}
        {hasPaidPlan && (
          <p role="status" className={cn('mt-2 text-center text-[11.5px] text-text2', !change.done && 'sr-only')}>
            {change.done}
          </p>
        )}
        {change.error && (
          <p role="alert" className="mt-2 text-center text-[11.5px] text-destructive">
            {change.error}
          </p>
        )}
        {change.dialog}
      </div>
    </div>
  )
}

/** A card's feature lines: a check mark for "Everything in …", a + for what the plan adds. */
function FeatureList({ features, className }: { features: readonly TierFeature[]; className?: string }) {
  return (
    <ul className={cn('flex flex-col gap-2 text-[13.5px]', className)}>
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
    </ul>
  )
}

/**
 * What a Pro AI option's usage means: with TabMerger, what credits measure; with your own key,
 * who bills it. Deliberately no per-use dollar figures or "N organizes a month" counts for
 * prospective buyers: both read as limits to worry about rather than as what the plan includes.
 * (Subscribers see their own usage numbers on the dashboard and account page.)
 */
function AiOptionNote({ mode }: { mode: AiMode }) {
  const t = useTranslations('pricing.aiOptions')
  return (
    <p className="mt-3 text-[11.5px] leading-relaxed text-text3">
      {mode === 'managed' ? t('managedHint') : t('byokHint')}
    </p>
  )
}
