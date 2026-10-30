/**
 * Default answers for the abuse-limit RPCs every `/api/ai/*` route calls (`lib/ai-request-limits.ts`):
 * rate limits (taken or peeked) allow, a concurrency slot is granted and released, credits are not exhausted.
 * Route tests whose Supabase stub has an `rpc` mock call this first and fall through to their own
 * RPCs (the credit reservation and settlement) when it returns `undefined`.
 */
export const TEST_SLOT_ID = 'slot-0001'

/** The RPCs this helper answers. */
export const AI_LIMIT_RPCS = ['rate_limit_take', 'rate_limit_peek', 'ai_slot_acquire', 'ai_slot_release', 'ai_credits_exhausted'] as const

export function aiLimitRpc(fn: string): { data: unknown; error: null } | undefined {
  switch (fn) {
    case 'rate_limit_take':
    case 'rate_limit_peek':
      return { data: [{ allowed: true, retry_after_seconds: 0 }], error: null }
    case 'ai_slot_acquire':
      return { data: TEST_SLOT_ID, error: null }
    case 'ai_slot_release':
      return { data: true, error: null }
    case 'ai_credits_exhausted':
      return { data: false, error: null }
    default:
      return undefined
  }
}

/** The calls of an `rpc` mock other than the abuse-limit RPCs (the credit reservation and settlement). */
export function meterRpcCalls(rpc: { mock: { calls: unknown[][] } }): unknown[][] {
  return rpc.mock.calls.filter(([fn]) => !(AI_LIMIT_RPCS as readonly unknown[]).includes(fn))
}
