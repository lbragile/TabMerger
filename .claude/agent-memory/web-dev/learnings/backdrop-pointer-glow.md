---
name: backdrop-pointer-glow
description: Pointer-following backdrop on the error pages and /uninstalled (ShellBackdrop + 'use client' ShellGlows) — client-module helper export 500s server pages, -z-10 parent/background rules, fixed vs absolute layer trade-offs, jsdom gaps, rAF/matchMedia test harness, light-mode glow tokens + AA maths
metadata:
  type: reference
---

`ShellBackdrop` (in `components/errors/ErrorPageShell.tsx`, server-safe) wraps `ShellGlows`
(`components/errors/ShellGlows.tsx`, `'use client'`): the main glow sits exactly under the pointer,
a second glow trails (lerp), and a 4rem grid shows only in a circle around the pointer. Used by
the 404, the `error.tsx` boundaries, `global-error.tsx` (all through `ErrorPageShell`) and
/uninstalled. Decision: the rest of the site stays plain; a site-wide version and hero versions
were built and then dropped.

- **Never export a plain helper from a `'use client'` module for a server component to call.**
  Unit tests (jsdom ignores the directive), lint and tsc all pass, but every server page calling
  it 500s: "Attempted to call gridLines() from the server but gridLines is on the client". Put
  shared helpers in a directive-free module, and load a real page after adding a server→client
  import.
- **Parent rules for an `absolute -z-10` layer:** the parent needs `relative isolate`
  (+ `overflow-hidden`). Only the parent's own background paints below the layer; an in-flow
  child with `bg-background` covers it.
- **Fixed site-wide variant (if ever revisited):** `fixed inset-0 -z-10 overflow-hidden` in the
  root layout sits above the canvas (body background propagates there) and survives client
  navigation, but every opaque full-area wrapper (hero `bg-background`, Footer `bg-background`,
  auth page roots) must lose its background. Glows that overflow a positioned section paint over
  the next section's text, so fade inside the section instead of overhanging.
- **jsdom gaps:** no `matchMedia` (treat as static, so other page tests need no stub), and it
  drops `mask-image` gradients with `rgba()` or many stops from the style attribute. Assert on
  exported config, not the DOM style, for those.
- **Hydration-safe pointer state:** write custom properties imperatively from the effect, use
  `var(--g1x, 0px)` fallbacks in render, and gate the grid with `opacity: var(--lit, 0)` (an
  opacity transition is fine for fade in/out; never transition `transform`, it adds lag).
- **Light-mode glow colours** are tokens in `globals.css` (`--glow-1/2`, `--glow-*-alpha`,
  `--grid-lit`, `.dark` overrides). Contrast maths: alpha-composite the glow colours over
  `--background` and compute WCAG ratios in a small Python script. At teal 0.15 + orange 0.10,
  text2/text3 stay ≥4.7:1 even where both glows overlap; `--primary` small text drops to ~4.3:1
  only in that overlap.
- Test harness (`__tests__/ShellGlows.test.tsx`): a matchMedia stub that can flip a query and fire
  its `change` listeners, a manual rAF queue (`step(n)`), and a mocked rect offset from the viewport
  origin so the rect-relative maths is exercised.
- Visual check without the chrome-devtools MCP: a CommonJS script in the scratchpad that
  `createRequire`s `@playwright/test` from packages/web, moves the mouse, and compares the glow's
  bounding-box centre with the pointer. `/sentry-test` throws in an event handler, so it does
  not reach an error boundary.
- Tailwind v4 `--radius-xl/2xl/3xl` were `calc(var(--radius) + …)`, so they stayed rounded with
  `--radius: 0`; they now scale (`* 1.25/1.5/1.75`).
