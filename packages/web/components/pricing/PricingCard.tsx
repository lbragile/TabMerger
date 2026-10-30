'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Link, useRouter as useLocaleRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import type { AiMode } from '@tabmerger/shared'
import { Button } from '@/components/ui/button'
import { TierBadge, TierFeatureIcon } from './TierBadge'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ALREADY_SUBSCRIBED_ERROR, PAY_OR_RESUME_ERROR, RATE_LIMITED_ERROR } from '@/lib/checkoutErrors'
import { CHECKOUT_TIERS, trackBeginCheckout, type CheckoutTier } from '@/lib/checkoutAnalytics'
import { isExternalStoreLink } from '@/lib/storeLinks'
import { SUPPORT_EMAIL } from '@/lib/supportInbox'
import { useListPrice, useZeroPrice } from './priceFormat'
import type { TierFeature } from './tierFeatures'
import { AiOptionSwitch } from './AiOptionSwitch'
import { AI_OPTION_ORDER, initialAiMode, isAiOptionAvailable } from './aiOptions'
import { usePlanChange } from './usePlanChange'
import { normalizeTier, planCardStatus } from './planStatus'
import type { PaidTierKey } from '@/lib/tiers'
import type { PendingPlanChangeInfo } from '@/lib/currentPlan'

/** The card's full-width CTA: wraps instead of overflowing the card when a translated label is
 *  long, and keeps the usual 40px single-line height whenever it fits. */
const CTA_CLASS = 'w-full rounded-lg h-auto min-h-10 whitespace-normal text-center'

/** One Pro AI option's prices and features, as the card shows them. */
export interface AiOptionDisplay {
  monthlyPrice: number
  yearlyPrice: number
  displayMonthly?: string
  displayYearly?: string
  yearlySubtext?: string
  features: readonly TierFeature[]
}

/** A plan change already scheduled for the end of the paid period, as the pricing page passes it. */
export interface ScheduledPlanChange {
  /** The plan it moves to; null for a price this deployment doesn't sell. */
  plan: PendingPlanChangeInfo['plan']
  /** When it takes effect, formatted on the server for the page's locale (as the account page does). */
  date: string
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
  /**
   * Whether the visitor is signed in. The page passes `currentTier="free"` to guests and free
   * accounts alike, so this is what tells them apart: a guest has nothing to upgrade from and is
   * offered "Get …" instead of "Upgrade to …". A paid `currentTier` implies a signed-in account.
   */
  signedIn?: boolean
  /**
   * A subscriber's plan change already scheduled (`getCurrentPlan({ withPendingChange })`). The
   * card it moves to says "Starts {date}"; every other change on the card is replaced by a note
   * pointing to the account page, where the change shows and can be managed: the server would
   * refuse a second change (409 `already_scheduled`).
   */
  scheduledChange?: ScheduledPlanChange | null
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
  signedIn = false,
  scheduledChange,
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
  // Current plan, downgrade and Recommended: the one rule the home page's teaser uses too.
  const { isSameTier, isCurrentPlan, isBelowCurrentTier, showRecommended } = planCardStatus({
    tier,
    currentTier,
    aiMode,
    currentAiMode,
    highlighted,
  })
  // An option that isn't on sale yet, unless it's the one this account already has.
  const isComingSoon = isProAi && !isAiOptionAvailable(aiMode) && !isCurrentPlan
  // A Pro AI subscriber looking at the other option can move to it on the same subscription.
  const aiModeSwitchTarget = isSameTier && isProAi && !isCurrentPlan ? aiMode : null
  const isFree = tier === 'free'
  // The pricing page passes a paid currentTier only while that subscription is entitled.
  const hasPaidPlan = !!currentTier && normalizeTier(currentTier) !== 'free'
  // Signed out: "Get Pro", not "Upgrade to Pro" (the click still signs in, then checks out).
  const isGuest = !signedIn && !hasPaidPlan
  // A scheduled change counts only for a subscriber. This card is its target when it shows that plan:
  // the tier, the interval on show and, for Pro AI, the option on show.
  const scheduled = hasPaidPlan ? (scheduledChange ?? null) : null
  const isScheduledTarget =
    !!scheduled?.plan &&
    scheduled.plan.tierKey === tier &&
    scheduled.plan.interval === interval &&
    (!isProAi || scheduled.plan.aiMode === aiMode)
  // A subscriber's changes (plan, interval, Pro AI option) go through one flow: our dialog only for
  // a change the server schedules itself, otherwise straight to Stripe's confirm page.
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
  // A paid current plan can move to the other billing interval (same plan, new price).
  const switchTarget =
    isCurrentPlan && !isFree && currentInterval
      ? currentInterval === 'monthly' ? 'yearly' : 'monthly'
      : null

  /** The same plan on the other interval (confirmed first only when the server schedules it itself). */
  function handleSwitchInterval() {
    if (switchTarget) change.start({ interval: switchTarget })
  }

  /** Pro AI's other setup option, same interval (confirmed first only when the server schedules it itself). */
  function handleSwitchAiMode() {
    if (aiModeSwitchTarget) change.start({ aiMode: aiModeSwitchTarget })
  }

  // Display price: use override strings if provided, otherwise format from number
  const displayPrice =
    interval === 'monthly'
      ? (displayMonthly ?? (rawPrice === 0 ? zeroPrice : listPrice(rawPrice)))
      : (displayYearly ?? (rawPrice === 0 ? zeroPrice : listPrice(rawPrice)))
  /** The small line under the price: Free's no-card note, or a yearly plan's monthly equivalent. */
  const priceNote = isFree
    ? t('noCard')
    : interval === 'yearly' && rawPrice > 0 && yearlySubtext
      ? yearlySubtext
      : null

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
    // through usePlanChange; otherwise the billing portal, where the user picks.
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

      // The server found a paid plan this page didn't know about (subscribed in another tab, or
      // a webhook the server has just caught up on from Stripe). When the account's record now
      // shows it, refreshing shows the real plan with its switch buttons; otherwise (a plan this
      // site can't show) the billing portal is where it is changed.
      if (res.status === 409 && data.error === ALREADY_SUBSCRIBED_ERROR) {
        if (data.recorded === true) {
          toast.info(t('alreadySubscribedShown'))
          router.refresh()
          return
        }
        toast.info(t('alreadySubscribed'))
        await openBillingPortal()
        return
      }

      // Too many billing requests from this account in a short time (per-user server limit).
      if (res.status === 429 && data.error === RATE_LIMITED_ERROR) {
        toast.error(t('rateLimited'))
        return
      }

      // A plan at Stripe that can still be paid or resumed: a new one would bill next to it.
      if (res.status === 409 && data.error === PAY_OR_RESUME_ERROR) {
        toast.error(t('planChange.errors.pay_or_resume', { email: SUPPORT_EMAIL }))
        return
      }

      if (typeof data.url === 'string') {
        window.location.href = data.url
        return
      }

      toast.error(t('checkoutFailed'))
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

    toast.error(res.status === 429 && data.error === RATE_LIMITED_ERROR ? t('rateLimited') : t('portalFailed', { email: SUPPORT_EMAIL }))
  }

  return (
    <div
      data-tier={tier}
      // h-full fills the stretched grid cell, so the cards in a row are equally tall and the CTA
      // (mt-auto) sits at the bottom of each. The highlighted card is roomier on the sides only:
      // equal top and bottom padding keeps the title rows and the buttons on the same lines. That
      // padding stays whoever is looking, so the card's content width never changes; the brand
      // emphasis (shadow, border) goes with Recommended only, never on a plan the visitor has or is above.
      className={cn(
        'relative flex flex-col h-full rounded-2xl p-6 border border-border bg-surface',
        highlighted && 'px-7',
        showRecommended && 'shadow-sh3 border-primary/30',
        isCurrentPlan && 'border-foreground/30'
      )}
    >
      {/* One pill on the top edge: Current wins (a current plan is never Recommended). Current is
          neutral so the brand color stays on Recommended. */}
      {isCurrentPlan ? (
        <TierBadge tone="neutral">{t('current')}</TierBadge>
      ) : showRecommended ? (
        <TierBadge>{t('recommended')}</TierBadge>
      ) : isComingSoon ? (
        <TierBadge tone="muted">{common('comingSoon')}</TierBadge>
      ) : null}
      {/* The plan name leads the card: larger than the feature text, still smaller than the price. */}
      <h2 className="mb-2.5 text-2xl font-bold tracking-tight">{name}</h2>
      {/* One price size on every card, so the prices line up across the row. */}
      <div className="flex flex-wrap items-baseline gap-x-1.5 mb-1">
        <span className="text-4xl font-semibold tracking-tight">{displayPrice}</span>
        <span className="text-[13px] text-text3">
          {rawPrice === 0 ? t('forever') : interval === 'monthly' ? t('perMonth') : t('perYear')}
        </span>
      </div>
      {/* One note line under the price on every card, kept even when empty so the feature lists
          start at the same height. */}
      <p className="mb-5 min-h-[1lh] text-[11.5px] text-text3">{priceNote}</p>

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
        {/* The Pro AI setup switch sits with the button, not near the price, so every card's
            title, price and feature list line up. */}
        {aiOptions && <AiOptionSwitch value={aiMode} onChange={setAiMode} className="mb-4" />}
        {isComingSoon ? (
          <Button
            variant="outline"
            className={cn(CTA_CLASS, 'cursor-not-allowed opacity-60')}
            disabled
            aria-disabled="true"
          >
            {common('comingSoon')}
          </Button>
        ) : isFree ? (
          <Button
            variant="outline"
            className={CTA_CLASS}
            onClick={handleClick}
          >
            {t('installFree')}
          </Button>
        ) : scheduled && isScheduledTarget ? (
          // The plan the scheduled change moves to: when it starts, in place of a button, at a
          // button's height so the cards' bottom blocks stay lined up (like the current plan's).
          <p data-testid="cta-scheduled" className="min-h-10 flex items-center justify-center text-center text-sm font-medium text-text2">
            {t('scheduledChange.starts', { date: scheduled.date })}
          </p>
        ) : scheduled && !(isCurrentPlan && !switchTarget) ? (
          // Any other change while one is scheduled: the server would refuse it, so the card says
          // why and where to manage the scheduled one instead of offering a button.
          <p data-testid="cta-scheduled-note" className="min-h-10 text-center text-[11.5px] text-text2">
            {t.rich('scheduledChange.note', {
              date: scheduled.date,
              link: (chunks) => (
                <Link href="/account" className="text-primary underline underline-offset-2">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        ) : switchTarget || aiModeSwitchTarget ? (
          <>
            <Button
              variant="default"
              className={cn(CTA_CLASS, 'bg-primary text-primary-foreground hover:bg-primary/90')}
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
        ) : isCurrentPlan ? (
          // No button on the current plan (the badge says Current), but the row keeps a single-line
          // button's height, so this card's bottom block (and Pro AI's setup switch above it) lines
          // up with the neighbours' buttons instead of dropping to the bottom with dead space below.
          <div aria-hidden="true" data-testid="cta-placeholder" className="min-h-10" />
        ) : isBelowCurrentTier ? (
          // A plan change is a price change on the *existing* subscription, not a new one:
          // handleClick sends every subscriber to /api/billing-portal, never /api/checkout.
          <Button
            variant="secondary"
            className={CTA_CLASS}
            onClick={handleClick}
            disabled={loading || change.loading}
            loading={loading || change.loading}
          >
            {t('downgradeTo', { name })}
          </Button>
        ) : (
          <Button
            className={cn(
              CTA_CLASS,
              highlighted && 'bg-primary text-primary-foreground hover:bg-primary/90'
            )}
            variant={highlighted ? 'default' : 'secondary'}
            onClick={handleClick}
            disabled={loading || change.loading}
            loading={loading || change.loading}
          >
            {isGuest ? t('getPlan', { name }) : t('upgradeTo', { name })}
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
        <li key={feature.text} className="flex items-start gap-2 text-text2">
          <TierFeatureIcon inherited={feature.inherited} />
          <span className="text-balance">{feature.text}</span>
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
    <p className="mt-3 text-pretty text-[11.5px] leading-relaxed text-text3">
      {mode === 'managed' ? t('managedHint') : t('byokHint')}
    </p>
  )
}
