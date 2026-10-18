---
name: visitor-browser-install-order
description: Install CTAs lead with the visitor's browser via a server-side UA sniff (lib/visitorBrowser.ts); the page reads headers() and passes a `browser` prop so components stay sync and RTL-testable; labels are per-browser message keys
metadata:
  type: reference
---

- `lib/visitorBrowser.ts`: `detectInstallBrowser(ua)` (`Edg/` before `Firefox/`, else Chrome, incl. bots/missing header), `orderInstallBrowsers(primary)`, async `getVisitorBrowser()` reading `headers()`. The UA only selects one of three fixed values; it is never echoed.
- Decision: the *page* (`app/[locale]/(marketing)/page.tsx`, features, pricing, share demo, dashboard) awaits `getVisitorBrowser()` and passes `browser` to `Hero`/`InstallButtons`/`FinalCta`/`ShareInstallCta` (or picks `getStoreLinks()[browser]` itself). Making the components async would break every `render(<Hero />)` test (RTL cannot render async components). Prop defaults to `'chrome'`.
- Labels: one message key per browser (`home.hero.installFirefox`, `featuresPage.addToEdge`, ...) mapped with a `{ chrome: 'installChrome', ... } as const satisfies Record<InstallBrowser, string>` table, so `t(MAP[browser])` stays type-checked against the catalog. No English browser-name map in code.
- A page that becomes async to read headers can't keep `useTranslations` (hooks don't run in async components, and tests call `await Page()` outside React): switch it to `getTranslations`, or keep the hook in a child component (home page `HomeJsonLd`). See [[i18n-next-intl]].
- Reading `headers()` makes the page render per request (Next sends `private, no-store`, so no CDN `Vary: User-Agent` concern).
- vitest.setup mocks `next/headers` with an empty `Headers` (Chrome). A test that varies the UA mocks it itself with a `vi.hoisted` holder; async pages render with `render(await Page())`.
- Browser icons have `role="img"` + `aria-label`, so a link's accessible name is "Chrome Install for Chrome — free": exact `getByRole('link', { name: '...' })` fails. Match on `textContent` instead (`installLinkNames` in `__tests__/visitorBrowser.test.tsx`).
- `PricingCard`'s free-plan click pushes internal install links (the Firefox beta guide) with the `@/i18n/navigation` router so the locale prefix survives; its `/auth/*` pushes keep the plain `next/navigation` router (no prefixed version).
