---
name: learnings-recently-closed-plan-display
description: Recently closed - the popup lists only what the plan keeps (entriesShownForPlan in useRecentlyClosed), the popup's confirmed-Free catch-up prune, and why selected sidebar rows are font-bold (popup renders the platform UI font)
metadata:
  type: reference
---

**The list is limited where it is read, not where it is shown.** `useRecentlyClosed()` applies
`entriesShownForPlan(stored, plan)` (lib/recentlyClosed.ts, worker-safe) before grouping into
days, and returns `plan`. Every consumer (sidebar rows + header count, `MainPanel`'s day lookup /
ClosedDayView, Ctrl+K closed results, Settings count) therefore agrees. Free's rule
(`newestDayKeys`: newest `recentDays` local days with a non-cleared entry, at least one) is the
same function `planPrune` uses, so the Free list never shows a day the next prune deletes.
`useRecentlyClosedPlan()`: `unknown` while `useEntitlements` loads (lists everything), `free` /
`pro` after.

Why storage alone was not enough: pruning to Free is lazy (worker start sweep, or the trim after
the next recorded close) and only when the worker's plan resolves KNOWN Free. A plan check that
failed or timed out (3 s) is `unknown` = Pro limits, and a remembered paid `AUTO_SAVE_TIER_SEEN_KEY`
answer is trusted forever, so a Free popup could list more days than "Free keeps your last 2 days".

**Popup catch-up prune** (`useTrimRecentlyClosedForPlan`, mounted by the sidebar section, once per
mount via a ref): when the popup shows Free it calls `trimRecentlyClosedIfFree()`
(lib/recentlyClosedPlan.ts), which re-resolves with `{ fresh: true }` (skips a remembered answer
when signed in, asks the server, remembers the answer for the worker) and prunes only on a
confirmed `free`. Never prune on `useEntitlements`' Free alone: `fetchSubscription` returns `null`
on a read error, which resolves to `free` for an offline Pro user. Signed-out on a store an account
owns with no usable remembered answer stays `unknown` (deliberate: that account may be paid).
`resolveRecentlyClosedPlan` lives in lib/recentlyClosedPlan.ts and is re-exported by the recorder
(so the popup doesn't pull in the recorder module); tests that `vi.mock` its dependencies by id
keep working.

**Fonts in the popup.** No web font is bundled; the popup computed `"Segoe UI", Tahoma,
sans-serif` on Windows (not Inter / `--font-sans`). Weight 600 renders the real Segoe UI Semibold
(checked with CDP `CSS.getPlatformFontsForNode`), but at 11px it barely differs from 400, so the
selected sidebar states are `font-bold` (700, `SegoeUI-Bold`): `sidebarRowNameClass(true)` and the
expanded `SidebarSection` label. The active GROUP row stays `font-semibold`. E2E asserts the
computed weight (`toHaveCSS('font-weight', '700')`), not a class.

Testing:
- Sidebar day list is `max-h-28 overflow-y-auto`: a 4th row (and the Free note) sits below the
  fold, so a screenshot can show 2 rows under a "(3)" header without the count being wrong.
- Real-hook section test: `RecentlyClosedSectionPlan.test.tsx` mocks `recentlyClosedDb`,
  `recentlyClosedPlan`, `useEntitlements`, and `useAppSettings` WITH `APP_SETTINGS_QUERY_KEY`
  (useRecentlyClosed imports it).
- `useRecentlyClosed.test.tsx` resets every value of its hoisted `h` with `mockReset()`, so plain
  values (tier, loading) go in a separate hoisted object.
- `sed -i` in Git Bash drops CRLF line endings; restore with a Python CRLF round trip.

Related: [[learnings-recently-closed-engine]], [[learnings-recently-closed-ui]],
[[test-mocks-follow-hook-usage]].
