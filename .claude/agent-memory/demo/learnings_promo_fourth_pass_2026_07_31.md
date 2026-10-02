---
name: promo-fourth-pass-storyboard
description: Non-obvious findings from the 2026-07-31 fourth-pass promo rebuild — real chrome.windows.create from popup pages, the dead AddGroupModal trap, input-vs-text-node locator gotcha, and the recordVideo-resolution-vs-zoom sharpness fix.
metadata:
  type: project
---

Context: after three same-day pacing passes on the 4-beat promo cut (see
[[learnings_promo_second_replan_2026_07_31]] and PROMO_VIDEO_SPEC.md's history), the shot list was
replaced entirely with a 10/11-step storyboard walking one full
real workflow (multi-window chaos → create/color a group → copy/close a
window → split a tab into a new window → cross-window drag → rename → star).
Full writeup: PROMO_VIDEO_SPEC.md's "Fourth pass" section.

**`chrome.windows.create` works from inside the popup page's own
`page.evaluate()`** — no extension-side change or content-script trick
needed. The recorded page IS an extension page (`chrome-extension://...`),
so it carries the extension's own permissions. Used this to open 3 real
separate browser windows (5 tabs each) for the redesigned `chaosHook`,
instead of 40 tabs in one window — `Windows/index.tsx` renders one
`WindowItem` card per real `chrome.windows.Window`, so multiple real windows
show up as multiple distinct messy cards in "Now Open" for free, no new UI
needed.

**`Modal/AddGroup.tsx` (name+color dialog) is dead code** — grepped every
call site, nothing calls `openModal('addGroup')`. The REAL "Add Group" flow
(`SidePanel/index.tsx`'s `handleNewGroup`) creates a group immediately with
`DEFAULT_GROUP_TITLE` ("temp group") and auto-opens the sidebar's inline
rename input via `setRenameTarget` — same GroupItem.tsx input-swap mechanism
`renameGroup` already drives, just auto-triggered instead of via dblclick.
Before touching any UI flow you haven't personally exercised end-to-end in
this codebase, grep for what ACTUALLY calls the component/handler you're
assuming — a component existing and being wired up are different facts.

**Locator gotcha: a freshly-created row that starts already in "rename mode"
has NO text node to grab.** First version of `createGroup` tried
`getByText("temp group")` to find the new row's container (same pattern as
`renameGroup`, which dblclicks an EXISTING text node). It timed out forever
— not a race condition, a structural mismatch: the row renders straight into
an `<input value="temp group">`, and an `<input>`'s `value` is a form-control
property, invisible to `getByText`/text-node locators (unlike `renameGroup`,
which converts an existing static text node into an input AFTER the
dblclick). Fix: just grab `page.waitForSelector("input", {state:"visible"})`
directly when you know nothing else has an open input at that point in the
flow. Diagnosed via a disposable standalone script
(`launchDemoContext` + `page.locator("body").innerText()` after the click) —
faster than guessing from re-reading component code, and it's a
throwaway file (write outside git or delete immediately after, don't leave
debug scripts in the repo).

**Rename/edit beats need a post-commit hold, not just the trigger.** Review
of the cut showed (twice) that a rename/edit-style beat needs to show the RESULTING UI change (the new label
actually appearing), not just the moment the input is edited. Fix pattern
applied to every rename/edit action (`createGroup`, `colorNewGroup`,
`renameGroupTab`, and retrofitted onto the existing `renameGroup`/
`renameTab`): (1) add `zoom: 1.3` on the `DemoStep` (existing field, just a
centered CSS `scale()` — see [[learnings_promo_second_replan_2026_07_31]]'s zoom notes for why it
needs enough recorded resolution headroom), (2) add a 700-1000ms
`page.waitForTimeout()` in the action AFTER the `Enter`/click that commits
the change, holding on the settled UI state before the step ends. Same
underlying principle as the drag-reorder fix from an earlier pass: show the
EFFECT of the action, not just the trigger.

**Two-array pattern for promo-only steps**: new promo-storyboard steps that
aren't part of the full 17-step walkthrough's viewing order live in a
separate `promoOnlySteps: DemoStep[]` export in `demo-script.ts`, NOT
appended to `demoScript` itself. `record.ts`'s `recordedSteps` becomes
`[...demoScript, ...promoOnlySteps].filter(...)` so both get recorded in one
pass (shared steps like `chaos-hook` are deduped naturally — same id, same
file target). Keeps the full walkthrough's step count/order untouched while
still letting `record.ts` stay the single place that knows what to record.

**`record.ts` ALWAYS wipes its entire recordings dir at the start of
`main()`** (`fs.rmSync(RECORDINGS_DIR, {recursive:true,force:true})`) —
manually deleting individual stale `.webm` files before a re-run to force
re-recording just those steps is pointless busywork; the whole dir gets
nuked either way. If iterating on ONE step's action code, there's no partial
re-record shortcut today — every `record.ts` run re-records everything.

**`zoom` must be an animated in/hold/out effect, never a static scale held
for a whole beat.** First implementation of the rename-beat zoom (`zoom: 1.3`
applied as a flat `transform: scale(step.zoom)` for the entire clip) failed
review badly (nothing around the action was visible) — a
multi-second clip pinned at 1.3-1.5x loses all surrounding context, it isn't
a subtle emphasis, it's a disorienting crop for the whole shot. Fixed with a
`ZoomVideo` component in `Composition.tsx` that animates `scale` via
`interpolate()` across 5 keyframes as FRACTIONS of the sequence's own padded
duration (normal → ramp in → held zoom → ramp out → normal), self-contained
per step regardless of that step's actual `durationMs` — no per-step tuning
needed, works for both `chaos-hook`'s establishing-shot zoom and the shorter
rename-beat zooms. Lesson: `zoom`/crop-in on a `DemoStep` should default to
"temporary emphasis," never "held for the whole clip" — if a future zoom
need ever DOES want a full-clip static crop, that has to be an explicit,
separate opt-in, not the default behavior of the `zoom` field.

**Remotion's `<OffthreadVideo>`/`<Img>` default to `object-fit: contain`, not
`cover` or a stretch-to-fill.** This is the ROOT CAUSE of a "popup doesn't
fill the frame, empty space around it, even during zoom" report — the
composition (800x600) and recording (1200x900) dimensions were a red herring
(both exactly 4:3, no real mismatch); the actual bug was that `contain` was
never overridden, so any tiny aspect slop in the encoded `.webm` shows as
letterbox bars, and since `object-fit` is a separate CSS property from a
`transform: scale()` zoom, the bars persist through zoom in/out too — a
transform doesn't touch object-fit at all. The default class
(`OBJECTFIT_CONTAIN_CLASS_NAME` in `remotion/dist/.../default-css.js`) is
deliberately written with low CSS specificity specifically so it's meant to
be overridden via an inline `style` prop — Remotion expects every real
composition to set its own `objectFit`, `contain` is just a safe fallback so
nothing crashes with zero style. Any `<OffthreadVideo>`/`<Img>` in this
pipeline that's meant to fill its container edge-to-edge needs
`style={{ objectFit: "cover" }}` explicitly — it is NOT the default, and this
bit twice in one session (first the zoom-hold-static bug, then this).

**On this sandbox, Bash tool calls after a long-running `record.ts`/
`remotion render` process routinely exceed their timeout and get
auto-backgrounded**, even trivial ones like `ls` — the machine is genuinely
CPU-saturated by ~20+ real Chromium processes during a multi-window
recording pass (each `chrome.windows.create` spawns real renderer
processes). Poll with a `while ! grep -q "<done-marker>" logfile; do sleep
15-20; done` loop with a long `timeout` (up to 590000ms) piped to a log file
via `> file.log 2>&1` in a `run_in_background: true` call, rather than
relying on captured stdout from the background task's own output file
(which was empty/unreliable for the actual `record.ts` process in this
session — always write to a real log file and poll THAT).
