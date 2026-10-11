## Status update (2026-09-26)

Everything below this point is the ORIGINAL planning doc and is stale in
several places — kept for history, not as current instructions. The actual
source of truth for what's in the promo/walkthrough today is
`demo-script.ts`'s `promoScript`/`demoScript` exports. Corrections as of this
pass:

- The extension's DnD stack was fully rebuilt on a dual pointer/native-HTML5
  sensor since this doc was written (`docs/drag-and-drop-spec.md`).
  `drag-reorder` (the old id referenced throughout this doc) no longer exists
  as a step; the real drag beats today are `dragTabBetweenGroups` (a
  same-window reorder, despite the name), `crossWindowTabDrag` (within one
  group, across its windows), `moveTabToNewWindow` (split into a new
  window), and — added this pass, per direct coordinator ask that the video
  explicitly SHOWCASE the newer multi-select and cross-group capabilities,
  not just keep working with them — two new dedicated beats:
  - **`multi-select-drag`** ("Drag many tabs at once.") — Ctrl-click two real
    seeded Shopping tabs (visible `bg-primary/10` selection highlight, held
    on screen before the drag starts), then drag by one selected row's grip;
    `dndMultiDrag.ts` carries every selected row along.
  - **`cross-group-drag`** ("Move tabs between groups.") — drags a tab out of
    "Reading List" straight onto the "Shopping" sidebar row
    (`[data-sidebar-group-index]`), landing as a new last window in that
    group per the DnD spec's §6 Outcomes table — a real cross-group move,
    not a same-group reorder.
  Both are folded into `demoScript` (via `fromPromo`) and `promoScript`, with
  the same zoom/caption treatment as every other beat.
- **AI features are hidden** (`VITE_AI_ENABLED` unset) — nothing in this doc
  ever mentioned AI, and nothing added this pass does either. No change
  needed here, confirmed by grep.
- **Headless recording**: `lib/launchDemoContext.ts` now defaults to
  `--headless=new`. Every DRAG step (all 6 named above) does not work
  headless — the native `dragstart` the popup's sensor needs never fires for
  Playwright's synthetic mouse input under Chromium's new headless mode (see
  `README.md`'s "Known headless gap" section for the full root-cause writeup
  and the extension e2e suite's raw-CDP workaround). `TM_DEMO_HEADED=1` is
  required to actually record/screenshot this storyboard until `actions.ts`
  is ported to that same raw-CDP drag pattern. Every non-drag step already
  works headless.
- This doc's own "Structure"/"Second-by-second shot list" sections below
  reference stale step ids (`drag-reorder`, `view-groups`, `star-window`,
  etc.) from an earlier storyboard rewrite (2026-08-01) that are no longer
  in `demo-script.ts` at all — treat the CURRENT `promoScript` array as
  authoritative for exact ids/order/captions, not the tables below.

---

# TabMerger Promo Video Spec (Chrome Web Store)

Planning document only — no code changes here. Grounded in what `demo-script.ts`,
`Composition.tsx`, `Root.tsx`, and `record.ts`/`launchDemoContext.ts` can already produce.
An editor or an agent should be able to execute this against the existing pipeline with
targeted edits, not a rebuild.

## Target & secondary cuts

| Cut | Length | Priority |
|---|---|---|
| Chrome Web Store listing | 30–60s | **Primary — build this first** |
| Product Hunt | 30–45s | Secondary — trim of the primary cut |
| Landing-page hero | 60–90s | Secondary — primary cut + 1–2 extra feature beats |

The pipeline renders one Remotion composition at one duration; there is no built-in
"render 3 lengths from one script" mechanism today. Practical approach: add a new
`WalkthroughPromo` composition (short step subset) alongside the existing
`WalkthroughDemoDark/Light` full-walkthrough ones in `Root.tsx`, reusing the same
`recordings/<theme>/<step-id>.webm` clips already recorded for the full demo — no new
Playwright recording pass needed for steps that already exist. Product Hunt = same
composition with fewer trailing steps clipped by duration; landing-page hero = the
promo composition + 1 extra scene (see §Shot List note at 0:40).

## What's actually recordable today (source of truth: `demo-script.ts`)

Existing steps with real recorded footage, in script order:
`hook` (text card) → `open-popup` → `settings-walkthrough` → `view-groups` →
`tab-preview` → `drag-reorder` → `change-color` → `star-window` → `add-note` →
`rename-group` → `rename-tab` → `star-group` → `stale-tabs` → `selection-mode` →
`search` → `undo` → `outro` (text card).

Every non-text-card step already has a caption tuned for on-screen text and a
`durationMs` tuned to the real recorded clip length (see `demo-script.ts`'s ponytail
comments on `LEADING_TRIM_MS` and per-step duration tuning). The promo cut should
**pick a subset of these IDs**, not invent new actions.

## Structure (Chrome Web Store cut, ~55s target)

| Window | Beat | Source step(s) |
|---|---|---|
| 0:00–0:10 | Hook & pain point | `hook` (text card, chaos framing) |
| 0:10–0:40 | Core action — one primary feature shown live | `open-popup` → `view-groups` → `drag-reorder` (the single clearest "it just works" action: dragging a tab into a group) |
| 0:40–0:50 | Payoff / success state | `star-group` or `selection-mode` end-state (clean, organized groups) |
| 0:50–1:00 | Call to action | `outro` (text card, retimed to include "Install free" CTA + Chrome Web Store framing) |

This deliberately drops `settings-walkthrough`, `tab-preview`, `change-color`,
`star-window`, `add-note`, `rename-group`, `rename-tab`, `stale-tabs`, `search`,
`undo` from the promo cut — per the golden-standard rule "one primary feature, not a
menu tour." Those stay in the full walkthrough video only.

## Second-by-second shot list

Timestamps are cumulative from 0:00. FPS/frame math follows `Composition.tsx`'s
`msToFrames` (30fps project rate); recording itself should be captured at 60fps per
the technical spec below and conformed down in the timeline, not re-recorded at 30fps.

| Time | Visual | On-screen text | Audio cue |
|---|---|---|---|
| 0:00–0:02 | Text card: dozens of scattered browser tabs, chaotic favicon strip (real or mocked "before" screenshot, not currently in the pipeline — needs a new static asset) | "100 tabs. Zero order." | Music intro, low-key pad, no beat yet |
| 0:02–0:10 | Hold on chaos, slow zoom-in 110%→130% | (text persists, fades at 0:08) | Beat drops at ~0:08 (music kicks up before action starts) |
| 0:10–0:16 | `open-popup` clip — click extension icon, popup opens. Zoom popup viewport to ~160%. Colored cursor halo on the click. | "One click. Everything's here." | UI click foley on the extension-icon click; music stays instrumental |
| 0:16–0:24 | `view-groups` clip — pan across grouped tabs (Work/Research/Shopping/Reading List groups from demo seed data). Sped 1x (this beat needs to read, not rush). | "Every project, its own space." | none extra; music carries |
| 0:24–0:36 | `drag-reorder` clip — the single drag-and-drop action, full speed (this IS the "watch it work in real time" moment per the golden-standard rule — do not speed this one up). Cursor halo tracks the drag. | "Drag a tab. Done." | Success/drop foley (soft chime) synced to the drop frame |
| 0:36–0:40 | Quick sped-up (2–3x) transition — `selection-mode` clip's opening beat, showing multi-select happening fast, as a bridge into the payoff | "Clean up dozens at once." | Whoosh/transition foley |
| 0:40–0:50 | Payoff — `star-group` end-state or a clean full-popup shot of the organized group list, static-ish hold, zoom back to ~130% to show the whole clean popup at once | "Tab chaos, tamed." | Music settles into a resolving phrase |
| 0:50–0:58 | Text card: TabMerger logo + tagline (reuse `outro` text card component, retimed) | "TabMerger — free to start." | Music final chord / fade begins |
| 0:58–1:00 | CTA card: Chrome Web Store badge/icon + "Install free" | "Install free on Chrome" | Music fades to silence, no hard cut |

Total: ~60s, trims to ~45s for Product Hunt by cutting the 0:36–0:40 bridge beat and
shortening the hook to 6s.

## Audio — no-voiceover (resolved)

**Decision made 2026-07-31: no-voiceover confirmed.** The Piper TTS narration
pipeline (`narrate.ts`, the `pnpm narrate` script, per-step `public/audio/{step.id}.wav`
lookup in `Composition.tsx`, `.piper-venv/`/`.piper-voices/` setup docs) has been
**removed entirely** from `packages/demo/` — this pipeline is now instrumental-music-only
by construction, not by convention. See the demo-agent learnings file for what was
touched.

- Music: instrumental only, lo-fi/corporate-tech, 110–125 BPM, no vocals, bg level
  approx. -20 to -25dB, text-overlay timing synced to beat where practical (each
  on-screen text change lands on/near a beat, not mid-bar). Plugs into the existing
  optional `<Audio src={staticFile("audio/track.mp3")}>` in `Composition.tsx` — drop
  a licensed track at `packages/demo/public/audio/track.mp3` (gitignored, no code
  change needed).
- Foley: subtle click sound on the extension-icon open, a soft chime/drop sound
  synced to the drag-and-drop release frame, a whoosh on the sped-up transition.
  None of this exists in the pipeline today — only the single background-music
  `<Audio>` element exists. Foley would need new short audio files dropped in
  `public/audio/sfx/` and new `<Audio>` elements added at specific frame offsets
  inside the promo composition — not yet built.

## Visual/text overlay rules (hard requirements, apply to every card above)

- 3–6 words max per overlay — every line in the shot list above already fits.
- Large, bold, high-contrast text, roughly 15–20% of frame height. Current
  `TextCard`/caption-bar styling in `Composition.tsx` uses 44px text-card font and a
  16px bottom caption bar against an 800×600 canvas — both are undersized for a
  15–20%-of-height promo overlay and would need dedicated styling for the promo
  composition (do not just reuse the walkthrough's caption bar as-is).
  15–20% of a 1080px-tall export is ~160–215px text height.
- Zoom into the popup/browser viewport at 150–200% for legibility — the recordings
  are captured at the popup's native 800×600 box (see `launchDemoContext.ts`
  viewport). Achieving a 150–200% zoom in the final export means either (a)
  scaling/cropping the `OffthreadVideo` element in the promo composition's CSS
  transform, or (b) re-recording at a higher `deviceScaleFactor` and cropping
  tighter in Playwright. (a) is the lazy option and should be tried first.
- Colored cursor halo on clicks — `record.ts`'s `clickWithRipple` helper (referenced
  in `demo-script.ts`'s comments) already draws a click ripple via `addInitScript`
  during recording. Confirm its color matches brand color and radius is visible at
  150–200% zoom; if not, this is a small tweak to the existing ripple script, not a
  new feature.
- Speed up boring parts 2–3x — no existing step needs this for the *walkthrough*
  cut (durations are already tuned tight), but the promo cut's 0:36–0:40 bridge beat
  explicitly calls for a 2–3x speed on `selection-mode`'s footage. Remotion supports
  this via wrapping the `OffthreadVideo` in a `<Sequence>` with a smaller
  `durationInFrames` than the source and setting `playbackRate` — not currently used
  anywhere in `Composition.tsx`, would be new for the promo composition only.

## Technical recording/export checklist

- [ ] **Resolution**: export at 1920×1080 (16:9). Current compositions in `Root.tsx`
      render at 800×600 (native popup size) for the walkthrough and 1280×800/440×280/
      1400×560 for store stills — none is 1920×1080. The promo composition needs its
      own `<Composition>` entry at `width: 1920, height: 1080` with the popup content
      composited/scaled inside a larger canvas (matches the "zoom into the popup"
      requirement above — the popup won't fill 1920×1080 natively).
- [ ] **Recording FPS**: 60fps requested. `record.ts`/Playwright's `recordVideo` and
      `Composition.tsx`'s `FPS = 30` are both currently 30fps end-to-end. Bumping
      Playwright's `recordVideo.fps`-equivalent (Playwright doesn't expose a direct
      fps knob for `recordVideo`; frame rate is roughly a function of page activity)
      and the Remotion composition's `fps` prop to 60 both need auditing — verify
      this doesn't break `LEADING_TRIM_MS`/`msToFrames` math (all frame counts are
      derived from `FPS`, so a 60fps promo composition needs `FPS = 60` used
      consistently, not a mix).
- [ ] **Clean browser profile**: check `launchDemoContext.ts` — it launches a
      persistent context pointed at a dedicated demo profile dir with
      `--load-extension` for TabMerger only, and no evidence it also strips a
      default bookmarks bar, other extension icons, or sets a generic Chrome avatar
      name/color. This is a **gap**, not confirmed-clean: before recording promo
      footage, an extension-dev-owned change (or a Chrome launch-args addition in
      `launchDemoContext.ts`) is needed to (1) hide the bookmarks bar
      (`--hide-bookmarks-bar` or profile pref), (2) ensure only TabMerger's icon
      shows in the toolbar (a fresh profile should already have no other extensions,
      but verify `EXTENSION_PATH` is the only `--load-extension` entry), (3) set a
      neutral profile avatar/name if any profile-picker chrome is visible in frame
      (unlikely at popup-only viewport, but check if the full browser chrome around
      the popup is ever visible in any promo shot — none of the shots above show
      the full browser window, all are popup-only recordings zoomed in, so this may
      be moot for the promo cut specifically, but matters if the hook's "chaotic
      tabs" shot is a real full-window screen recording rather than a mock image).
- [ ] **Hook shot asset**: the 0:00–0:10 "chaotic tab bar" visual does not exist in
      the current pipeline — every existing `hook` step is a text-only card (no
      screenshot of an actual messy window). Need either (a) a genuinely messy
      Chrome window screen-recorded separately (outside the demo-mode extension
      profile, since demo mode's seed data is intentionally tidy), or (b) a
      designed static illustration. Flag as new asset work, not a script reuse.

## 30s fast cut (executed 2026-07-31, replanned 2026-07-31)

Shorter/snappier alternative to the 60s cut above, per user decision. Implemented as
`promoScript` in `demo-script.ts`, rendered via `PromoDark`/`PromoLight` compositions
in `Root.tsx` (`WalkthroughDemo` takes an optional `script` prop instead of being a
second component).

**Viewer feedback on the first render**: shot selection wasn't intuitive enough. The
concrete complaint — "drag and drop should be dragging the item" — was a real bug,
not a subjective call: `dragTabBetweenGroups` (`lib/actions.ts`) never simulated an
actual pointer drag. It right-clicked a tab and used the "Move to group" context-menu
item as a scripting shortcut (chosen originally because `@dnd-kit`'s `PointerSensor`
seemed flaky to drive via synthetic events). The result was a before/after jump-cut
with zero visible drag motion — captioned "One drag. Tab sorted." over a clip that
never showed anything being dragged. **Fixed**: `Tab.tsx` already exposes a real
`useSortable` drag handle (`aria-label="Drag to reorder tab"`), and `useDndSensors`'
`PointerSensor` only needs 5px of movement to activate (`useDnd.ts`) — trivial for
real `page.mouse.move/down/up` events. `dragTabBetweenGroups` now does a real
pointer-drag reordering two tabs within the Work group: mouse down on the grip
handle, a small activation nudge, a stepped move to the midpoint with a 400ms hold
(so the recording reads as "dragging," not "teleporting"), a stepped move to the
drop target with another 400ms hold, then release. No extension-side change needed —
the drag affordance already existed, it just wasn't being driven correctly.

**Shot order also replanned**, not just the one clip:

| Beat | Step id | Duration | Reasoning |
|---|---|---|---|
| Intro logo card | — | 800ms | unchanged |
| Hook | `promo-hook` | 2200ms | "100 tabs. Zero order." — states the pain before any UI appears |
| Open popup | `open-popup` | 2718ms | "One click. Every tab, right here." — the fix arrives |
| View groups | `view-groups` | 3600ms | "Every project, its own space." — payoff of the fix: tabs are organized |
| Drag reorder | `drag-reorder` | 4200ms | caption changed to **"Drag to reorder — organize your way"** — now that the clip shows a real drag, the text should name the benefit (control over order) not just repeat the action |
| Star group | `star-group` | 2568ms | caption changed to **"Star a group — it jumps to the top"** — old caption ("Pin it. Floats right below Now Open.") assumed the viewer already knows what "Now Open" is; rewritten so it's self-contained |
| Outro | `promo-outro` | 2500ms | "TabMerger — tab chaos, tamed. Free to start." |

**Dropped**: `selection-mode`. `toggleSelectionMode`'s action only reveals checkboxes
and ticks two of them — no bulk close/merge ever fires on screen, so there's no
visible payoff, just a UI-state change a first-time viewer can't attach meaning to.
That arc (select → then act on the selection) needs more screen time to land than a
promo beat affords; it stays in the full walkthrough, where the surrounding context
carries it. Removing it also tightens the "fast cut" pace further.

Total: 24.4s → now ~20.6s (durationMs for open-popup/view-groups/drag-reorder/
star-group unchanged from the full walkthrough's tuned values — see
`.claude/agent-memory/demo/learnings_promo_render_2026_07_31.md` for why truncating
real footage looks broken rather than snappy; pace comes from which scenes are
dropped, never from cutting a remaining one short).

**Hook shot asset resolved 2026-07-31**: the "chaotic tab bar" gap flagged in the
technical checklist below is filled with real footage, not an illustrated graphic,
per coordinator decision. New `chaosHook` action (`lib/actions.ts`) opens 40 real
tabs (cycling a pool of realistic sites — Gmail, Calendar, Slack, GitHub, Notion,
arXiv, etc., `waitUntil: "commit"` so it doesn't stall waiting for full page loads)
on the same browser context, then lets the popup's own "Now Open" group (which
mirrors real `chrome.tabs` state) render that genuinely large live list and
scrolls partway down for depth. New `chaos-hook` step in `demoScript` (shared by
both the full walkthrough and the promo cut — single source of truth, not
duplicated) carries this. Zoom was needed: native 800×600 capture of 40 rows reads
as noise, not "overwhelming," at 1:1 — added an optional `zoom` field on `DemoStep`
(`1.5` here) that `Composition.tsx` applies as a centered CSS `scale()` on the
`OffthreadVideo`, clipped by a new `overflow: hidden` wrapper. The caption ("100
tabs. Zero order.") renders via the same caption-bar overlay every other step
already gets — no separate text-only card anymore, so `promoScript`'s old
`promo-hook` text card was deleted outright in favor of reusing `chaos-hook`.

**Rendered this pass** (both themes, silent — no `public/audio/track.mp3` sourced
yet): `packages/demo/out/tabmerger-promo-dark.mp4`,
`packages/demo/out/tabmerger-promo-light.mp4`. 800×600/30fps (native popup capture,
NOT the 1920×1080/60fps target from the technical checklist below — not attempted
this pass). Everything else in the technical checklist below (resolution, foley,
music, clean-profile confirmation) still applies unchanged to this cut; the real
hook asset item is now resolved, see above.

## Second replan (2026-07-31, same day): 4-beat ~32s cut

The 20.6s five-beat cut above was itself found unclear on viewing — direct user
feedback: too many beats crammed into too little time, insufficient hold per beat
to register what's happening. **Approved trade-off: dropped the sub-30s target in
favor of a slower, clearer 4-beat cut.** Total beat time is now ~32s (plus the
existing 1.5s intro logo card, for ~33.5s end to end) — clarity over a hard cap.

| Time (beats only) | Duration | Step id | Caption | Notes |
|---|---|---|---|---|
| 0:00–0:05 | 5.0s | `chaos-hook` | "100 tabs. Zero order." | unchanged from first replan; `durationMs` bumped 2400→5000 on the shared `demoScript` entry |
| 0:05–0:14 | 9.0s | `open-popup` | "One click. Every tab, right here." | `durationMs` bumped 2718→9000 on the shared entry — action itself settles in ~2.7s, the rest is a hold on the clean group list so the "instantly organized" payoff actually registers |
| 0:14–0:25 | 11.0s | `drag-reorder` | "Drag to reorder. Your way." | `durationMs` bumped 4200→11000 on the shared entry — the beat that most needed breathing room; plays at full/real speed with no rush |
| 0:25–0:32 | 7.0s | `promo-outro` (text card) | "TabMerger — install free" | was 2500ms; bumped for a real CTA hold |

**Dropped entirely** (not shortened): `view-groups` (redundant now that
open-popup's extended hold already shows the organized-groups payoff) and
`star-group` (confirmed with the user as the weakest, least self-explanatory beat
even with a rewritten benefit-first caption — same root problem as the earlier
`selection-mode` cut: a first-time viewer can't attach meaning to a single
UI-state change with no visible payoff in isolation).

Implementation note: the three reused steps' `durationMs` were bumped directly on
the shared `demoScript` entries (not overridden only in `promoScript`), since
`record.ts` only ever records from `demoScript` — the extra time is a real
`runStepAction` hold on each step's settled end-state (action finishes early,
`page.waitForTimeout` fills the rest), the same "durationMs is a record-time
minimum" mechanism already used everywhere else in this pipeline, not a new
Remotion-side freeze/hold. This also gives the full walkthrough video slightly
longer holds on those three beats — a harmless, unrequested side effect of the
single-source-of-truth design (see `learnings_promo_replan_2026_07_31.md`).

**Rendered this pass** (both themes, re-recorded + re-rendered, silent):
`packages/demo/out/tabmerger-promo-dark.mp4`,
`packages/demo/out/tabmerger-promo-light.mp4`. 1005 frames at 30fps = 33.5s total
(45-frame/1.5s intro card + exactly 960 frames/32.0s across the four beats, matching
the approved plan). Still 800×600/30fps native popup capture, not the
1920×1080/60fps golden-standard target.

## Third pass (2026-07-31, same day): pacing fix — dead air trimmed, one beat restored

Direct feedback on the 32s/33.5s cut from the second replan: the opposite problem from
before — "too little happening with too much time between scenes." Root cause,
confirmed by re-reading `actions.ts`'s real per-step waits rather than guessing:

- `open-popup` (9000ms): the `openPopup` action itself only ever did a single 500ms
  wait. The other ~8.5s (minus the ~2.7s the popup takes to visually settle) was pure
  `runStepAction` idle time — a frozen frame on the unchanging group list.
- `drag-reorder` (11000ms): `dragTabBetweenGroups`'s own waits sum to ~2.0s of real
  motion (activation nudge, two stepped-move holds, drop). The remaining ~8.8s was
  the same kind of idle hold on the already-dropped tab.
- `promo-outro` (7000ms text card): more than 2x `demoScript`'s equivalent outro card
  (3392ms) for a static CTA slide — same static-hold pattern.

**Fixes applied**:
- `open-popup`: `durationMs` 9000 → 3000. `openPopup` (`lib/actions.ts`) no longer
  just waits — it now moves the cursor across the Work/Research sidebar rows during
  the hold, so the beat stays visually active instead of trimming to a bare freeze-
  frame or leaving dead time.
- `drag-reorder`: `durationMs` 11000 → 4000 (real ~2.0s motion + a short ~1s hold on
  the sorted result + leading-trim buffer) — trimmed, no action changes needed since
  the drag itself already reads clearly at real speed.
- `promo-outro`: `durationMs` 7000 → 4000.
- Trimming the dead air alone dropped the promo to ~13s beat time — too sparse to
  read as a promo cut on its own. `view-groups` (dropped in the second replan only
  because it was redundant with open-popup's old extended static hold, **not** for a
  clarity problem — unlike `star-group`, which stays dropped) is reintroduced at a
  tight 2900ms between `open-popup` and `drag-reorder`, restoring a full ~20s runtime
  while keeping every beat constantly active.

**New promo beat table** (beats only, intro card adds another 1.5s):

| Beat | Step id | Duration | Caption |
|---|---|---|---|
| Chaos hook | `chaos-hook` | 5000ms | "100 tabs. Zero order." (unchanged) |
| Open popup | `open-popup` | 3000ms | "One click. Instantly organized." |
| View groups | `view-groups` | 2900ms | "Every project, its own space" |
| Drag reorder | `drag-reorder` | 4000ms | "Drag to reorder. Your way." |
| Outro | `promo-outro` (text card) | 4000ms | "TabMerger — install free" |

Total: 1500 + 5000 + 3000 + 2900 + 4000 + 4000 = **20,400ms (~20.4s)**, chosen over
forcing a specific second count — every beat now has continuous visible motion, no
stretch exceeds ~1.5s of static hold.

**Rendered this pass**: `packages/demo/out/tabmerger-promo-dark.mp4`,
`packages/demo/out/tabmerger-promo-light.mp4`.

### Sharpness check (same pass, unrelated to pacing)

Checked `.claude/agent-memory/demo/learnings_video_blur_devicescalefactor.md`
against the current recording config to confirm this session's changes (theme
wiring, chaos-hook's 40-tab seeding, the `zoom` transform in `Composition.tsx`)
didn't regress it:

- `launchDemoContext.ts`'s `deviceScaleFactor` param is still `2` for both
  `record.ts` and `screenshots.ts` callers — not reverted.
- **Found a real, separate sharpness bug**: `record.ts`'s `recordVideo.size` was
  still pinned to `800x600` — the popup's native CSS size — regardless of
  `deviceScaleFactor`. `chaos-hook` applies `transform: scale(1.5)` to its
  `OffthreadVideo` in `Composition.tsx` (needed so the 40-tab clutter reads as
  "overwhelming" rather than tiny favicons), which was upscaling an
  already-800x600-resolution encoded source to 1200x900 at render time — softening
  specifically that shot on top of any encoder loss, exactly the failure mode the
  coordinator flagged.
- **Fix**: bumped `record.ts`'s `recordVideo.size` to `1200x900` (still 4:3, no
  letterboxing) — the resolution `chaos-hook`'s zoom actually displays at. Every
  other (non-zoomed) step now records at a higher native resolution than its
  800x600 display box too, which is a supersampling improvement, not a regression.

## Fourth pass (2026-07-31, same day): full storyboard replacement

The 4-beat ~20.4s cut from the third pass was superseded entirely (not
extended) by a new 10/11-step storyboard walking one complete real workflow:
messy multi-window chaos → create a named, colored group → copy a window into
it → close the clutter → split a tab into a new window → drag a tab between
two existing windows → rename a tab → star a window → CTA.

**Chaos hook redesigned**: no longer 40 tabs in one window — `chaosHook`
(`lib/actions.ts`) now calls `chrome.windows.create` three times, directly
from the popup page's own `evaluate()` (popup pages carry the extension's
`chrome.windows` permission, no extension-side change needed), opening 3 real
separate browser windows with 5 unique tabs each. `Windows/index.tsx` renders
one `WindowItem` card per real window, so "Now Open" now shows 3 distinct
messy window cards stacked in the popup — a clearer "multiple messy windows"
visual than one giant tab list, using the existing rendering with zero new UI
code.

**Every new beat maps to a real, already-shipping feature** — verified in
`useGroups.ts`/`useDnd.ts`/the actual component JSX before writing each
action, not assumed:

| Beat | Step id | Real feature |
|---|---|---|
| Create group | `create-group` | `SidePanel/index.tsx`'s `handleNewGroup` — creates immediately with a default name and auto-opens the sidebar's inline rename input |
| Color it | `color-new-group` | The swatch-dot color picker (same entry point as `changeGroupColor`) |
| Copy window into group | `copy-window-to-group` | `Window.tsx`'s "Copy to group" context-menu entry (`useMoveWindow`) |
| Close the window | `close-now-open-window` | Same menu's "Close window" entry (`useDeleteWindow`) |
| View the group | `view-new-group` | Sidebar navigation |
| Split a tab into a new window | `move-tab-new-window` | The real drag-to-new-window zone in `Windows/index.tsx` (`newWinDropRef`/`isOverNewWin`) |
| Drag a tab between two windows | `cross-window-tab-drag` | `handleDragEnd`'s "Cross-window: splice from src, insert at dest" branch — confirmed supported today |
| Rename a tab | `rename-group-tab` | Reuses `renameTab`'s proven focus/caret-reset fix, scoped to the new group |
| Star a window | `star-group-window` | `useToggleWindowStarred` (distinct from group-level `useToggleGroupStar`) |

**One correction found during implementation**: the storyboard's "create
group / give it a color / give it a name" was first assumed to be one modal
(`Modal/AddGroup.tsx`, which does have a combined name+color form) — that
component is actually **dead code**, nothing in the popup calls
`openModal('addGroup')` (verified by grepping every call site). The real
"Add Group" button creates the group immediately and drops straight into the
sidebar's inline rename input; color is a fully separate click. Fixed to
2 real actions (`create-group` covers create+name as one atomic flow,
`color-new-group` is separate), not the 3 originally assumed or the 1
initially (wrongly) implemented — the first implementation tried to locate
the new group by its default "temp group" TEXT, which never worked because
the row renders already inside an `<input>` (rename mode from the instant
it's created), and an `<input>`'s value is invisible to text-node locators.
Found via a standalone debug script (`page.locator("body").innerText()`
after the click) rather than guessing.

**Rename/edit beats get extra treatment** per direct feedback that these
beats need to show the resulting UI update, not just the trigger:
`create-group`, `color-new-group`, `rename-group-tab`, and the full
walkthrough's existing `rename-group`/`rename-tab` all got a `zoom` (1.3, via
`Composition.tsx`'s existing per-step `zoom` field) and a longer hold
(700-1000ms) added to their action's end, AFTER the Enter/click commits, so
the actual text/color change in the UI is on screen long enough to read —
not frozen at the moment of interaction.

**New promo-only steps** live in a separate `promoOnlySteps` array in
`demo-script.ts`, not appended to the full-walkthrough `demoScript` array —
they're real new actions but aren't part of the 17-step walkthrough's viewing
order. `record.ts` records `[...demoScript, ...promoOnlySteps]` (deduped by
id; `chaos-hook` is shared and only recorded once).

Total runtime: **~40.8s** (1224 frames at 30fps, confirmed by the actual
Remotion render progress log) — 1500ms intro + 5000ms chaos-hook + 9
promo-only beats + 4200ms outro. Chosen over the coordinator's 45-60s upper
range deliberately: every beat already carries its full real-action time plus
only a short reading buffer (longer on the three rename/edit beats
specifically) — padding further to hit a bigger number would just
reintroduce the "too little happening" static-hold problem from the third
pass.

**Rendered this pass** (both themes): `packages/demo/out/tabmerger-promo-dark.mp4`
(3.6 MB), `packages/demo/out/tabmerger-promo-light.mp4` (3.5 MB).

### Zoom bug fix (same pass, urgent correction)

The `zoom` field was implemented as a STATIC scale held for a beat's entire
duration — a whole clip pinned at 1.3-1.5x for several seconds, which reads
as unreadable/disorienting, not an emphasis effect. Fixed in
`Composition.tsx`: a new `ZoomVideo` component animates `scale` across 5
keyframes as fractions of the beat's own duration — normal (0-15%) → ramp in
(15-30%) → held zoomed on the action/result (30-70%) → ramp out (70-88%) →
normal (88-100%) — instead of a flat, unconditional `transform`. Applies
automatically to every step with `zoom` set (`chaos-hook`, `rename-group`,
`rename-tab`, `create-group`, `color-new-group`, `rename-group-tab`) with no
per-step change needed. Render-only fix (no re-recording required — the
source `.webm` clips are unaffected, only how `Composition.tsx` displays
them). Both themes re-rendered after the fix.

### Letterboxing fix (same pass, urgent correction)

User-reported: the popup view doesn't fill the frame — empty space/bars
around it, persisting through the zoom in/out. Root cause: Remotion's
`<OffthreadVideo>`/`<Img>` apply a default `object-fit: contain` CSS class
(`OBJECTFIT_CONTAIN_CLASS_NAME` in `remotion/dist/.../default-css.js` —
deliberately low-specificity so it's meant to be overridden via inline
`style`, which we never did). `contain` fits the video INSIDE its box
without cropping — any slop between the recorded `.webm`'s actual encoded
aspect ratio and the 800x600 composition canvas shows as empty bars, and
since `object-fit` and the zoom `transform` are independent CSS properties,
the bars persisted through zoom too, exactly as reported. Composition and
recording dimensions were NOT the mismatch (both 800x600/1200x900 are 4:3) —
this was a missing CSS property the whole time. Fixed with one inline style,
`objectFit: "cover"` (`FILL_FRAME_STYLE` in `Composition.tsx`, applied to
both the zoomed and unzoomed `<OffthreadVideo>` paths) — fills the frame
edge-to-edge unconditionally, cropping a sliver of overflow instead of ever
showing empty space. Render-only fix, no re-recording needed. Both themes
re-rendered after the fix.

## Open questions for the user

1. ~~Voiceover vs. instrumental-only~~ — **Resolved 2026-07-31**: no-voiceover
   confirmed, Piper narration pipeline removed from `packages/demo/` entirely
   (see Audio section above).
2. **Music sourcing/licensing**: no royalty-free track is currently checked into
   `packages/demo/public/audio/`. Does the user have a licensed track already, or
   does sourcing one (e.g. Epidemic Sound, Artlist, YouTube Audio Library) need to
   be scoped as separate work before this spec can be executed end-to-end?
3. **Multiple aspect-ratio/length cuts — now or later?**: is building the
   Product Hunt (30–45s) and landing-page hero (60–90s) variants in scope for this
   pass, or should this spec's execution focus only on the primary 30–60s Chrome
   Web Store cut and treat the others as a later follow-up?
4. **Hook shot source**: is a real "messy window" screen recording acceptable (and
   if so, whose browser/tabs — needs to look authentic, not staged), or should this
   be a designed graphic instead? Affects whether this needs a Playwright recording
   pass outside demo mode or a design-system asset.
5. **New `WalkthroughPromo` composition scope**: confirm it's acceptable to add a
   new Remotion `<Composition>` (1920×1080, new FPS, new promo-specific step subset)
   alongside the existing walkthrough/store-asset compositions in `Root.tsx`, rather
   than trying to force the existing 800×600/30fps `WalkthroughDemo` composition to
   serve both purposes.

## Feature tour

A separate roughly 60-90s, 1920x1080 tour that also shows browser windows, drawn in Remotion as Chrome-style windows (see README "Feature tour"). Each scene is its own component in `remotion/tour/registry.ts` and is reviewed and approved before the next is built.

| # | Scene | Status |
|---|---|---|
| 1 | The mess: three browser windows crammed with tabs | Built (4.5s), accepted |
| 2 | Open TabMerger: the same windows and tabs appear in "Now Open", next to the browser windows | Built (6.5s), accepted |
| 3 | Drag a window into a new group, name it, colour it | Built (10.7s), accepted |
| 4 | Organise by dragging (a tab into its own window, then several tabs at once into another group) | Built (8.5s), accepted |
| 5 | Rename and annotate | Built (7.5s), accepted |
| 6 | Find a tab | Built (6.1s), accepted |
| 7 | Restore: open a saved group and the browser windows come back | Built (6.8s), accepted |
| 8 | Share a group (Pro) | Built (6.8s), accepted |
| 9 | Sync across devices (Pro) | Built (4.0s), accepted |
| 10 | Settings | Skipped. Decision: left out; in the recording build Settings is only reachable through the account menu, which shows account details, and the build's settings view includes a development-only tab |
| 11 | Closing card (the 10th scene in the registry, id `closing-card`, since Settings is skipped) | Built (4.0s), accepted |

Tour thumbnail (a still, also the first frame of the tour video): built in dark and light. See README "Feature tour" (`render:tour-thumbnail`).

Final tour (both themes): the thumbnail intro (30 frames fully opaque, then an 8-frame dissolve), the nine feature scenes and the closing card (scene 8 of the original plan, Settings, was skipped), 2072 frames = 69.07 s at 1920x1080, 30 fps, with optional synthesised sound effects only (no music, no transition sounds, no third-party audio so no credits needed; about -19.7 LUFS integrated, -1.9 dBTP true peak; nothing is tied to a scene cut; `audio:tour`, `audio:chart`) and silent variants (`render:tour-dark-silent`, `render:tour-light-silent`). Per-scene mp4s exist for both themes (`render:tour-scene <id> [dark|light]`). See README "Feature tour".
