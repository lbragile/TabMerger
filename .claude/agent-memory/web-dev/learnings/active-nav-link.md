---
name: active-nav-link
description: NavLink client leaf for active header/menu links — locale-free usePathname, shared active class kept in a plain module for the server Navbar, why no font-medium, headless font-width measuring, per-file pathname mock
metadata:
  type: reference
---

`components/layout/NavLink.tsx` ('use client') marks the header bar and menu-panel links for the
current page (`aria-current="page"` + `activeClassName`). `isNavLinkActive(pathname, href)`:
exact or `href + '/'` prefix, so `/compare/<x>` lights Compare and `/pricingx` doesn't light Pricing.

- Use `usePathname` from `@/i18n/navigation`: it strips the `as-needed` locale prefix, so the server
  HTML (`/en/pricing` internally, after the proxy rewrite) and the browser (`/pricing`) agree and
  there's no hydration mismatch. No `cacheComponents` in next.config, so no Suspense boundary is
  needed for the hook (Next 16 docs: it only suspends under cacheComponents with unknown params).
- The active class string (`NAV_LINK_ACTIVE_CLASS`) lives in `navLinks.ts`, not the client module:
  a non-component export imported from a 'use client' file into the server `Navbar` is a client
  reference, not the string (see [[backdrop-pointer-glow]]).
- No `font-medium` when active: measured Geist Sans 400 vs 500 at 13.5px is +1.2 to +2.9px per label,
  enough to nudge the bar's other links on each navigation and eat the lg-to-xl budget
  ([[navbar-streamed-data-and-width-budget]]).
- Measuring font widths headless without a dev server: the Geist woff2 is in
  `.next/dev/static/media/*.p.*.woff2` (the variable-weight one; the other `.p.` file is Geist Mono,
  identical widths at every weight). Load it via `FontFace` from a data URL in a playwright page and
  `canvas.measureText`. From a scratchpad script, import `@playwright/test` by its resolved
  file URL as a default import (CJS: `import pw from '...'; const { chromium } = pw`).
- Tests vary the pathname per test with the hoisted-object pattern ([[vitest-hoisted-mock-state]]):
  re-mock `@/i18n/navigation` with `createNavigationMock` spread plus `usePathname: () => nav.pathname`.
  The mobile panel's accessible name is "Menu" (`nav.mobileMenu`).
