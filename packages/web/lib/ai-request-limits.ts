import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'
import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { AI_ERROR_CODES } from '@tabmerger/shared'
import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  rateLimitedResponse,
  takeRateLimit,
  type RateLimitBucket,
  type RateLimitResult,
} from '@/lib/rateLimit'

/**
 * Abuse limits for the `/api/ai/*` routes, all shared by every server instance (Postgres):
 *
 * - {@link AI_IP_RATE_LIMIT} per client IP, before auth, so an unauthenticated flood is cut
 *   before it costs an `auth.getUser` each.
 * - {@link AI_USER_RATE_LIMIT} per user after auth (and {@link AI_BYOK_VERIFY_RATE_LIMIT} for the
 *   own-key check), so one account can't use up the managed key's rate limits for everyone.
 * - {@link AI_BYOK_KEY_FAILURE_LIMIT}: own-key requests that ended in a rejected or unfunded key,
 *   per user, checked (without counting) before any provider call, so an account can't use the
 *   routes to sort stolen keys into bad, unfunded and working.
 * - {@link AI_MAX_CONCURRENT_REQUESTS} requests in flight per user (`ai_slot_acquire`, migration
 *   028), leased so a killed request frees its slot when the lease ends.
 * - {@link managedCreditsExhausted}: a read that says a managed user's credits are certainly used
 *   up, so the route refuses before it spends a `count_tokens` call.
 *
 * Every limiter fails closed (a database failure answers 503 `ai_overloaded`): each unlimited
 * call can cost money. The credit pre-check is the exception: it only saves a `count_tokens`
 * call, the reservation stays the authority, so a failed pre-check lets the request go on.
 */

/**
 * Per client IP, every AI route: 120 a minute, 1,500 an hour. Four times the per-user limits, so
 * a household or office behind one address isn't refused, while a single-address flood is cut to
 * 2 requests a second before auth. An IPv6 client is keyed by its /64 (see {@link ipRateLimitKey}).
 */
export const AI_IP_RATE_LIMIT: RateLimitBucket = {
  name: 'ai-ip',
  limits: [
    { windowSeconds: 60, max: 120 },
    { windowSeconds: 3600, max: 1500 },
  ],
  onError: 'deny',
}

/**
 * Per user, every AI route except the own-key check: 30 a minute, 300 an hour, 1,500 a day. The
 * busiest real use is hover summaries (one per tab hovered for 400 ms, cached per URL for the
 * popup session), so a quick scan of 30 tabs fits in a minute; group, name, describe and
 * organize are clicks that each take seconds. 300 an hour is a sustained 5 a minute, well above
 * real use; the daily cap bounds a script that stays just under the hourly one.
 */
export const AI_USER_RATE_LIMIT: RateLimitBucket = {
  name: 'ai-user',
  limits: [
    { windowSeconds: 60, max: 30 },
    { windowSeconds: 3600, max: 300 },
    { windowSeconds: 86400, max: 1500 },
  ],
  onError: 'deny',
}

/**
 * Per user, `/api/ai/byok/verify` only: 5 a minute, 20 an hour, 50 a day. A person saves a key a
 * few times at most (a typo, a new key); anything more is someone testing keys through us.
 */
export const AI_BYOK_VERIFY_RATE_LIMIT: RateLimitBucket = {
  name: 'ai-byok-verify',
  limits: [
    { windowSeconds: 60, max: 5 },
    { windowSeconds: 3600, max: 20 },
    { windowSeconds: 86400, max: 50 },
  ],
  onError: 'deny',
}

/**
 * Own-key requests (`byok/verify` and every model route) that ended in `byok_key_invalid` or
 * `byok_billing`, per user: 5 an hour, 10 a day. Someone setting up a key mistypes it, pastes the
 * wrong one or forgets to add billing a few times, then fixes it; 10 a day leaves room for that.
 * Each failure tells the caller whether a key is bad or unfunded, so the cap is also how many keys
 * one account can sort per day. Peeked (not counted) before the provider call, counted after a
 * failure.
 */
export const AI_BYOK_KEY_FAILURE_LIMIT: RateLimitBucket = {
  name: 'ai-byok-key-failure',
  limits: [
    { windowSeconds: 3600, max: 5 },
    { windowSeconds: 86400, max: 10 },
  ],
  onError: 'deny',
}

/** The own-key outcomes {@link AI_BYOK_KEY_FAILURE_LIMIT} counts. */
export const AI_BYOK_KEY_FAILURE_CODES: ReadonlySet<string> = new Set([
  AI_ERROR_CODES.byokKeyInvalid,
  AI_ERROR_CODES.byokBilling,
])

/**
 * AI requests one user may have running at once. Room for a long organize or auto-group, the
 * background session suggestion and two overlapping hover summaries; a fifth waits.
 */
export const AI_MAX_CONCURRENT_REQUESTS = 4

/** Seconds a refused request is told to wait when all its slots are taken. */
export const AI_SLOT_RETRY_AFTER_SECONDS = 2

/** A lease outlives the route's `maxDuration` by this much, so a running request never loses it. */
export const AI_SLOT_LEASE_MARGIN_SECONDS = 30

/**
 * Time kept back from `maxDuration` for the work after the model call (settle, release, the
 * response): the model call's deadline is `start + maxDuration - this`.
 */
export const AI_DEADLINE_MARGIN_MS = 20_000

/** 503 `ai_overloaded`: a limiter could not be checked, so the request is refused (fail closed). */
export function limiterUnavailableResponse(): NextResponse {
  return NextResponse.json({ error: AI_ERROR_CODES.overloaded }, { status: 503 })
}

// --- Client IP ------------------------------------------------------------------------------

/** The 8 groups of an IPv6 address (already validated by `isIP`), or null. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase()
  // An embedded IPv4 tail (::ffff:192.0.2.1) becomes its two groups.
  const lastColon = text.lastIndexOf(':')
  const tail = text.slice(lastColon + 1)
  if (tail.includes('.')) {
    const o = tail.split('.').map(Number)
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
    text = `${text.slice(0, lastColon + 1)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null
  const groups = rest === null ? head : [...head, ...Array<string>(8 - head.length - rest.length).fill('0'), ...rest]
  if (groups.length !== 8) return null
  const values = groups.map((g) => Number.parseInt(g, 16))
  return values.every((v) => Number.isInteger(v) && v >= 0 && v <= 0xffff) ? values : null
}

/**
 * The rate-limit key for an address: `4:<address>` for IPv4 (and IPv4-mapped IPv6), `6:<first
 * four groups>::/64` for IPv6. One IPv6 host usually holds a whole /64, so a key per address
 * would let it rotate addresses past the limit (and add a counter row per address). Null for
 * anything that is not an IP address.
 */
export function ipRateLimitKey(raw: string): string | null {
  let address = raw.trim()
  if (address.startsWith('[') && address.endsWith(']')) address = address.slice(1, -1)
  const zone = address.indexOf('%')
  if (zone !== -1) address = address.slice(0, zone)

  const family = isIP(address)
  if (family === 4) return `4:${address}`
  if (family !== 6) return null

  const groups = ipv6Groups(address)
  if (!groups) return null
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff
  if (mapped) return `4:${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`
  return `6:${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}::/64`
}

/**
 * The stored form of an IP key: `ip:` + HMAC-SHA256 of the normalised key ({@link ipRateLimitKey}),
 * so `rate_limit_counters` never holds a client address. Keyed with the service-role key, a
 * server-only secret already in every environment; rotating it only resets the counters. Null
 * when that secret is missing.
 */
export function hashIpKey(normalized: string, secret: string | undefined = process.env.SUPABASE_SERVICE_ROLE_KEY): string | null {
  if (!secret) return null
  return `ip:${createHmac('sha256', secret).update(normalized).digest('hex')}`
}

/**
 * The caller's rate-limit IP key (hashed, see {@link hashIpKey}), read only where the platform sets the header: on Vercel
 * (`VERCEL=1`), which overwrites `x-forwarded-for` / `x-real-ip` with the client address and
 * doesn't forward one a client sent. `x-vercel-forwarded-for` comes first because a proxy in
 * front of Vercel could change `x-forwarded-for`. Anywhere else these headers are whatever the
 * client typed, so there is no IP key (null) and the per-IP limit is skipped; the per-user
 * limits still apply.
 */
export function clientIpKey(headers: Headers, onVercel: boolean = process.env.VERCEL === '1'): string | null {
  if (!onVercel) return null
  const raw = headers.get('x-vercel-forwarded-for') ?? headers.get('x-real-ip') ?? headers.get('x-forwarded-for')
  if (!raw) return null
  // The first hop is the client; Vercel sends one address, but read a list defensively.
  const normalized = ipRateLimitKey(raw.split(',')[0] ?? '')
  if (!normalized) return null
  const hashed = hashIpKey(normalized)
  if (!hashed) console.error('AI per-IP limit skipped: no secret to hash the address with')
  return hashed
}

// --- Limits -----------------------------------------------------------------------------------

/** 429 `rate_limited` (with `Retry-After`), 503 when the limiter failed, or null when allowed. */
async function limit(bucket: RateLimitBucket, key: string, client?: SupabaseClient): Promise<NextResponse | null> {
  const result = await takeRateLimit(bucket, key, client)
  if (result.kind === 'allowed') return null
  if (result.kind === 'limited') return rateLimitedResponse(result.retryAfterSeconds)
  return limiterUnavailableResponse()
}

/**
 * The per-IP limit, before auth. Null (allowed) when the request has no trusted IP (see
 * {@link clientIpKey}).
 */
export async function limitAiByIp(request: Request, client?: SupabaseClient): Promise<NextResponse | null> {
  const key = clientIpKey(request.headers)
  if (!key) return null
  return limit(AI_IP_RATE_LIMIT, key, client)
}

/** A per-user limit, after auth. */
export async function limitAiByUser(
  bucket: RateLimitBucket,
  userId: string,
  client: SupabaseClient
): Promise<NextResponse | null> {
  return limit(bucket, userId, client)
}

// --- Own-key failures -------------------------------------------------------------------------

/**
 * Reads a bucket without counting a hit (`rate_limit_peek`, migration 028): `limited` when any of
 * its windows is full. A failure is answered per `bucket.onError`, like `takeRateLimit`.
 */
export async function peekRateLimit(
  bucket: RateLimitBucket,
  key: string,
  client?: SupabaseClient
): Promise<RateLimitResult> {
  const failed = (): RateLimitResult => {
    console.error(`Rate limit peek (${bucket.name}) failed; ${bucket.onError === 'allow' ? 'allowing' : 'refusing'} the request`)
    return bucket.onError === 'allow' ? { kind: 'allowed' } : { kind: 'unavailable' }
  }
  try {
    const supabase = client ?? (await createServiceRoleClient())
    const { data, error } = await supabase.rpc('rate_limit_peek', {
      p_bucket: bucket.name,
      p_key: key,
      p_windows: bucket.limits.map((l) => l.windowSeconds),
      p_maxes: bucket.limits.map((l) => l.max),
    })
    if (error) return failed()
    const row = (Array.isArray(data) ? data[0] : data) as { allowed?: unknown; retry_after_seconds?: unknown } | null | undefined
    if (!row || typeof row.allowed !== 'boolean') return failed()
    if (row.allowed) return { kind: 'allowed' }
    const wait = Number(row.retry_after_seconds)
    return { kind: 'limited', retryAfterSeconds: Number.isFinite(wait) && wait >= 1 ? Math.ceil(wait) : 1 }
  } catch {
    return failed()
  }
}

/**
 * Before an own-key provider call: 429 `rate_limited` when the user's key failures are used up,
 * 503 when they can't be read, null otherwise. Counts nothing.
 */
export async function byokKeyFailureGate(userId: string, client: SupabaseClient): Promise<NextResponse | null> {
  const result = await peekRateLimit(AI_BYOK_KEY_FAILURE_LIMIT, userId, client)
  if (result.kind === 'allowed') return null
  if (result.kind === 'limited') return rateLimitedResponse(result.retryAfterSeconds)
  return limiterUnavailableResponse()
}

/** After an own-key request: counts one failure when `code` is a rejected or unfunded key. */
export async function recordByokKeyFailure(code: string, userId: string, client: SupabaseClient): Promise<void> {
  if (!AI_BYOK_KEY_FAILURE_CODES.has(code)) return
  await takeRateLimit(AI_BYOK_KEY_FAILURE_LIMIT, userId, client)
}

// --- Concurrency ------------------------------------------------------------------------------

export type AiSlot =
  | { kind: 'acquired'; release: () => Promise<void> }
  | { kind: 'refused'; response: NextResponse }

/**
 * Takes one of the user's {@link AI_MAX_CONCURRENT_REQUESTS} slots, leased for `leaseSeconds`.
 * Refused: 429 `rate_limited` when all are taken, 503 `ai_overloaded` when the database call
 * failed. `release` never throws and runs once; a failed release is logged and the lease simply
 * runs out.
 */
export async function acquireAiSlot(supabase: SupabaseClient, userId: string, leaseSeconds: number): Promise<AiSlot> {
  let slotId: string
  try {
    const { data, error } = await supabase.rpc('ai_slot_acquire', {
      p_user: userId,
      p_max: AI_MAX_CONCURRENT_REQUESTS,
      p_lease_seconds: leaseSeconds,
    })
    if (error) {
      console.error(`AI slot acquire failed (code ${typeof error.code === 'string' ? error.code : 'unknown'}); refusing the request`)
      return { kind: 'refused', response: limiterUnavailableResponse() }
    }
    if (data === null) return { kind: 'refused', response: rateLimitedResponse(AI_SLOT_RETRY_AFTER_SECONDS) }
    if (typeof data !== 'string') {
      console.error('AI slot acquire returned no slot id; refusing the request')
      return { kind: 'refused', response: limiterUnavailableResponse() }
    }
    slotId = data
  } catch {
    console.error('AI slot acquire threw; refusing the request')
    return { kind: 'refused', response: limiterUnavailableResponse() }
  }

  let released = false
  return {
    kind: 'acquired',
    release: async () => {
      if (released) return
      released = true
      try {
        const { error } = await supabase.rpc('ai_slot_release', { p_user: userId, p_slot: slotId })
        if (error) console.error('AI slot release failed; the lease will run out')
      } catch {
        console.error('AI slot release threw; the lease will run out')
      }
    },
  }
}

// --- Credits ----------------------------------------------------------------------------------

/**
 * True only when a managed reservation for `(userId, month)` would certainly be refused
 * (`ai_credits_exhausted`, migration 028: no credit pack this month and the allowance used up).
 * It is never stricter than `ai_reserve_credits`, which stays the authority, so a failed read
 * answers false (the request goes on to the reservation) and is logged.
 */
export async function managedCreditsExhausted(supabase: SupabaseClient, userId: string, month: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('ai_credits_exhausted', { p_user: userId, p_month: month })
    if (error) {
      console.error('AI credit pre-check failed; leaving it to the reservation')
      return false
    }
    return data === true
  } catch {
    console.error('AI credit pre-check threw; leaving it to the reservation')
    return false
  }
}
