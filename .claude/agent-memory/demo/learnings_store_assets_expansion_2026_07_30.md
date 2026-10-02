---
name: learnings-store-assets-expansion-2026-07-30
description: Expanding screenshots.ts to per-theme captures (light+dark) surfaced two leftover-overlay bugs in actions.ts that only bite on a full sequential run, not caught before because the old set of 4 steps ran too small a slice of demo-script.ts
metadata:
  type: project
---

Expanded `screenshots.ts` from a single-theme, 4-step capture set to 6 features x 2 themes
(`open-popup`, `view-groups`, `change-color`, `add-note`, `search`, `selection-mode`), each saved
as `${stepId}-${theme}.png`, by looping `launchDemoContext(undefined, 2, theme)` once per theme
instead of a single untheme'd pass + one bolted-on `enableDarkMode()` call at the end. Removed
`enableDarkMode()` from `lib/actions.ts` entirely — dead code once real theme-per-context (the
`launchDemoContext` `theme` param, IndexedDB-backed) replaced it; it also only did the
localStorage-only trick that `launchDemoContext.ts`'s own comments say doesn't actually stick
(`useTheme.ts`'s mount effect clobbers it).

Running the full demo-script sequentially, twice (once per theme), surfaced two leftover-DOM-state
bugs in `lib/actions.ts` that a smaller/single-theme run never hit hard enough to fail on:

1. **Radix Tooltip opens on focus, not just hover** — `changeGroupColor`'s last click leaves its
   swatch/sidebar-row DOM-focused, and Radix Tooltip triggers on `focus-visible` as well as
   `:hover`. `page.mouse.move(0,0)` alone does NOT dismiss it (it only fixes the *hover*-based
   leftover-tooltip case, e.g. after `tabPreview`). Needed an explicit
   `document.activeElement.blur()` in addition to the mouse move.

2. **Dismiss `SearchOverlay.tsx` by clicking its backdrop** — it closes through a
   `<div className="fixed inset-0 z-40" onClick={onClose} />` backdrop. `searchTabs`'s action
   clears the query text but never dismisses the overlay, so its full-screen backdrop stays
   mounted and blocks every subsequent step's clicks (manifests as `<div class="fixed inset-0
   z-40">... intercepts pointer events` on whatever the NEXT step tries to click, which can look
   unrelated to search at first glance). Fixed by clicking the backdrop locator (`div.fixed.inset-0.z-40`)
   directly, wrapped in `.catch(() => null)` since it's a no-op when no overlay is open.

**General pattern:** `screenshots.ts` reuses ONE page across the whole `demoScript` loop per theme
(same as `record.ts`'s per-step-fresh-page model does NOT apply here — screenshots.ts is one
continuous session). Any step whose action leaves focus/an overlay/a tooltip open, rather than
returning the page to a "neutral" state before the next step's assertions run, is a landmine that
only detonates once enough *other* steps come after it in the same run. The fix belongs in a
shared per-step cleanup (now in `screenshots.ts`'s loop body: Escape-equivalent backdrop click +
blur + mouse move, in that order) rather than patching each action handler individually — this
mirrors the existing `POST_CLICK_PAUSE_MS` pattern in `actions.ts` (fix once in the shared loop,
not scattered per call site).

`render-store-assets.ts` already rendered BOTH `PromoSmall` and `PromoMarquee` — no wiring gap
existed there, contrary to the assumption that it might only cover one. Verified real image
output (not just "file exists") by reading the rendered JPEGs back with the Read tool — confirms
correct per-theme popup content, not a blank/placeholder frame.

Output locations:
- Raw per-theme PNGs: `packages/demo/screenshots/raw/{stepId}-{light,dark}.png` (+ theme-neutral
  `multi-window.png`, captured once in the dark pass only — it's a small corner inset, not a
  theme-comparison image)
- Composited Chrome Web Store screenshots: `packages/demo/screenshots/store/*.jpg` (1280x800)
- Promo tiles: `packages/demo/promo/small-tile.jpg` (440x280), `packages/demo/promo/marquee-tile.jpg`
  (1400x560) — marquee's light/dark split uses `open-popup-light` + `view-groups-dark` specifically
  (not a matching pair) per the existing "don't pair identical scenes" decision in `PromoTile.tsx`.

See also [[learnings_theme_pipeline_execution]], [[learnings_store_assets]].
