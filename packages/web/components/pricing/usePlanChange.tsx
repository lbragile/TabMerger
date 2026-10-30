'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { AI_ERROR_CODES, type AiMode } from '@tabmerger/shared'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { planChangeTiming } from '@/lib/planChangeTiming'
import {
  ALREADY_SUBSCRIBED_ERROR,
  PAY_OR_RESUME_ERROR,
  PLAN_SWITCH_ERROR_CODES,
  parsePlanSwitchCheckoutTarget,
  type PlanSwitchCheckoutTarget,
  type PlanSwitchErrorCode,
} from '@/lib/checkoutErrors'
import { trackBeginCheckout } from '@/lib/checkoutAnalytics'
import { SUPPORT_EMAIL } from '@/lib/supportInbox'
import type { BillingInterval, PaidTierKey } from '@/lib/tiers'

/** The billing routes that move a paid subscription to another price. */
export const PLAN_SWITCH_PATHS = {
  /** Interval only (monthly ↔ yearly), same plan and option. */
  interval: '/api/billing/switch-interval',
  /** Any of plan, interval and Pro AI option. */
  plan: '/api/billing/switch-plan',
} as const

/** The subscription a change starts from. `interval` is unknown for a price this deployment doesn't sell. */
export interface CurrentPlan {
  tierKey: PaidTierKey
  interval?: BillingInterval
  /** Pro AI's option; ignored for Pro. */
  aiMode?: AiMode | null
  /** `subscriptions.current_period_end`: when a scheduled change takes effect. */
  periodEnd?: string | null
}

/** What to change; a field left out keeps the current value. */
export interface PlanChangeTarget {
  tier?: PaidTierKey
  interval?: BillingInterval
  aiMode?: AiMode
}

interface PendingChange {
  target: PlanChangeTarget
  plan: string
}

/**
 * The support address some error messages offer (`{email}`): for a plan with no billing account, or
 * a payment to settle, Manage billing isn't on the account page, so support is the way forward.
 */
const SUPPORT = { email: SUPPORT_EMAIL }

const PLAN_SWITCH_ERROR_CODE_VALUES: readonly string[] = Object.values(PLAN_SWITCH_ERROR_CODES)

function isPlanSwitchErrorCode(value: unknown): value is PlanSwitchErrorCode {
  return typeof value === 'string' && PLAN_SWITCH_ERROR_CODE_VALUES.includes(value)
}

/**
 * Starts a plan change on the existing subscription and walks the user through it.
 *
 * Which step confirms the change follows `planChangeTiming()` (lib/planChangeTiming.ts, the rule
 * `createPlanSwitchSession()` follows), so what the user is told is what the server does:
 * - `end_of_period` (the interval shortens together with another change, e.g. Pro yearly → Pro AI
 *   monthly): `/api/billing/switch-plan` schedules it on the POST itself and no Stripe page
 *   follows, so this hook's dialog confirms it first ("changes on {date}", no refund or credit);
 * - `portal_end_of_period` (a downgrade or a shorter interval the portal defers, TabMerger → own
 *   key on Pro AI included) and `portal` (an upgrade, own key → TabMerger included): the POST only
 *   makes a Billing Portal session, and Stripe's own confirm page is the confirmation step (it
 *   shows "Updates on {date}" for a deferred change, the amount and the card for an upgrade,
 *   charged now, prorated), so the request goes straight away with no dialog here.
 *
 * Afterwards it reports the result (the date for a scheduled change) and refreshes the page's
 * server data, or follows the portal URL the server returned. A 401 goes to sign-in and back to
 * `returnPath`; a 503 `ai_disabled` says the option isn't available; any other error with a known
 * `code` (PLAN_SWITCH_ERROR_CODES) gets its own message, and the rest the generic one.
 *
 * A 403 `no_paid_plan` that carries `checkout` means the server found the plan had already ended at
 * Stripe and corrected the account (a missed webhook): the user goes straight to a checkout for the
 * plan they picked instead of a dead end (`subscribeInstead()`).
 *
 * Returns `start(target)`, the state for the caller to show (`error` in a `role="alert"`,
 * `done` in a `role="status"`) and `dialog`, the confirmation, to render once.
 */
export function usePlanChange(current: CurrentPlan | null, returnPath: string) {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('pricing.planChange')
  const pricing = useTranslations('pricing')
  const [pending, setPending] = useState<PendingChange | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  /** What had focus when the dialog opened: Radix only restores focus to a DialogTrigger. */
  const openerRef = useRef<HTMLElement | null>(null)

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { month: 'long', day: 'numeric', year: 'numeric' })

  /** The current plan as the timing rule reads it; Pro has no AI option. */
  function currentPoint(interval: BillingInterval) {
    if (!current) return null
    return { tierKey: current.tierKey, interval, aiMode: current.tierKey === 'proAi' ? (current.aiMode ?? 'managed') : null }
  }

  /**
   * The plan a change ends on, all fields filled in, and `from`, the current plan. When the current
   * interval is unknown (a price this deployment doesn't list), `from` is null, as the server's
   * `getPlanForPriceId()` makes it, so `planChangeTiming()` gives `end_of_period` here too: the
   * server schedules such a change on the POST itself. A change that keeps the unknown interval
   * then fills in a stand-in interval, which the label leaves out.
   */
  function resolve(target: PlanChangeTarget) {
    if (!current) return null
    const interval = target.interval ?? current.interval ?? 'monthly'
    const tierKey = target.tier ?? current.tierKey
    const aiMode =
      tierKey === 'proAi'
        ? (target.aiMode ?? (current.tierKey === 'proAi' ? (current.aiMode ?? 'managed') : 'managed'))
        : null
    const intervalKnown = !!(target.interval ?? current.interval)
    return { tierKey, interval, aiMode, intervalKnown, from: current.interval ? currentPoint(current.interval) : null }
  }

  /** "Pro AI with you handling setup, billed yearly" (no interval when it isn't known). */
  function planLabel(plan: NonNullable<ReturnType<typeof resolve>>) {
    const name =
      plan.tierKey === 'pro' ? t('plans.pro') : plan.aiMode === 'byok' ? t('plans.proAiByok') : t('plans.proAiManaged')
    if (!plan.intervalKnown) return name
    return plan.interval === 'yearly' ? t('billedYearly', { plan: name }) : t('billedMonthly', { plan: name })
  }

  /**
   * Starts a checkout for `target` after the server found the current plan had ended at Stripe and
   * corrected the account. `/api/checkout` checks the account again, so this only works once the
   * server agrees there is no live plan. If it can't start, the page's data is refreshed (the plan
   * shown as current is gone, or the plan Stripe has was just recorded) and a message says why:
   * a live plan was found, one can still be paid or resumed, the check failed, or else "no paid
   * plan" (choose a plan).
   */
  async function subscribeInstead(target: PlanSwitchCheckoutTarget) {
    trackBeginCheckout({ ...target, source: 'plan_change', component: 'plan_switch_recovery' })
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(target),
    })
    if (res.status === 401) {
      router.push(`/auth/sign-in?redirectTo=${returnPath}`)
      return
    }
    const data = await res.json().catch(() => ({}))
    if (res.ok && typeof data.url === 'string') {
      window.location.href = data.url
      return
    }
    if (res.status === 503 && data.error === AI_ERROR_CODES.disabled) setError(t('aiDisabled'))
    // A live plan at Stripe after all: shown after the refresh when the server recorded it,
    // otherwise changed in Manage billing.
    else if (res.status === 409 && data.error === ALREADY_SUBSCRIBED_ERROR) {
      setError(data.recorded === true ? pricing('alreadySubscribedShown') : pricing('switchFailed', SUPPORT))
    }
    else if (res.status === 409 && data.error === PAY_OR_RESUME_ERROR) setError(t('errors.pay_or_resume', SUPPORT))
    else if (res.status === 429 && data.error === PLAN_SWITCH_ERROR_CODES.rateLimited) setError(t('errors.rate_limited'))
    else if (res.status >= 500) setError(pricing('checkoutFailed'))
    else setError(t(`errors.${PLAN_SWITCH_ERROR_CODES.noPaidPlan}`))
    router.refresh()
  }

  async function send(target: PlanChangeTarget, plan: string | null) {
    setLoading(true)
    setError(null)
    setDone(null)
    const intervalOnly = target.tier === undefined && target.aiMode === undefined
    try {
      const res = await fetch(intervalOnly ? PLAN_SWITCH_PATHS.interval : PLAN_SWITCH_PATHS.plan, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(target),
      })
      if (res.status === 401) {
        router.push(`/auth/sign-in?redirectTo=${returnPath}`)
        return
      }
      const data = await res.json().catch(() => ({}))
      const ok = res.status >= 200 && res.status < 300
      if (ok && data.applied === 'end_of_period') {
        setDone(
          plan && typeof data.effectiveAt === 'string'
            ? t('scheduled', { plan, date: formatDate(data.effectiveAt) })
            : t('scheduledNoDetails')
        )
        router.refresh()
        return
      }
      if (ok && typeof data.url === 'string') {
        // The Billing Portal's own confirmation page.
        window.location.href = data.url
        return
      }
      const code: unknown = data.code
      const checkout = code === PLAN_SWITCH_ERROR_CODES.noPaidPlan ? parsePlanSwitchCheckoutTarget(data.checkout) : null
      if (checkout) {
        await subscribeInstead(checkout)
        return
      }
      if (res.status === 503 && data.error === AI_ERROR_CODES.disabled) setError(t('aiDisabled'))
      else if (isPlanSwitchErrorCode(code)) setError(t(`errors.${code}`, SUPPORT))
      // A 409 without a code we know still carries a message written for the user.
      else if (res.status === 409 && typeof data.error === 'string') setError(data.error)
      else setError(pricing('switchFailed', SUPPORT))
    } catch {
      setError(pricing('switchFailed', SUPPORT))
    } finally {
      setLoading(false)
      setPending(null)
    }
  }

  /**
   * Asks for confirmation when the server will schedule the change on the request itself
   * (`end_of_period`), else sends it straight away: a portal change is confirmed on Stripe's page.
   */
  function start(target: PlanChangeTarget) {
    setError(null)
    setDone(null)
    const to = resolve(target)
    if (!to) {
      void send(target, null)
      return
    }
    if (planChangeTiming(to.from, to) !== 'end_of_period') {
      void send(target, planLabel(to))
      return
    }
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setPending({ target, plan: planLabel(to) })
  }

  const description = !pending
    ? ''
    : current?.periodEnd
      ? t('confirmEndOfPeriod', { plan: pending.plan, date: formatDate(current.periodEnd) })
      : t('confirmEndOfPeriodNoDate', { plan: pending.plan })

  const dialog = (
    <Dialog open={!!pending} onOpenChange={(open) => !open && !loading && setPending(null)}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          openerRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setPending(null)} disabled={loading}>
            {t('cancel')}
          </Button>
          <Button
            size="sm"
            onClick={() => pending && void send(pending.target, pending.plan)}
            loading={loading}
            disabled={loading}
          >
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { start, loading, error, done, dialog }
}

