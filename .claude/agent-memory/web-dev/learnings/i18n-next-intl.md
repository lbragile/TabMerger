---
name: i18n-next-intl
description: next-intl in this app (Next 16, proxy.ts, Supabase) - proxy order, tests (RTL wrapper, mocks, use-intl externals), catalog bundle traps, lint gaps, verification tricks
metadata:
  type: reference
---

Setup and usage live in docs/I18N.md; these are the non-obvious parts.

**Proxy composition.** Run the Supabase refresh first, then `createIntlMiddleware(routing)(request)`.
next-intl's `next()`/`rewrite()` copies `request.headers`, and `request.cookies.set()` in Supabase's
`setAll` writes into those headers, so refreshed cookies reach the render; then copy the refreshed
cookies onto whatever response next-intl returned. Keep the matcher as it was (`/api/*` needs CORS,
`/auth/sign-in` the signed-in redirect) and skip the intl handler for non-localized paths inside
`proxy()` instead. Strip the locale prefix before the `/dashboard`/`/account` protection check.

**Root layout.** All marketing routes were already dynamic (Navbar reads cookies), so the root
layout can call `getLocale()` for `<html lang>` and keep error.tsx/not-found.tsx at the root; no
pass-through root layout needed. `app/[locale]/layout.tsx` only validates the segment
(`notFound()`) and calls `setRequestLocale`.

**Keep sync pages sync.** A page that becomes `async` (for `getTranslations`) breaks every test
that does `render(<Page />)` ("async Client Component"). In a non-async Server Component use
`useTranslations` instead; keep `getTranslations` for `generateMetadata` and pages already async.
A test that calls `Page()` outside React needs hook-free pages: move the hook into a child.

**Tests.** vitest.setup mocks `@testing-library/react` so `render`/`renderHook` default to a
`NextIntlClientProvider` wrapper (composed with the test's own), mocks `next-intl/server` with
`createTranslator` over the English catalog, and mocks `@/i18n/navigation` with a factory that
imports `next/link` lazily (a test's own `next/link` mock must apply). Inline only `next-intl` in
`server.deps.inline`; inlining `use-intl` too gives tests that call `vi.resetModules()` a second
React context ("context from NextIntlClientProvider was not found"). `renderToString`/`hydrateRoot`
tests need the wrapper added by hand.

**Bundle traps.** Importing a catalog JSON in `global-error.tsx` put the whole catalog (118 KB) in
every route's first-load JS: global-error is in every route bundle. Hence one JSON per namespace
under `messages/<locale>/` and global-error imports `errors.json` only. Check per-route JS in
`.next/diagnostics/route-bundle-stats.json` after `next build`. `outputFileTracingIncludes` keys are
route paths: after moving under `app/[locale]/` the changelog key is `/[locale]/changelog`.

**Lint guard gaps.** `react/jsx-no-literals` (noStrings) flags JSX text and bare `{'…'}` children
but not strings inside ternaries (`{x ? 'Hide' : 'Show'}`) or attribute values; attributes are
covered by a `no-restricted-syntax` selector on `aria-label|title|alt|placeholder`. Grep for
`? '[A-Z]` in translated files when reviewing. The attribute selector matches `Literal` only, so a
template literal (`` aria-label={`Pull request #${n} on GitHub`} ``) passes lint; grep for
`` ={` `` too, especially in code cherry-picked from a pre-i18n branch. `allowedStrings` entries
match whole text runs: `(` and `#` are allowed, `(#` is not; write `({'#'}` instead.

**Numbers in messages.** A plain `{number}` argument is stringified, not locale-formatted, so a PR
or issue number prints as `#1234` in every locale (checked with `createTranslator` for `de`). Only
`{n, number}` (or plural) groups digits (`1.234`); use that for counts, never for identifiers.

**Verifying "English unchanged".** Dump `document.documentElement` before and after with scripts,
comments, `_R_…_` useId values and sentry metas normalised: useId values change when the tree
depth changes. Joining text runs ("−" "10" "%" into "−10%") shifts glyphs by sub-pixels: a few
ClearType-coloured pixels in dark-theme screenshots, not a regression. In Git Bash, a script
argument like `/en-XA` is rewritten to a Windows path; prefix the command with `MSYS_NO_PATHCONV=1`.

Related: [[navbar-streamed-data-and-width-budget]], [[seo-metadata]], [[error-pages-next16]].
