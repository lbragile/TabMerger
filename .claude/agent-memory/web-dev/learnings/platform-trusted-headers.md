---
name: platform-trusted-headers
description: Client IP (lib/clientIp.ts) and consent geo (geoFromHeaders) read only the current platform's headers via deployPlatform(); never "whichever header exists"; fallback rules off a platform and the tests that prove a client can't pick its own key
metadata:
  type: reference
---

`deployPlatform()` (`DEPLOY_PLATFORM` = `cloudflare | vercel`, else `vercel` when `VERCEL=1`,
else null) decides which request headers the server trusts.

- **Client IP** (`trustedClientAddress` in `lib/clientIp.ts`): Cloudflare reads only
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
