import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { RATE_LIMITED_ERROR } from '@/lib/checkoutErrors'

/**
 * A per-key request rate limit shared by every server instance (Vercel runs many, so a counter in
 * one instance's memory limits nothing). The counters live in Postgres and are taken atomically by
 * `public.rate_limit_take()` (supabase/migrations/025_rate_limits.sql), called with the service role.
 *
 * Nothing here depends on how the caller authenticated: a route passes a bucket (its own name and
 * limits) and a key (a user id, a client IP, ...). Windows are fixed and aligned to the Unix
 * epoch, so a burst across a boundary can reach up to twice a limit; that is fine for limits
 * meant to stop runaway clients and scripted abuse, not to meter exactly.
 */

/** At most `max` hits in each fixed window of `windowSeconds` (1 to 86 400). */
export interface RateLimitWindow {
  windowSeconds: number
  max: number
}

/**
 * A named set of limits. A key is counted against all of them at once: a hit is allowed (and
 * counted in every window) only when each still has room; a refused hit counts nowhere.
 */
export interface RateLimitBucket {
  /** 1-64 of `[a-z0-9_:-]`; separates these counters from every other bucket's. */
  name: string
  /** 1 to 5 limits. */
  limits: readonly RateLimitWindow[]
  /**
   * What a failed limiter (the database call erred or returned nothing) means. `'allow'` (fail
   * open): the request goes ahead and the failure is logged, for routes where refusing a real
   * user costs more than an unlimited minute. `'deny'` (fail closed): the result is
   * `unavailable`, for routes where every unlimited call costs money.
   */
  onError: 'allow' | 'deny'
}

export type RateLimitResult =
  | { kind: 'allowed' }
  | { kind: 'limited'; retryAfterSeconds: number }
  /** Only for a bucket with `onError: 'deny'`: the limiter failed, so the request is refused. */
  | { kind: 'unavailable' }

/**
 * Counts one hit for `key` in `bucket`. `client` is a service-role Supabase client (one is created
 * when none is given). Never throws: a limiter failure is logged (bucket name and the database
 * error's code only, never the key) and answered per `bucket.onError`.
 */
export async function takeRateLimit(
  bucket: RateLimitBucket,
  key: string,
  client?: SupabaseClient
): Promise<RateLimitResult> {
  const failed = (why: string): RateLimitResult => {
    console.error(`Rate limit (${bucket.name}): ${why}; ${bucket.onError === 'allow' ? 'allowing' : 'refusing'} the request`)
    return bucket.onError === 'allow' ? { kind: 'allowed' } : { kind: 'unavailable' }
  }

  try {
    const supabase = client ?? (await createServiceRoleClient())
    const { data, error } = await supabase.rpc('rate_limit_take', {
      p_bucket: bucket.name,
      p_key: key,
      p_windows: bucket.limits.map((l) => l.windowSeconds),
      p_maxes: bucket.limits.map((l) => l.max),
    })
    if (error) return failed(`rate_limit_take failed (code ${typeof error.code === 'string' ? error.code : 'unknown'})`)

    // A set-returning function comes back as an array of rows.
    const row = (Array.isArray(data) ? data[0] : data) as
      | { allowed?: unknown; retry_after_seconds?: unknown }
      | null
      | undefined
    if (!row || typeof row.allowed !== 'boolean') return failed('rate_limit_take returned no row')
    if (row.allowed) return { kind: 'allowed' }
    const wait = Number(row.retry_after_seconds)
    return { kind: 'limited', retryAfterSeconds: Number.isFinite(wait) && wait >= 1 ? Math.ceil(wait) : 1 }
  } catch {
    return failed('rate_limit_take threw')
  }
}

/**
 * 429 `rate_limited` with a `Retry-After` header (seconds). The code is in both `error` and
 * `code`, so clients reading either shape (checkout reads `error`, the billing routes `code`) see it.
 */
export function rateLimitedResponse(retryAfterSeconds: number): NextResponse {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds))
  return NextResponse.json(
    { error: RATE_LIMITED_ERROR, code: RATE_LIMITED_ERROR, retryAfterSeconds: seconds },
    { status: 429, headers: { 'Retry-After': String(seconds) } }
  )
}
