---
name: static-pages-locale-root-404
description: Why every page in this app is dynamic (root layout's getLocale reads a header), why moving <html> into app/[locale]/layout.tsx with next/root-params makes pages static but breaks 404 SSR in Next 16.4, and the next-intl requestLocale getter trap
metadata:
  type: reference
---

Measured on Next 16.4.4 + next-intl 4.14.9 (Turbopack, standalone builds in Docker), 2026-11.

- **Why everything is ƒ:** `app/layout.tsx` owns `<html lang dir>` for both the localized site and
  the unprefixed `/auth/*` pages, and calls `getLocale()`. Under a root layout above `[locale]`,
  `setRequestLocale` in `app/[locale]/layout.tsx` runs too late, so next-intl reads the
  `X-NEXT-INTL-LOCALE` request header (`headers()`), which makes *every* page dynamic. Removing
  the Navbar's session read alone changes nothing in the route table.
- **What does make pages static:** `<html>` in `app/[locale]/layout.tsx` (the root layout, no
  `app/layout.tsx`) and `i18n/request.ts` reading `locale()` from `next/root-params` (stable in
  16.4; it only exists when the root layout is inside `[locale]`). faq/privacy/terms/changelog/
  contact and the auth pages then build as ● per locale, with ISR `s-maxage=3600` from the
  Navbar's revalidated GitHub fetch.
- **Blocker: 404s stop server-rendering.** With `<html>` anywhere but a top-level
  `app/layout.tsx`, every 404 (unknown path via a `[...rest]` catch-all, `notFound()` in a page,
  `/api/unknown`) is sent as Next's empty `<html id="__next_error__">` shell: status 404 and the
  title are right, but no `lang`, and the content only appears after hydration (it is in the RSC
  payload). Reproduced with a minimal inline-`<html>` `[locale]` layout, with and without
  `experimental.globalNotFound` + `app/global-not-found.tsx`, with next-intl's documented
  pass-through `app/layout.tsx`, and with the not-found boundary in a nested route group. Nothing
  is logged, even in `next dev` (an HTTP-fallback error escaping during SSR is silenced). The
  base layout (html in `app/layout.tsx`) renders 404s fully. Decision: pages stay dynamic until
  this changes; re-test on a newer Next before reattempting.
- **requestLocale getter trap:** in `getRequestConfig`, destructuring `async ({ requestLocale })`
  calls next-intl's getter, which reads `headers()` at once, so the page is dynamic even when the
  value is never awaited. Take `params` and read `params.requestLocale` only when needed.
- **Testing `next/root-params`:** the package is a placeholder the compiler replaces; imported in
  Vitest it throws. Mock it (`vi.mock('next/root-params', () => ({ locale: async () => undefined }))`).
- **How to find what forces dynamic:** add `export const dynamic = 'error'` to one page in a
  container copy and build: the error names the API and the stack (`headers()` from
  `i18n/request.ts` via the Navbar).
- **Build in a container copy** (`git archive HEAD packages/web` or a tar of the tree into the
  Docker volume with the existing `node_modules`), never in the checkout: a local `next build`
  overwrites `.next`. Fonts (`next/font/google`) need network at build time, so build without
  `--network none` and run the server with it. The `node:24` image has no `pkill`: stop one
  server before starting the next or a second server silently fails to bind and the first answers.

Related: [[sentry-server-cold-start-cost]], [[i18n-next-intl]], [[i18n-unsegmented-routes]], [[error-pages-next16]].
