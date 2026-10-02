---
name: learnings-undo-scene-and-env-flakiness-2026-07-30
description: Undo-scene narrative fix (Remove tab -> Undo, not Ctrl+Z), star-window highlight suppression, sharp-corner styling, and a real environment limitation that blocked a full record/render verification pass
metadata:
  type: project
---

## Undo scene (demo-script.ts id "undo" / actions.ts `undoAction`)

The undo scene was *already* using the real Header "Undo" button (`clickWithRipple(page.getByRole("button", { name: "Undo" }))`) by the
time this task started — a prior pass had removed the stale `Ctrl+Z` keypress simulation from the action handler but had NOT updated:
1. `demo-script.ts`'s caption, still literally "Oops? Ctrl+Z has your back" — fixed to "Oops? Undo has your back".
2. The "why would you undo" setup beat — it toggled a window star (not visibly destructive/undesirable) rather than doing something
   that reads as an actual mistake. Changed `undoAction` to right-click a real seeded tab and click the destructive "Remove tab"
   menuitem (`Tab.tsx` ~line 385, `text-destructive` styled) first, let the tab's absence sit on screen, THEN click the real Undo
   button, then let the restored tab sit — a proper before/oops/after beat.
3. **Tab choice matters**: `undoAction` runs LAST in the script but reuses the SAME persisted profile/IndexedDB across all steps
   (one Playwright context, one page per step). By the time `undoAction` runs, `dragTabBetweenGroups` (an earlier step) has already
   moved the Work group's "Gmail" tab into Research, and `renameTab` has already renamed "Sprint Notes" to "Weekly Sync Notes" — so
   neither of those are safe anchors for a later step. Used "Q3 Planning" (Work group, demoData.ts) instead — untouched by any other
   step in the script. **General rule**: before picking a `getByText(...)` anchor for a step near the end of demoScript, check
   whether any earlier step's action already renamed/moved/removed that exact tab/group text — the shared-profile-across-steps
   design (see [[selectors_and_app_mode]]) makes this a real, recurring trap, not hypothetical.

## Star-window highlight (demo-script.ts id "star-window" / actions.ts `starWindow`)

`window.starred` applies a REAL, correct `borderLeftColor` tint via inline `style` + `border-l-2` class (`Window.tsx` ~line 125/182)
the instant the star button is clicked — this is NOT a leftover hover/focus artifact, it's intended product behavior (and is what the
step's own caption used to describe: "its border lights up in your group color"). Decision: the recording should show the
star *click* but not linger on/end on the resulting colored-border state. Previous version of this step deliberately added an 800ms
wait specifically to let that border render on screen before the clip cut ("Give the UI time to apply the group-color left border
before the clip ends" — now-removed comment). Fixed by immediately clicking a different sidebar item (`"Research"`) right after the
star click instead of waiting, so the clip moves off the starred window's card. If a future ask wants NEITHER the click nor the
border shown at all, that's a different, harder problem (the two effects are synchronous on the same click) — would need a demo-only
CSS override injected via `addInitScript`, not a timing fix.

## Composition.tsx / launchDemoContext.ts sharp-corner styling

Two independent hardcoded roundings, both now `border-radius: 0`:
- `Composition.tsx`'s caption bar div (`borderRadius: 8` → `0`, in the per-step `<Sequence>` overlay).
- `launchDemoContext.ts`'s injected `.tm-key-badge` CSS (`border-radius: 999px` → `0`) — this is the modifier-key press pill
  (Ctrl+A/Enter/etc. badges), styled via a `<style>` tag injected through `addInitScript`'s `__tmKeyBadge`, NOT part of Composition.tsx
  at all — easy to miss half of this ask if you only grep Composition.tsx.

## Real environment limitation hit during this task — record.ts could not complete a full pass

`npx tsx record.ts dark` was attempted ~8 times in this sandboxed Windows environment and never completed a full run — Chrome
(`launchPersistentContext` with `--load-extension`) crashed mid-script every time, at inconsistent points (anywhere from step 2 to
step 8 of ~15), each time producing a Crashpad `.dmp` file under `.pw-user-data/Crashpad/reports/`. Compounding failure modes
observed, in order of frequency:
1. **OneDrive file locking** — this repo lives under a synced OneDrive folder; freshly-written `.webm` recordings and
   `.pw-user-data` profile files are frequently still open/locked by OneDrive's real-time sync scan at the exact moment
   `record.ts`'s own `fs.rmSync` (start-of-run cleanup) or Playwright's post-crash cleanup tries to delete them, throwing
   `EBUSY: resource busy or locked`. Not fixable by retrying instantly — needs a `sleep` (several seconds) between `taskkill` and
   `rm -rf .pw-user-data`/`public/recordings/<theme>`, and sometimes still needs a second retry.
2. **Stale zombie `chrome.exe`/`chrome-headless-shell.exe` processes accumulate** across failed attempts (each crash leaves orphans)
   and eventually cause `browserType.launchPersistentContext: Opening in existing browser session` — the fix is
   `taskkill //F //IM chrome.exe //T` (and `chrome-headless-shell.exe`) before every retry, not just once at the start.
3. Even after a clean kill + clean profile + clean recordings dir, Chrome still crashed mid-script on every attempt in this
   session — never reached the render step. This reads as a genuine sandbox resource constraint (memory/handle pressure from
   video-encoding a headed browser session over many minutes), not a bug introduced by this task's code changes.

**Net effect**: the `demo-script.ts`/`actions.ts`/`Composition.tsx`/`launchDemoContext.ts` code changes in this task were verified by
careful source reading (selectors cross-checked against the real `Tab.tsx`/`Window.tsx`/`demoData.ts` components) but NOT verified via
an actual rendered frame extraction — unlike every prior learnings entry in this file's history, which all had real frame
verification. **If this recurs**: don't keep blindly retrying `record.ts` in a resource-constrained/OneDrive-synced sandbox — after
~3 clean-retry attempts, report the blocker instead of continuing to burn the session on it, and recommend the user run the record/
render pipeline from a non-sandboxed shell (or a non-OneDrive-synced repo checkout) where a long-lived headed Chrome session is
stable.

See also [[selectors_and_app_mode]], [[learnings_theme_pipeline_execution]].
