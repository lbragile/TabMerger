/**
 * A per-key rate limit kept in this server instance's memory: no network call, no database row,
 * well under a microsecond per check. Use it where a limit only has to stop one client flooding a
 * cheap public route; use `lib/rateLimit.ts` (Postgres, shared by every instance) where each
 * unlimited call costs money.
 *
 * What "per instance" means: each server instance counts on its own, and a new instance starts at
 * zero. A client spread over N warm instances can make up to N times a limit, and never fewer than
 * one instance's limit, so a real user is never limited below the stated numbers. On Vercel Fluid
 * one instance serves many requests (and many at once), so a counter here sees most of one
 * client's traffic.
 *
 * Windows are fixed and aligned to the Unix epoch, as in `lib/rateLimit.ts`: a burst across a
 * boundary can reach up to twice a limit. A refused hit counts nowhere.
 */

/** At most `max` hits in each fixed window of `windowSeconds`. */
export interface MemoryRateLimitWindow {
  windowSeconds: number
  max: number
}

export type MemoryRateLimitResult =
  /** `counts[i]`: hits in limit i's current window, this one included. */
  | { kind: 'allowed'; counts: readonly number[] }
  | { kind: 'limited'; retryAfterSeconds: number }

export interface MemoryRateLimiter {
  /** Counts one hit for `key` against every limit at once (only when each still has room). */
  take(key: string, nowMs?: number): MemoryRateLimitResult
  /** Keys held right now (for tests). */
  size(): number
}

interface Entry {
  /** Start (ms) of each limit's window the counts belong to. */
  starts: number[]
  counts: number[]
  /** When the longest window ends; after this the entry holds nothing. */
  expiresAt: number
}

/**
 * Default cap on keys held at once. An entry is about 200 bytes, so 20 000 keys stay near 4 MB.
 * Over the cap, expired keys go first, then the least recently used; an evicted key only starts
 * again at zero, which fails open.
 */
export const MEMORY_RATE_LIMIT_MAX_KEYS = 20_000

/**
 * A limiter over `limits` (1 or more, each `windowSeconds` >= 1 and `max` >= 1). Each caller makes
 * its own, so one route's traffic never uses up another's allowance.
 */
export function createMemoryRateLimiter(
  limits: readonly MemoryRateLimitWindow[],
  { maxKeys = MEMORY_RATE_LIMIT_MAX_KEYS }: { maxKeys?: number } = {}
): MemoryRateLimiter {
  if (limits.length === 0) throw new Error('createMemoryRateLimiter: at least one limit')
  for (const l of limits) {
    if (!(l.windowSeconds >= 1) || !(l.max >= 1)) throw new Error('createMemoryRateLimiter: windowSeconds and max must be >= 1')
  }
  if (!(maxKeys >= 1)) throw new Error('createMemoryRateLimiter: maxKeys must be >= 1')

  const windowsMs = limits.map((l) => l.windowSeconds * 1000)
  // Map keeps insertion order; every hit re-inserts its key, so the first keys are the least
  // recently used.
  const entries = new Map<string, Entry>()

  /** Makes room for one more key: drops expired keys, then the least recently used ones. */
  const evict = (now: number) => {
    for (const [key, entry] of entries) if (entry.expiresAt <= now) entries.delete(key)
    // Down to 90 %, so the next full sweep is at least a tenth of the cap of new keys away.
    const target = Math.max(0, Math.floor(maxKeys * 0.9))
    for (const key of entries.keys()) {
      if (entries.size <= target) break
      entries.delete(key)
    }
  }

  return {
    take(key, now = Date.now()) {
      const starts = windowsMs.map((w) => Math.floor(now / w) * w)
      const previous = entries.get(key)
      const counts = starts.map((start, i) => (previous && previous.starts[i] === start ? previous.counts[i] : 0))

      let waitMs = 0
      for (let i = 0; i < limits.length; i++) {
        if (counts[i] >= limits[i].max) waitMs = Math.max(waitMs, starts[i] + windowsMs[i] - now)
      }
      if (waitMs > 0) return { kind: 'limited', retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) }

      for (let i = 0; i < counts.length; i++) counts[i] += 1
      if (previous) entries.delete(key)
      else if (entries.size >= maxKeys) evict(now)
      entries.set(key, { starts, counts, expiresAt: Math.max(...starts.map((start, i) => start + windowsMs[i])) })
      return { kind: 'allowed', counts }
    },
    size: () => entries.size,
  }
}
