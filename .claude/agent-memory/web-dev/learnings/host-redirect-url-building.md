---
name: host-redirect-url-building
description: Building a redirect onto a fixed origin from a request path — new URL(path, base) lets `//evil.com/x` replace the origin; use the pathname/search setters. Also the proxy.ts legacy-host allow-list rationale and how it is tested.
metadata:
  type: reference
---

`new URL(pathname + search, 'https://tabmerger.com')` is NOT origin-safe: a request path
`//evil.com/x` (valid; `nextUrl.pathname` keeps the double slash) parses as a
protocol-relative reference and the result's origin becomes `https://evil.com`. Safe form:
`const u = new URL(fixedOrigin); u.pathname = pathname; u.search = search` — the setters
can't change the host, giving `https://tabmerger.com//evil.com/x`.

`legacyHostRedirect()` in `packages/web/proxy.ts` uses this and runs before CORS and the
Supabase client. It is an ALLOW-LIST (`LEGACY_REDIRECT_EXACT_PATHS` + `LEGACY_REDIRECT_PATH_PREFIXES`,
matched exactly or as `prefix/`, never plain startsWith), so it fails closed: a new route stays
on the old host until it's added. Decision: only public signed-out pages move. Older extension
builds start magic-link sign-in at `<old host>/api/auth/callback`, so the session cookie lives on
the old host and the callback lands on its `/dashboard`; redirecting `/dashboard`, `/account`,
`/auth/*` would show those users a signed-out page and re-sign-in would loop back the same way.
`/api/*` also can't move (a CORS preflight can't follow a redirect). The signed-in parts move in
a later change once most installs sign in on the new domain. One trailing slash is dropped
before matching and in the target (the site has no `trailingSlash`, so this saves a hop). Image
metadata routes (`*.png`, favicon) never reach the proxy because of the matcher, so they aren't
listed; `/robots.txt`, `/sitemap.xml`, `/llms.txt` do reach it and are listed.

Testing: `new NextRequest(url, { headers: { host } })` keeps a custom `host` header in
Vitest (undici doesn't strip it), so uppercase / `:443` variants can be tested directly
(`__tests__/proxyLegacyHostRedirect.test.ts`). Related: [[seo-metadata]].
