---
name: production-deployment-gate
description: How a page or link is made preview/local-only (lib/deployment.ts), why the check must run per request, and what Next does to a notFound() page
metadata:
  type: reference
---

- `isProductionDeployment()` in `packages/web/lib/deployment.ts` is the single "is this the production deployment" check (`VERCEL_ENV`, or `NEXT_PUBLIC_VERCEL_ENV` in a client bundle). `NODE_ENV` cannot answer it: the preview site is a production build too. `app/sentry-test` asks a different question (dev only, 404 on preview as well), so it keeps its own `NODE_ENV` check.
- Decision: a page that must not exist on production calls `notFound()` in the component and exports `dynamic = 'force-dynamic'`. Both sites are built in CI and uploaded prebuilt, so a statically prerendered gate would depend on the build machine's environment; a per-request gate reads the running deployment's own `VERCEL_ENV`. One build started locally with `VERCEL_ENV=production` then `=preview` (`next start -p <port>`) answers 404 then 200, which is the quick way to prove a gate.
- Every `(marketing)` page is already dynamic (`ƒ` in the build table) because the Navbar reads the session, so the Footer is rendered per request too and can use the same check without a client component.
- A `notFound()` response drops the page's own `metadata` (title falls back to the root layout's) and Next adds `<meta name="robots" content="noindex">` by itself. The page-level `robots: noindex` metadata is a second line, not the only one.
- Do not add a removed URL to `robots.ts` `disallow`: crawlers must be able to fetch it to see the 404 and drop it. `sitemap.ts` is a hand-written list, so a gated page is simply never added.
- Tests: the global `next/navigation` mock in `vitest.setup.tsx` has a throwing `notFound`; a spec that needs to assert the call mocks it locally with `vi.hoisted`. Call the server component as a function (`expect(() => Page()).toThrow()`) to avoid React's render-error noise. Stub both env names, with `''` for "unset".
