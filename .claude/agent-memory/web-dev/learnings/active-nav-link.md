---
name: active-nav-link
description: NavLink client leaf for active header/menu links — locale-free usePathname, shared teal active class in a plain module for the server Navbar, tint-vs-AA contrast table, --radius 0 makes rounded-lg square, multi-class not.toHaveClass trap, why no font-medium, headless font-width measuring
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
- Decision: the active look is a teal tint, `rounded-none bg-primary/10 text-primary
  hover:bg-primary/12 hover:text-primary`. `cn` (tailwind-merge) drops the base `rounded-lg`,
  `text-text2`, `hover:bg-surface2` and `hover:text-foreground` for the active link only, and keeps
  `text-[14px]` (a size, not a colour). The old `bg-surface2` look was invisible: surface2 is within
  ~3% lightness of `--background` in both themes.
- Contrast of `text-primary` on `bg-primary/N` over `--background` (sRGB blend; rendered pixels in
  Chromium come out ~0.05 lower because Tailwind v4 mixes in oklab): light 10% 4.77, 12% 4.63,
  14% 4.50, 15% 4.43 (fails AA); dark 10% 8.21, 15% 7.39. So the light theme caps the tint at ~13%;
  a hover step of /15 looks natural but fails. Recompute when `--primary` or `--background` change.
- `--radius` is `0rem` in globals.css, so `rounded-lg` already renders 0px site-wide; `rounded-none`
  on the active link is a no-op today and only keeps it square if the radius token comes back.
  `getComputedStyle(...).borderTopLeftRadius` shows this quickly.
- jest-dom `expect(el).not.toHaveClass('a', 'b')` passes when ANY of them is missing (it negates
  "has all"), so check absent classes one at a time (`expectNoClass` helper in NavLink.test.tsx).
- `e2e/nav-active.spec.ts` "clicking Features from /pricing" can fail once on a cold dev server
  (URL stays /pricing for 5s); it passes on rerun. The 390px test already retries pre-hydration clicks.
- Measuring font widths headless without a dev server: the Geist woff2 is in
  `.next/dev/static/media/*.p.*.woff2` (the variable-weight one; the other `.p.` file is Geist Mono,
  identical widths at every weight). Load it via `FontFace` from a data URL in a playwright page and
  `canvas.measureText`. From a scratchpad script, import `@playwright/test` by its resolved
  file URL as a default import (CJS: `import pw from '...'; const { chromium } = pw`).
- Tests vary the pathname per test with the hoisted-object pattern ([[vitest-hoisted-mock-state]]):
  re-mock `@/i18n/navigation` with `createNavigationMock` spread plus `usePathname: () => nav.pathname`.
  The mobile panel's accessible name is "Menu" (`nav.mobileMenu`).
