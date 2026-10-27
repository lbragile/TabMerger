import * as Sentry from '@sentry/nextjs'
import type Stripe from 'stripe'
import { classifyPlanChange, getPlanForPriceId, type PlanPrice } from './tiers'

/**
 * Something a plan change did that the refund policy (docs/PAYMENTS.md, "Refund policy") forbids,
 * spotted on a `customer.subscription.updated` event:
 *
 * - `lowered_at_once`: the subscription's price changed to one that isn't an upgrade
 *   (`classifyPlanChange()`: a downgrade or a shorter interval) while no subscription schedule was
 *   attached. A deferred change lands while its schedule (the portal's or the server's) is still
 *   on the subscription, and Stripe detaches it only in a later update; a change without one was
 *   applied at once.
 * - `credit`: the invoice this update made (`billing_reason: subscription_update`) has a negative
 *   total, or left the customer's Stripe balance more in credit than before. A plan change may
 *   only ever charge: an upgrade's proration nets the unused old time against a higher new price.
 *
 * Both rest on behaviour Stripe doesn't document for prices on different products: the Billing
 * Portal's confirm page deferring a cheaper cross-product switch (lib/planChangeTiming.ts). If
 * Stripe changes that, or a portal configuration regresses, the change applies at once and this is
 * how it shows up.
 */
export type PlanChangeAlarm =
  | { kind: 'lowered_at_once'; subscriptionId: string; from: string; to: string }
  | {
      kind: 'credit'
      subscriptionId: string
      invoiceId: string
      /** Invoice total, in the currency's minor unit (cents). */
      total: number
      /** How the customer balance moved (ending - starting), minor unit; negative = more credit. */
      balanceChange: number | null
    }

type SubscriptionUpdate = {
  object: Stripe.Subscription
  previous_attributes?: Partial<Stripe.Subscription> | null
}

const idOf = (value: string | { id: string } | null | undefined): string | undefined =>
  typeof value === 'string' ? value : value?.id

/** `pro/monthly`, `proAi/managed/yearly`: a plan without ids, prices or amounts. */
function planLabel(plan: PlanPrice): string {
  return [plan.tierKey, plan.aiMode, plan.interval].filter(Boolean).join('/')
}

/**
 * The price before the update, from `previous_attributes`: `items.data[0].price`, or the legacy
 * top-level `plan` some API versions still send. Undefined when the price didn't change.
 */
function previousPriceId(previous: Partial<Stripe.Subscription> | null | undefined): string | undefined {
  if (!previous) return undefined
  const fromItems = previous.items?.data?.[0]?.price
  const fromPlan = (previous as { plan?: { id?: unknown } | null }).plan
  return idOf(fromItems) ?? (typeof fromPlan?.id === 'string' ? fromPlan.id : undefined)
}

/**
 * The refund-policy violations one `customer.subscription.updated` event shows. Pure and never
 * throws. `update` is the event's own data (the object as it was when the event happened, which is
 * what says whether a schedule was attached); `current` is the subscription as just retrieved
 * from Stripe with `latest_invoice` expanded (null when it couldn't be read). The invoice is only
 * judged when this update is the one that set it, so a later event for the same subscription
 * doesn't raise the same alarm again.
 */
export function planChangeAlarms(
  update: SubscriptionUpdate,
  current: Stripe.Subscription | null
): PlanChangeAlarm[] {
  const alarms: PlanChangeAlarm[] = []
  const subscription = update.object
  const previous = update.previous_attributes

  const fromPriceId = previousPriceId(previous)
  const toPriceId = idOf(subscription.items?.data?.[0]?.price)
  if (fromPriceId && toPriceId && fromPriceId !== toPriceId && !subscription.schedule) {
    const from = getPlanForPriceId(fromPriceId)
    const to = getPlanForPriceId(toPriceId)
    // A price this deployment doesn't sell can't be ranked: no alarm rather than a false one.
    if (from && to && classifyPlanChange(from, to) !== 'upgrade') {
      alarms.push({ kind: 'lowered_at_once', subscriptionId: subscription.id, from: planLabel(from), to: planLabel(to) })
    }
  }

  const invoice = current?.latest_invoice
  if (
    previous &&
    Object.prototype.hasOwnProperty.call(previous, 'latest_invoice') &&
    invoice &&
    typeof invoice === 'object' &&
    invoice.id === idOf(subscription.latest_invoice) &&
    invoice.billing_reason === 'subscription_update'
  ) {
    const balanceChange =
      typeof invoice.ending_balance === 'number' && typeof invoice.starting_balance === 'number'
        ? invoice.ending_balance - invoice.starting_balance
        : null
    if (invoice.total < 0 || (balanceChange !== null && balanceChange < 0)) {
      alarms.push({
        kind: 'credit',
        subscriptionId: subscription.id,
        invoiceId: invoice.id,
        total: invoice.total,
        balanceChange,
      })
    }
  }

  return alarms
}

/**
 * Reports one alarm: a `console.error` line with a fixed prefix to search for in the function
 * logs, and the same text to Sentry as an error-level message, so it reaches a person. The text
 * holds the event type, the alarm, the subscription id, and the two plans (`pro/monthly`) or the
 * invoice id and amounts; never a customer, email, metadata or Stripe object. Sentry groups every
 * occurrence of one signal into one issue (`fingerprint: plan-change-alarm/<kind>`), whatever the
 * ids in the text. Reports only: nothing is changed at Stripe or in the database. Sentry sends in
 * the background; the webhook calls flushPlanChangeAlarms() after the response.
 */
export function logPlanChangeAlarm(eventType: string, alarm: PlanChangeAlarm): void {
  const detail =
    alarm.kind === 'lowered_at_once'
      ? `${alarm.from} -> ${alarm.to} applied with no schedule`
      : `invoice ${alarm.invoiceId} total ${alarm.total}, balance change ${alarm.balanceChange ?? 'unknown'}`
  const line = `Stripe webhook: PLAN_CHANGE_ALARM ${alarm.kind} on ${eventType} (subscription ${alarm.subscriptionId}, ${detail}). The refund policy allows no credit and no immediate downgrade; check the portal's deferral (docs/PAYMENTS.md, "Plan-change alarm").`
  console.error(line)
  Sentry.captureMessage(line, {
    level: 'error',
    fingerprint: ['plan-change-alarm', alarm.kind],
    tags: { plan_change_alarm: alarm.kind },
  })
}

/**
 * Waits (at most 2 s) for Sentry to send queued alarms. A serverless function may be frozen once
 * it has answered, so the webhook runs this in `after()`. Without a DSN it resolves at once.
 */
export async function flushPlanChangeAlarms(): Promise<void> {
  await Sentry.flush(2000)
}
