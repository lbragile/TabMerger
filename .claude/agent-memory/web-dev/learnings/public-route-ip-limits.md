---
name: public-route-ip-limits
description: Per-IP limits on /api/track and /api/og-preview — in-memory first line (lib/memoryRateLimit.ts), Postgres only for og-preview past a per-instance threshold; measured costs, limits, and the test isolation pattern for module-level limiters
metadata:
  type: reference
---

`lib/publicRateLimits.ts` limits the two unauthenticated extension routes per trusted client address
(`trustedClientAddress` + `ipRateLimitKey`, so IPv6 counts per /64; no platform = no limit).

**Measured cost of one check (Node 24, local):**
- `createMemoryRateLimiter().take()` (fixed epoch windows, LRU-capped Map, 20k keys): ~1.4 us.
- `takeRateLimit` (Postgres): ~0.2 ms client CPU just for `createServiceRoleClient()` + HMAC + rpc
  serialisation with an instant fake fetch, plus TLS, a network round trip, an advisory lock and one
  row upsert per window. For `/api/track` that is more than the GA4 forward it would protect, so
  track is memory-only.

**Decision:** og-preview counts in memory, and asks Postgres (bucket `og-preview-ip`, fail open,
key = `hashIpKey` HMAC so no address is stored) only from an address's 10th call in the current
minute on that instance. Normal hovering never pays the round trip; a flood spread over many Fluid
instances is still capped globally. Per-instance counting can only be more lenient than the stated
limit, never stricter, so in-memory limits can't hurt real users.

**Limits and why:** track 120/min + 1200/h (busiest path is one `dnd_move` per drop); og-preview
60/min + 600/h (one call per tooltip open, tooltip opens after a 400 ms hover, the extension does
not cache, so re-hovering the same tab re-fetches). Hourly caps leave room for NAT/office sharing.

**Order in the route:** limit before reading the body. Track checks `isGa4Configured` first (free,
and nothing gets counted where GA is off). Limited: track 429 empty body + `Retry-After`;
og-preview 429 `{ ogImage: null, description: null }` + `no-store`. Extension CORS headers come from
proxy.ts on `NextResponse.next()`, so route-level 429s keep them with no extra work.

`hashIpKey` lives in `lib/clientIp.ts` (re-exported from `lib/ai-request-limits.ts`), so non-AI
routes don't import the AI limits module.

**Testing module-level limiters:** the limiter Maps survive across tests in a file, so give every
test its own client address (counter-generated) instead of adding a reset API; freeze only `Date`
(`vi.useFakeTimers({ toFake: ['Date'] })`) mid-minute so 60+ calls never cross a window. To test
fail-open, `vi.mock` the limiter module with `importOriginal` and wrap `take` behind a hoisted
`throws` flag. Set `VERCEL=1` via `vi.stubEnv` (and `DEPLOY_PLATFORM=''`) plus an
`x-vercel-forwarded-for` header to exercise the route; every other test file stays unlimited
because tests run with no platform.

Related: [[platform-trusted-headers]], [[public-email-form-routes]].
