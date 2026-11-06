'use client'

import { useEffect, useState } from 'react'
import { isAiMode } from '@tabmerger/shared'
import { createClient } from '@/lib/supabase/client'
// Types only: lib/currentPlan.ts is server code (session cookie, Stripe).
import type { CurrentPlan, PendingPlanChangeInfo } from '@/lib/currentPlan'

/** A signed-out visitor (the same value as `GUEST_PLAN` in lib/currentPlan.ts). */
export const GUEST_VISITOR_PLAN: CurrentPlan = { signedIn: false, tier: 'free', periodEnd: null }
const GUEST_PLAN = GUEST_VISITOR_PLAN

const TIERS = new Set(['free', 'pro', 'pro_ai'])
const INTERVALS = new Set(['monthly', 'yearly'])
const PAID_TIER_KEYS = new Set(['pro', 'proAi'])

const isString = (value: unknown): value is string => typeof value === 'string'

/** A scheduled change from the response, or null when it is missing or malformed. */
function parsePendingChange(value: unknown): PendingPlanChangeInfo | null {
  if (!value || typeof value !== 'object') return null
  const { plan, effectiveAt } = value as Record<string, unknown>
  if (!isString(effectiveAt) || Number.isNaN(Date.parse(effectiveAt))) return null
  if (plan === null) return { plan: null, effectiveAt }
  if (!plan || typeof plan !== 'object') return null
  const { tierKey, interval, aiMode } = plan as Record<string, unknown>
  if (!isString(tierKey) || !PAID_TIER_KEYS.has(tierKey) || !isString(interval) || !INTERVALS.has(interval)) return null
  return {
    plan: {
      tierKey: tierKey as 'pro' | 'proAi',
      interval: interval as 'monthly' | 'yearly',
      aiMode: isAiMode(aiMode) ? aiMode : null,
    },
    effectiveAt,
  }
}

/**
 * `GET /api/plan`'s body as a `CurrentPlan`, or the guest plan when it isn't one. Only the known
 * fields with the expected types are kept: the listing never renders anything else from it.
 */
export function parseVisitorPlan(body: unknown): CurrentPlan {
  if (!body || typeof body !== 'object') return GUEST_PLAN
  const raw = body as Record<string, unknown>
  if (raw.signedIn !== true || !isString(raw.tier) || !TIERS.has(raw.tier)) return GUEST_PLAN
  const plan: CurrentPlan = {
    signedIn: true,
    tier: raw.tier as CurrentPlan['tier'],
    periodEnd: isString(raw.periodEnd) ? raw.periodEnd : null,
  }
  if (isString(raw.interval) && INTERVALS.has(raw.interval)) plan.interval = raw.interval as 'monthly' | 'yearly'
  if (isAiMode(raw.aiMode)) plan.aiMode = raw.aiMode
  if (raw.setToEnd === true) plan.setToEnd = true
  if ('pendingChange' in raw) plan.pendingChange = parsePendingChange(raw.pendingChange)
  return plan
}

/**
 * The visitor's plan for a plan listing rendered ahead of time (pricing page, home teaser):
 * undefined until known. Without a session in the browser it is the guest plan at once, with no
 * request; with one, `GET /api/plan` reads it on the server (`pendingChange` also asks for a plan
 * change scheduled at Stripe). Any failure, or no answer within {@link PLAN_LOOKUP_TIMEOUT_MS},
 * shows the guest listing. Display only: the billing routes check the plan themselves.
 */
/**
 * Longest the plan lookup may take before the listing gives up and shows the guest buttons (a
 * stalled network would otherwise leave the skeletons up for good).
 */
export const PLAN_LOOKUP_TIMEOUT_MS = 8000

export function useVisitorPlan({ withPendingChange = false }: { withPendingChange?: boolean } = {}): CurrentPlan | undefined {
  const [plan, setPlan] = useState<CurrentPlan | undefined>(undefined)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const settle = (value: CurrentPlan) => {
      if (!active) return
      active = false
      clearTimeout(timer)
      setPlan(value)
    }
    const timer = setTimeout(() => {
      controller.abort()
      settle(GUEST_PLAN)
    }, PLAN_LOOKUP_TIMEOUT_MS)
    ;(async () => {
      try {
        const {
          data: { session },
        } = await createClient().auth.getSession()
        if (!session) return settle(GUEST_PLAN)
        const res = await fetch(withPendingChange ? '/api/plan?pendingChange=1' : '/api/plan', {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        })
        settle(res.ok ? parseVisitorPlan(await res.json()) : GUEST_PLAN)
      } catch {
        settle(GUEST_PLAN)
      }
    })()
    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [withPendingChange])

  return plan
}
