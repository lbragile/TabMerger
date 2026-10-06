---
name: store-listing-facts
description: Non-obvious facts for keeping CHROMEWEBSTORE.md / FIREFOXADDONS.md accurate (short description source, analytics activity per build, asset pipeline)
metadata:
  type: reference
---

- The Chrome dashboard summary is read from the manifest `description` (`wxt.config.ts`), so a
  listing short description (132 chars max) only goes live if that string is changed too.
- Which analytics run in store builds is decided by `publish.yml` env, not by code: it sets only
  `VITE_WEB_APP_URL` and the Supabase vars. PostHog (`VITE_POSTHOG_API_KEY`) and Sentry
  (`VITE_SENTRY_DSN`) are no-ops there; GA4 goes through the website `/api/track` proxy and is
  active whenever `VITE_WEB_APP_URL` is set. Re-check the data-use form if either key is added.
- Favicons fall back to Google's favicon service by site origin (`getFaviconUrl` in
  `src/lib/utils.ts`): it counts as a transmission of browsing-related data for the data-use form.
- `alarms` and `notifications` are used only for user-set reminders (`background.ts`), not sync.
- Store assets: `pnpm demo:screenshots` writes raw 1600x1200 PNGs to
  `packages/demo/screenshots/raw/`; `pnpm demo:store-assets` composites 1280x800 JPEGs to
  `screenshots/store/` and the 440x280 / 1400x560 tiles to `promo/`. Compare capture dates with
  `git log` on `packages/extension/src/components` to judge whether screenshots are outdated.
