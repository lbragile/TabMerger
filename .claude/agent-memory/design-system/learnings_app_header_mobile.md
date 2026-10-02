---
name: app-header-mobile
description: The signed-in web header (app/(app)/layout.tsx) overflowed phones; how it's made to fit, and how to check any page at phone width while signed in
metadata:
  type: project
---

The signed-in header in `packages/web/app/(app)/layout.tsx` (dashboard, account) had no mobile
layout: logo + "TabMerger" + labelled Dashboard/Account buttons + sync pill + theme toggle + avatar
in one row measured **442px on a 390px phone**, so every signed-in page scrolled sideways and the
avatar menu (the only way to sign out) was off-screen. The marketing header already had
`MobileNavToggle`; the app header was simply never checked at phone width. Fixed 2026-09-30.

**Pattern used (keep it when adding anything to this header):**
- Below `sm`, hide text, keep icons: the wordmark and the nav labels are
  `<span className="hidden sm:inline">`, and the links carry `aria-label` ("Dashboard",
  "Account", "TabMerger home") so they keep an accessible name when icon-only. The logo `<Image>`
  gets `alt=""` because the link is already named.
- Side gutter `px-4` (16px) below `sm`, `sm:px-8` above, on BOTH the header container and `<main>`.
- Left group `min-w-0`, right group and logo `shrink-0` (see web-dev's navbar-flex-collapse note:
  a next/image in a squeezed flex row can collapse to 0x0).
- The sync pill (`SyncIndicator`) already hides itself below `sm`; anything new in the right-hand
  group needs the same treatment or it pushes the avatar off-screen again.
- Budget: at 360px the row has ~328px; icon-only left side ≈ 120px, theme toggle + avatar ≈ 75px.

**How to verify (do it for any change to a signed-in page):** a screenshot can hide overflow, so
measure it. Headless Playwright at widths 360, 390 and 1280, compare
`document.documentElement.scrollWidth` with `window.innerWidth` (must be equal) and the header's
`scrollWidth`. Signed-in pages need a session: create a throwaway, already-confirmed user in the
LOCAL Supabase with the admin API (`POST /auth/v1/admin/users` with the local service-role key from
`supabase status -o json`, `email_confirm: true`), then sign in through `/auth/sign-in`. Never do
this against a hosted project.

Related: [[flex-img-collapse-mobile]] (web-dev learnings).
