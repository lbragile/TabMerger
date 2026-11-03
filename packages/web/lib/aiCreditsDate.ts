import type { AiCreditsNextPeriod } from '@tabmerger/shared'
import { getPendingPlanChange, type PendingPlanChange } from '@/lib/stripe'
import { getPlanForPriceId } from '@/lib/tiers'

/** How long the dashboard waits for Stripe's scheduled change before showing the date without it. */
export const SCHEDULED_CHANGE_TIMEOUT_MS = 3000

/**
 * A scheduled plan change (`getPendingPlanChange()`) as `managedAiCreditsDate()` reads it: when it
 * takes effect and the plan it moves to (tier null for a price this deployment doesn't sell).
 */
export function scheduledChangeOf(pending: PendingPlanChange | null | undefined): AiCreditsNextPeriod['scheduledChange'] {
  if (!pending) return null
  const plan = getPlanForPriceId(pending.priceId)
  return { effectiveAt: new Date(pending.effectiveAt * 1000), tier: plan?.tier ?? null, aiMode: plan?.aiMode ?? null }
}

/**
 * The dashboard's read of the scheduled change, for "Credits end on" vs "reset on": the account
 * page's `getPendingPlanChange()` call, but never fatal. A missing billing account, a failed read
 * or one slower than {@link SCHEDULED_CHANGE_TIMEOUT_MS} gives null, and the line then falls back
 * to the stored row (`cancel_at_period_end` only). Callers only make it when the date shows.
 */
export async function readScheduledChange({
  customerId,
  subscriptionId,
}: {
  customerId: string | null | undefined
  subscriptionId: string | null | undefined
}): Promise<AiCreditsNextPeriod['scheduledChange']> {
  if (!customerId || !subscriptionId) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const pending = await Promise.race([
      getPendingPlanChange({ customerId, subscriptionId }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), SCHEDULED_CHANGE_TIMEOUT_MS)
      }),
    ])
    return scheduledChangeOf(pending)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
