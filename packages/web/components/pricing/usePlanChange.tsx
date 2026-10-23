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

/** Which confirmation a change needs before the server acts on it. */
type Confirmation = 'endOfPeriod' | 'chargeNow'

interface PendingChange {
  target: PlanChangeTarget
  confirmation: Confirmation
  plan: string
}

/**
 * Starts a plan change on the existing subscription and walks the user through it.
 *
 * `/api/billing/switch-plan` (and `switch-interval`) act on the POST itself for most changes, so
 * the user confirms first, with what will happen as the server will do it (`planChangeTiming()`
 * in lib/planChangeTiming.ts, the rule `createPlanSwitchSession()` follows):
 * - a downgrade or a shorter interval takes effect at the end of the period, with no refund;
 * - an upgrade that involves the own-key option ("You" handle setup) is applied now and charged,
 *   prorated (the Billing Portal can't list own-key prices);
 * - any other upgrade goes straight to the Billing Portal, which has its own confirmation page.
 *
 * Afterwards it reports the result (the date for a scheduled change), refreshes the page's server
 * data, or follows the URL the server returned (the portal, or an invoice that needs paying).
 * A 401 goes to sign-in and back to `returnPath`; a 409 shows the server's explanation; a 503
 * `ai_disabled` says the option isn't available.
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
   * The plan a change ends on, all fields filled in. When the current interval is unknown (a
   * price this deployment doesn't list) and the change keeps it, both sides use the same stand-in
   * interval, which only the interval comparison reads; a change of interval then can't be
   * classified and returns null.
   */
  function resolve(target: PlanChangeTarget) {
    if (!current) return null
    if (!current.interval && target.interval) return null
    const interval = target.interval ?? current.interval ?? 'monthly'
    const tierKey = target.tier ?? current.tierKey
    const aiMode =
      tierKey === 'proAi'
        ? (target.aiMode ?? (current.tierKey === 'proAi' ? (current.aiMode ?? 'managed') : 'managed'))
        : null
    return { tierKey, interval, aiMode, from: currentPoint(current.interval ?? interval) }
  }

  /** "Pro AI with you handling setup, billed yearly" (no interval when it isn't known). */
  function planLabel(plan: NonNullable<ReturnType<typeof resolve>>) {
    const name =
      plan.tierKey === 'pro' ? t('plans.pro') : plan.aiMode === 'byok' ? t('plans.proAiByok') : t('plans.proAiManaged')
    if (!current?.interval) return name
    return plan.interval === 'yearly' ? t('billedYearly', { plan: name }) : t('billedMonthly', { plan: name })
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
      if (ok && data.applied === 'now') {
        // `url` is the account page, or an invoice to pay when the charge needs the customer.
        if (typeof data.url === 'string' && !isAccountPage(data.url)) {
          window.location.href = data.url
          return
        }
        setDone(plan ? t('appliedNow', { plan }) : t('appliedNowNoDetails'))
        router.refresh()
        return
      }
      if (ok && typeof data.url === 'string') {
        // The Billing Portal's own confirmation page.
        window.location.href = data.url
        return
      }
      if (res.status === 503 && data.error === AI_ERROR_CODES.disabled) setError(t('aiDisabled'))
      else if (res.status === 409 && typeof data.error === 'string') setError(data.error)
      else setError(pricing('switchFailed'))
    } catch {
      setError(pricing('switchFailed'))
    } finally {
      setLoading(false)
      setPending(null)
    }
  }

  /** Asks for confirmation when the server will act on the request, else sends it straight away. */
  function start(target: PlanChangeTarget) {
    setError(null)
    setDone(null)
    const to = resolve(target)
    if (!to?.from) {
      void send(target, null)
      return
    }
    const timing = planChangeTiming(to.from, to)
    const confirmation: Confirmation | null =
      timing === 'end_of_period' || timing === 'portal_end_of_period'
        ? 'endOfPeriod'
        : timing === 'now'
          ? 'chargeNow'
          : null
    if (!confirmation) {
      void send(target, planLabel(to))
      return
    }
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setPending({ target, confirmation, plan: planLabel(to) })
  }

  const description = !pending
    ? ''
    : pending.confirmation === 'chargeNow'
      ? t('confirmChargeNow', { plan: pending.plan })
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

/** Whether a URL the server returned is the account page (any locale prefix), not a page to follow. */
function isAccountPage(url: string): boolean {
  try {
    return /(^|\/)account\/?$/.test(new URL(url, 'http://localhost').pathname)
  } catch {
    return false
  }
}
