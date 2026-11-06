---
name: platform-trusted-headers
description: Client IP (lib/clientIp.ts) and consent geo (geoFromHeaders) read only the current platform's headers via deployPlatform(); never "whichever header exists"; fallback rules off a platform and the tests that prove a client can't pick its own key
metadata:
  type: reference
---

`deployPlatform()` (`DEPLOY_PLATFORM` = a key of `EDGE_PROVIDERS`, else `vercel` when `VERCEL=1`,
else null) decides which request headers the server trusts.

- **One registry:** every header name lives in `EDGE_PROVIDERS` in `lib/deployment.ts`
  (`{ clientIp: [ordered], country, region }` per platform; `DeployPlatform` is its key type,
  `OFF_PLATFORM_GEO_ORDER` the off-platform geo order). A new host is one entry there.
  `isDeployPlatform` uses `Object.hasOwn`, so `DEPLOY_PLATFORM=constructor` isn't a platform.
  `__tests__/edgeProviders.test.ts` pins the names, the order and the never-mix rule.
- **Empty header stops the chain:** `trustedClientAddress` takes the first header that is
  *present* (`headers.get() !== null`), so an empty `x-vercel-forwarded-for` gives null rather
  than falling through to `x-real-ip` (the old `??` chain's behaviour, kept on purpose).

- **Client IP** (`trustedClientAddress` in `lib/clientIp.ts`, names from the registry): Cloudflare reads only
  `cf-connecting-ip`; Vercel reads `x-vercel-forwarded-for`, `x-real-ip`, `x-forwarded-for` in
  that order; null otherwise. Falling through to "whichever header exists" would let a client on
  one host send the other host's header name and choose its own rate-limit key. Tests send both
  sets on each platform and assert the other set is ignored.
- `clientIpKey` (AI limits, hashed) returns null off a platform; `getClientIp` (support forms,
  in-memory) falls back to the first `x-forwarded-for` there so route tests can still exercise the
  limit. Both normalise with `ipRateLimitKey` (IPv6 per /64), now living in `lib/clientIp.ts`
  (re-exported from `ai-request-limits.ts`) so the support forms don't import the Supabase client.
- **Consent geo** (`geoFromHeaders` in `lib/consentRegions.ts`): the platform's pair only
  (`cf-ipcountry`/`cf-region-code` or `x-vercel-ip-country`/`x-vercel-ip-country-region`). Off a
  platform: Vercel's pair, else Cloudflare's, taken as a pair (never Vercel's country with
  Cloudflare's region). The e2e spec sends Vercel names with no platform set, so that fallback
  order must stay.
- Cloudflare: `XX` = no data, `T1` = Tor; both opt-in (T1 already fails the `[A-Z]{2}` check, and
  is listed in `UNKNOWN_COUNTRIES` too). `cf-region-code` is the bare subdivision (`QC`); a
  `CA-QC` form is stripped to `QC` defensively. It exists only with the zone's "Add visitor
  location headers" Managed Transform.

Related: [[deployment-env-hub]], [[consent-regions-and-replay-privacy]].
