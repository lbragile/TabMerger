---
name: learnings-preview-images-opt-in
description: Making the tab-preview OG-image fetch opt-in (default off) and removing dead content-script code paths
metadata:
  type: project
---

Made "Show page images in previews" an opt-in setting (default OFF) in `useAppSettings.ts`
(`showPreviewImages`), because `TabPreview.tsx` was unconditionally calling
`getPageMetaForTab()` → `GET /api/og-preview?url=...` on hover, sending every hovered tab's
URL to TabMerger's own server regardless of user consent — a real gap against the "no tab
content leaves your device" privacy claim.

Non-obvious findings:

- **Two separate, similarly-named things both fetch "the OG image" — don't conflate them.**
  `src/components/Windows/TabPreview.tsx` (the actually-rendered tooltip, wired into
  `Tab.tsx`) calls `getPageMetaForTab()` from `src/lib/tabAccess.ts` — this is the real,
  live code path and is what needed the setting gate + POST switch. `src/hooks/useTabPreview.ts`
  is a *separate*, textbook-perfect-looking hook with its own `fetchOgImage()` — it is **not
  imported by any component**, only exercised by its own test file. Grepping for the hook name
  before assuming it's live saved a wasted detour; when a hook exists with no component
  importer, treat its "removal" as low-risk API-compat cleanup, not a behavior change.
- **The content script this endpoint predates is fully gone**, but three call sites still
  had dead `chrome.tabs.sendMessage(id, { type: 'GET_PAGE_META' })` paths that can never
  succeed (always throws → caught → null): `useCurrentTabs.ts`'s `fetchOgImageForTab`/
  `backfillOgImages`, `useTabPreview.ts`'s `fetchOgImage`, and (left untouched, out of this
  task's explicit scope) `useGroups.ts`'s inline sendMessage in the move-tab mutation — same
  bug class, flag it if asked to do a fuller sweep later.
- **`Tab.ogImage` is legacy and nothing writes a *new* value into it anymore** — it's only
  ever carried forward (useCurrentTabs.ts on Now Open rebuild, useGroups.ts on tab
  move/duplicate) from a value that, in practice, is never freshly set post-content-script-
  removal. The opt-in preview-image fetch is deliberately kept separate: its result is local
  component state in `TabPreview.tsx`, shown in the tooltip only, never written back to
  `tab.ogImage` or persisted anywhere. Document this distinction inline (see
  `packages/shared/src/types/index.ts` and `useTabPreview.ts`'s JSDoc) — otherwise a future
  reader will assume the setting populates `ogImage` and try to persist it, which would be
  a privacy regression (storing a fetched-URL fingerprint on the tab record).
- **shadcn `Switch` + `Label` in this codebase aren't `htmlFor`-linked** — none of the
  Settings toggles have an accessible name derivable from the visible `<Label>` text; RTL's
  `getByRole('switch', { name: ... })` fails silently by matching nothing unless you add an
  explicit `aria-label` to the `Switch`. Existing tests sidestep this with
  `getAllByRole('switch')[index]`, which is index-order-fragile — inserting a new toggle
  anywhere before the last one shifts every subsequent index-based test. Prefer adding
  `aria-label` on any *new* toggle you add (did this for `showPreviewImages`) rather than
  perpetuating index coupling, and when you do insert a new switch, grep the test file for
  `getAllByRole('switch')[` and re-derive every index by hand — the failure mode is a
  passing-looking assertion on the wrong switch, not a crash.
- **Opt-in-with-confirmation pattern**: reused the existing `openModal(type, data)` +
  `ModalRoot` switch pattern (same as `clearAllData`/`resetEncryption`) for a "confirm before
  turning on" gate — clicking the toggle ON doesn't flip local draft state directly; it opens
  a modal whose `data.onConfirm` closure (captured from the Settings component's own
  `patch()`) is invoked only if the user clicks through. Cancel leaves the closure uncalled.
  Turning OFF is direct/no confirmation. Same caveat as the other two: opening the confirm
  modal replaces the Settings modal in `ModalRoot` (only one `modal.type` at a time) — the
  user has to reopen Settings after confirming/cancelling. Acceptable here since it matches
  established precedent in this codebase, not a new UX regression.
- Full-suite `vitest run` on this machine is unreliable for hook/test timeouts under real
  parallel load (~180s+ import time observed) — `background.test.ts` and
  `OtherDevices.test.tsx` both timed out in a full run but passed instantly in isolation.
  Don't chase these as real regressions without re-running the specific file first with a
  bumped `--testTimeout`/`--hookTimeout`.
