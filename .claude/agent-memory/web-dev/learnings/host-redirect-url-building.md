---
name: host-redirect-url-building
description: Building a redirect onto a fixed origin from a request path — new URL(path, base) lets `//evil.com/x` replace the origin; use the pathname/search setters. Also how proxy.ts legacy-host redirect is tested.
metadata:
  type: reference
---

`new URL(pathname + search, 'https://tabmerger.com')` is NOT origin-safe: a request path
`//evil.com/x` (valid; `nextUrl.pathname` keeps the double slash) parses as a
protocol-relative reference and the result's origin becomes `https://evil.com`. Safe form:
`const u = new URL(fixedOrigin); u.pathname = pathname; u.search = search` — the setters
can't change the host, giving `https://tabmerger.com//evil.com/x`.

`legacyHostRedirect()` in `packages/web/proxy.ts` uses this and runs before CORS and the
Supabase client. It skips `/api` and `/firefox-beta` (exact or `prefix/`, so `/apix` still
redirects) because a CORS preflight can't follow a redirect and the PKCE callback must stay
on its host.

Testing: `new NextRequest(url, { headers: { host } })` keeps a custom `host` header in
Vitest (undici doesn't strip it), so uppercase / `:443` variants can be tested directly
(`__tests__/proxyLegacyHostRedirect.test.ts`). Related: [[seo-metadata]].
