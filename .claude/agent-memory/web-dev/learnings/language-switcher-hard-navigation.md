---
name: language-switcher-hard-navigation
description: Why the language switcher does a full page load (root-layout provider and html lang never re-render on soft nav), cookie-before-navigate, mount-effect router calls throwing, and how to test it (real navigation, jsdom location stub, Radix menu keyboard)
metadata:
  type: reference
---

**A locale switch must be a document load here.** `<html lang dir>` and `NextIntlClientProvider`
live in the ROOT layout (outside `app/[locale]/`). A client-side `router.replace(path, { locale })`
re-renders only `[locale]` and below, so after a soft switch Server Components were German while
`<html lang>` stayed `en` and every Client Component (theme toggle label, menus, toasts) kept the
English catalog. Probe: switch, then read `document.documentElement.lang` and a client-rendered
`aria-label`. `LanguageMenu.switchLocale()` writes the cookie and calls `location.replace(...)`.

**Cookie first.** With `localeDetection: true` + `as-needed`, loading `/pricing` with
`NEXT_LOCALE=de` redirects to `/de/pricing`, so picking English must write `NEXT_LOCALE=en` before
navigating. next-intl's middleware only sets the cookie on `Sec-Fetch-Dest: document` requests and
only when it differs from the URL/Accept-Language locale; its default cookie has no max-age
(session), path `/`, SameSite Lax. `LOCALE_COOKIE` lives in `i18n/negotiate.ts`.

**Router calls in mount effects.** A child's mount `useEffect` can run before the App Router
finishes initializing; `router.replace` there throws "Router action dispatched before
initialization". To drop query params on mount use `window.history.replaceState(null, '', url)`
(Next syncs `usePathname`/`useSearchParams` with native history), as `UpgradedBanner` and
`CheckoutCanceledTracker` do.

**Testing.** `vi.unmock('@/i18n/navigation')` + a `next/navigation` mock (with `redirect`,
`permanentRedirect`, `notFound`) gives the real `getPathname` prefixes. jsdom can't navigate:
`delete window.location` and assign a stub `{ pathname, search, hash, replace: vi.fn() }`, restore in
`afterEach` (same trick as `PricingCard.test`). Radix DropdownMenu in jsdom: `user.click` on the
trigger opens it; focusing the trigger and pressing Enter opens it with focus on the first item, and
arrows move focus. A `next/dynamic` component needs `findByRole` (it resolves a tick later). A
`vi.mock` factory can expose a getter (`get PUBLIC_LOCALES()`) to vary a constant per test.

**Header room.** Adding a 2.25rem button to the marketing navbar overflowed the md-to-lg band (FAQ
clipped at 768px even in English). Decision: below lg the switcher is icon-only and the logo drops
its wordmark (`sm:inline md:hidden lg:inline`); the GitHub badge was already mark-only there.

Related: [[i18n-next-intl]], [[navbar-streamed-data-and-width-budget]], [[i18n-unsegmented-routes]].
