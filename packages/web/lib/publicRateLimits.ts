import type { SupabaseClient } from '@supabase/supabase-js'
import { hashIpKey, ipRateLimitKey, trustedClientAddress } from '@/lib/clientIp'
import { deployPlatform, type DeployPlatform } from '@/lib/deployment'
import { createMemoryRateLimiter, type MemoryRateLimitWindow } from '@/lib/memoryRateLimit'
import { takeRateLimit, type RateLimitBucket } from '@/lib/rateLimit'

/**
 * Per-IP limits for the two unauthenticated routes the extension calls with a CORS simple request
 * (`/api/track`, `/api/og-preview`), so a third party can't use them at the project's cost (CPU,
 * bandwidth, and for og-preview a fetch of any page it names). They are set far above real use: a
 * user who reaches one is a script, or many people behind one address.
 *
 * - Keyed on the address the hosting platform reports ({@link trustedClientAddress}), with IPv6
 *   counted per /64 ({@link ipRateLimitKey}). Without one (local development, CI, an unknown
 *   host) nothing is limited: every header there is whatever the client typed.
 * - Counted in this instance's memory first (`lib/memoryRateLimit.ts`, about a microsecond).
 *   `/api/track` stops there: a Postgres check would cost a round trip and two row writes per
 *   event, more than forwarding the event to GA4 does.
 * - `/api/og-preview` also counts in Postgres (shared by every instance), but only from an
 *   address's {@link OG_PREVIEW_SHARED_CHECK_FROM}th call this minute in this instance, so normal
 *   hovering never pays for the round trip and a flood spread over many instances is still capped.
 * - Every failure fails open: a limiter that can't answer lets the request through.
 */

/**
 * `/api/track`: 120 a minute, 1 200 an hour per address. An extension session sends a handful of
 * events (popup opened, a page view per screen, a few actions); the busiest path is one `dnd_move`
 * per drop, so rearranging a large set of tabs for a minute stays under 60. 1 200 an hour is 20 a
 * minute sustained, which no single user reaches and leaves room for several users behind one
 * office or school address.
 */
export const TRACK_IP_LIMITS: readonly MemoryRateLimitWindow[] = [
  { windowSeconds: 60, max: 120 },
  { windowSeconds: 3600, max: 1200 },
]

/**
 * `/api/og-preview`: 60 a minute, 600 an hour per address. One call per tab-preview tooltip open,
 * and a tooltip opens only after a 400 ms hover, so even reading previews down a long list one
 * per second stays at 60. 600 an hour is 10 a minute sustained, several times a heavy user's.
 */
export const OG_PREVIEW_IP_LIMITS: readonly MemoryRateLimitWindow[] = [
  { windowSeconds: 60, max: 60 },
  { windowSeconds: 3600, max: 600 },
]

/** The shared (Postgres) copy of {@link OG_PREVIEW_IP_LIMITS}; fails open. */
export const OG_PREVIEW_IP_RATE_LIMIT: RateLimitBucket = {
  name: 'og-preview-ip',
  limits: OG_PREVIEW_IP_LIMITS,
  onError: 'allow',
}

/**
 * From this call in a minute (per address, per instance), an og-preview call is also counted in
 * Postgres. A user hovering through previews rarely makes 10 a minute; a script does at once.
 */
export const OG_PREVIEW_SHARED_CHECK_FROM = 10

const trackLimiter = createMemoryRateLimiter(TRACK_IP_LIMITS)
const ogPreviewLimiter = createMemoryRateLimiter(OG_PREVIEW_IP_LIMITS)

export type PublicRateLimitResult = { limited: false } | { limited: true; retryAfterSeconds: number }

const ALLOWED: PublicRateLimitResult = { limited: false }

/** The normalised address key for these limits, or null when the platform reports none. */
export function publicRouteIpKey(headers: Headers, platform: DeployPlatform | null = deployPlatform()): string | null {
  const raw = trustedClientAddress(headers, platform)
  return raw ? ipRateLimitKey(raw) : null
}

/** Logs a limiter failure (route name only, never the address) and allows the request. */
function failOpen(route: string): PublicRateLimitResult {
  console.error(`Rate limit (${route}): limiter failed; allowing the request`)
  return ALLOWED
}

/** Counts one `/api/track` call for the request's address. Synchronous: memory only. */
export function limitTrackByIp(headers: Headers, platform: DeployPlatform | null = deployPlatform()): PublicRateLimitResult {
  try {
    const key = publicRouteIpKey(headers, platform)
    if (!key) return ALLOWED
    const result = trackLimiter.take(key)
    return result.kind === 'limited' ? { limited: true, retryAfterSeconds: result.retryAfterSeconds } : ALLOWED
  } catch {
    return failOpen('track')
  }
}

/**
 * Counts one `/api/og-preview` call for the request's address: in memory, then (from
 * {@link OG_PREVIEW_SHARED_CHECK_FROM} a minute) in Postgres too, under the address's HMAC so the
 * counters never hold it. `client` is a service-role client for tests.
 */
export async function limitOgPreviewByIp(
  headers: Headers,
  { platform = deployPlatform(), client }: { platform?: DeployPlatform | null; client?: SupabaseClient } = {}
): Promise<PublicRateLimitResult> {
  try {
    const key = publicRouteIpKey(headers, platform)
    if (!key) return ALLOWED
    const local = ogPreviewLimiter.take(key)
    if (local.kind === 'limited') return { limited: true, retryAfterSeconds: local.retryAfterSeconds }
    if (local.counts[0] < OG_PREVIEW_SHARED_CHECK_FROM) return ALLOWED

    const hashed = hashIpKey(key)
    if (!hashed) return ALLOWED // no secret to hash with: the per-instance limit still applies
    const shared = await takeRateLimit(OG_PREVIEW_IP_RATE_LIMIT, hashed, client)
    return shared.kind === 'limited' ? { limited: true, retryAfterSeconds: shared.retryAfterSeconds } : ALLOWED
  } catch {
    return failOpen('og-preview')
  }
}
