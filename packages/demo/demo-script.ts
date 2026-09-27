// Single source of truth for the walkthrough recording — consumed by both
// record.ts (drives Playwright) and remotion/Composition.tsx (captions/timing).
//
// ponytail: every recorded clip opens with a brief spinner/blank-white
// loading flash (React mount + IndexedDB/TanStack Query resolve) that
// Playwright's video recording captures regardless of any wait in
// actions.ts — recordVideo starts at page creation, before any wait
// resolves, so the wait shortens but never eliminates it from the .webm.
// Composition.tsx trims exactly this much off the start of every
// OffthreadVideo via `startFrom`. record.ts adds the SAME amount as extra
// minimum record time (on top of each step's own durationMs) so the trimmed
// source clip still has durationMs worth of real content left after the
// cut — otherwise trimming would silently eat into the END of every step's
// action instead (see demo-learnings.md).
// ponytail: bumped 450 -> 2000 (2026-08-01) after directly inspecting real
// recorded frames (ffprobe/ffmpeg, not `remotion still` alone — needed to
// confirm the bug lived in the SOURCE .webm, not Composition.tsx) — this
// dev machine's popup mount (React + IndexedDB/TanStack Query resolve,
// heavier here since Now Open now carries 15 real seeded tabs across 3
// windows plus 4 saved groups) genuinely still shows the loading spinner
// 1.0-1.5s in on every step sampled (chaos-hook, create-group, open-popup),
// nowhere close to clearing by the old 450ms assumption. 2000ms is a safety
// margin above every observed clear time. Re-verify with real frame
// extraction (not just a wait-based fix — see the big comment below) any
// time this machine/environment characteristics change meaningfully.
export const LEADING_TRIM_MS = 2000;

export interface DemoStep {
    id: string;
    caption: string;
    durationMs: number;
    action: string;
    // Pure on-screen-text scene — no extension recording, rendered as a
    // styled title card by Composition.tsx instead of an OffthreadVideo.
    // record.ts/screenshots.ts skip these (nothing to capture).
    textCard?: boolean;
    // Optional CSS scale applied to this step's OffthreadVideo in
    // Composition.tsx (centered crop-zoom, e.g. 1.5 = 150%) — TEMPORARY
    // emphasis only: Composition.tsx's ZoomVideo ramps in, holds, then ramps
    // BACK OUT to 1x before the step ends, it is never a static/permanent
    // zoom for a whole clip. Omit for the normal 1:1 crop every other step
    // uses.
    zoom?: number;
}

// ponytail: durations do DOUBLE DUTY — record.ts's runStepAction uses each
// step's durationMs as a MINIMUM recording time, but Composition.tsx's
// <Sequence> uses the exact same number as a HARD CAP on playback. A step
// whose real recorded action (clicks/typing/ripple pauses) runs longer than
// its durationMs doesn't fail the recording — it just silently gets
// truncated at render time (freezes mid-animation). Always re-check a step's
// real recorded clip length via ffprobe after changing its action in
// actions.ts, and set durationMs to the observed max(dark, light) length +
// ~300-400ms buffer, rather than estimating from the waits in the code.
//
// ponytail: FULL STORYBOARD REWRITE (2026-08-01) — the prior demoScript was a
// 17-beat "highlight reel" walking many unrelated features (search, undo,
// selection mode, stale tabs, ...) seeded from static demoData.ts groups.
// Replaced end to end per direct coordinator ask with ONE complete real
// workflow that starts from a real cluttered browser and ends with a fully
// organized group: cluttered real browser (multiple windows/tabs) -> popup
// shows it all in Now Open -> create a new group -> color it -> copy a
// window into it -> organize its tabs across windows (split + cross-window
// drag) -> rename the windows -> leave one a note -> rename a tab -> outro.
// Every non-textCard action below is real — verified against the actual
// component before writing it (see actions.ts's per-step comments), nothing
// faked or invented.
//
// `promoOnlySteps` is defined FIRST in this file (previously came after
// `demoScript`) because most of demoScript's new beats below are literally
// the SAME real action as an existing promo beat (create/color a group, copy
// a window in, organize it, rename a tab) — `fromPromo()` pulls those
// verbatim by id instead of redefining them, so the full walkthrough and the
// promo cut share the exact same recorded clip and can never silently drift
// out of sync on durationMs. `closeNowOpenWindow` and `starGroupWindow`
// (promo-only) are intentionally NOT reused here — the storyboard the
// coordinator gave doesn't call for closing the source window or starring a
// window, pulling them in would add beats nobody asked for.
export const promoOnlySteps: DemoStep[] = [
    // ponytail: SPLIT into two real steps — the first version of this beat
    // assumed "Add Group" opens a name+color dialog; it doesn't (see
    // createGroup's ROOT CAUSE comment in actions.ts — the button creates
    // the group immediately and auto-enters the sidebar's inline rename
    // input, color is a fully separate action via the swatch dot). Both are
    // zoomed in and hold on the committed UI update per the rename/edit-beat
    // feedback (see actions.ts's per-step comments).
    // ponytail: durationMs values below (2026-08-01) are measured, not
    // estimated — via ffprobe on the real recorded .webm clips from both
    // theme passes. Formula: `max(dark, light) recorded length -
    // LEADING_TRIM_MS - 200ms safety margin`. NOT `+` a buffer — durationMs
    // is Composition.tsx's HARD playback cap on footage that's already had
    // LEADING_TRIM_MS trimmed off the front; if durationMs exceeds the
    // remaining trimmed footage, playback runs past the end of the actual
    // recorded content (dead/blank frames), which is worse than a plain
    // jump-cut. Every step here recorded LONGER than its old (smaller)
    // durationMs+trim floor — real action time (extension IndexedDB/React
    // re-render latency on this machine, not just actions.ts's own scripted
    // waits) already exceeded every old estimate — so `runStepAction` never
    // padded any of these; the observed clip length IS the real action
    // length, with no trailing hold baked in. Re-measure after any
    // actions.ts change to these actions.
    {
        id: "create-group",
        caption: "New group. Name it your way.",
        durationMs: 8800,
        action: "createGroup",
        zoom: 1.3,
    },
    {
        id: "color-new-group",
        caption: "Color it to spot it at a glance.",
        durationMs: 4280,
        action: "colorNewGroup",
        zoom: 1.3,
    },
    {
        id: "copy-window-to-group",
        caption: "Copy a whole window into a group. One click.",
        durationMs: 6960,
        action: "copyWindowToGroup",
    },
    {
        id: "close-now-open-window",
        caption: "Close the clutter — it's already saved.",
        durationMs: 6400,
        action: "closeNowOpenWindow",
    },
    {
        id: "view-new-group",
        caption: "Every project, its own space.",
        durationMs: 4040,
        action: "viewNewGroup",
    },
    {
        id: "move-tab-new-window",
        caption: "Split a tab into its own window.",
        durationMs: 5760,
        action: "moveTabToNewWindow",
    },
    {
        id: "cross-window-tab-drag",
        caption: "Drag a tab between windows. It just works.",
        durationMs: 7040,
        action: "crossWindowTabDrag",
    },
    // Zoomed in and given extra hold time after commit (see actions.ts's
    // renameGroupTab comment) so the tab's label visibly updating to
    // "Launch Repo" reads clearly — not just the rename click.
    {
        id: "rename-group-tab",
        caption: "Give any tab its own name.",
        durationMs: 9160,
        action: "renameGroupTab",
        zoom: 1.3,
    },
    {
        id: "star-group-window",
        caption: "Star a window — it stands out instantly.",
        durationMs: 4480,
        action: "starGroupWindow",
    },
    // ponytail: added 2026-09-26 per direct coordinator ask — the promo/
    // walkthrough must SHOWCASE multi-select drag and cross-group drag
    // explicitly, not just cross-window drag within one group
    // (crossWindowTabDrag) or a same-window reorder (dragTabBetweenGroups —
    // see that handler's own comment on its misleading name). See
    // actions.ts's multiSelectTabDrag/dragTabToSidebarGroup for the real UI
    // paths (Ctrl-click multi-select, drop onto a sidebar group row).
    // durationMs values are measurement placeholders (LEADING_TRIM_MS +
    // observed action time + buffer, same convention as every other step in
    // this file) — re-measure via ffprobe on the real recorded clips once
    // record.ts has run against these two new actions, per this file's
    // top-of-file durationMs convention comment.
    {
        id: "multi-select-drag",
        caption: "Drag many tabs at once.",
        durationMs: 7200,
        action: "multiSelectTabDrag",
        zoom: 1.3,
    },
    {
        id: "cross-group-drag",
        caption: "Move tabs between groups.",
        durationMs: 6800,
        action: "dragTabToSidebarGroup",
        zoom: 1.3,
    },
];

// Pulls a step verbatim (id/caption/durationMs/action/zoom, all of it) out
// of promoOnlySteps by id — see the big ponytail comment above for why
// demoScript reuses several of these instead of redefining them.
function fromPromo(id: string): DemoStep {
    const step = promoOnlySteps.find((s) => s.id === id);
    if (!step) throw new Error(`fromPromo: no promoOnlySteps entry with id "${id}"`);
    return { ...step };
}

export const demoScript: DemoStep[] = [
    // Dedicated hook scene — sets up the problem before any UI is shown,
    // per the "on-screen text gets its own scene" rule.
    {
        id: "hook",
        caption: "100 tabs open. Zero idea where anything is.",
        durationMs: 3694,
        action: "",
        textCard: true,
    },
    // ponytail: real recorded chaos, not a mock graphic — actions.ts's
    // chaosHook opens 3 real separate browser windows (5 real tabs each) via
    // chrome.windows.create, so "Now Open" renders 3 distinct messy window
    // cards. zoom: 1.5 crops in tight so the clutter reads as "overwhelming"
    // at native 800x600 rather than a wall of tiny favicons (see
    // Composition.tsx's zoom handling — ramps in/out, never a static crop).
    // ponytail: 2026-08-01 — chaosHook now ALSO closes launchDemoContext.ts's
    // own seed window right after creating these, so Now Open ends up
    // showing ONLY these 15 real tabs — no leftover extra windows from setup
    // (explicit coordinator constraint: no staged content beyond the real
    // seeded chaos this step itself creates).
    // durationMs measured via ffprobe (see promoOnlySteps' comment above on
    // the measurement/safety-margin convention) —
    // max(dark,light) - LEADING_TRIM_MS - 200ms.
    {
        id: "chaos-hook",
        caption: "3 windows. Dozens of tabs. Zero order.",
        durationMs: 6320,
        action: "chaosHook",
        zoom: 1.5,
    },
    // Popup opens on the settled chaos — cursor moves across a couple of Now
    // Open window cards during the hold (see actions.ts's openPopup) so
    // there's real motion on screen, not a static frame.
    {
        id: "open-popup",
        caption: "Switch to TabMerger. Every tab, already here.",
        durationMs: 9720,
        action: "openPopup",
    },
    fromPromo("create-group"),
    fromPromo("color-new-group"),
    fromPromo("copy-window-to-group"),
    fromPromo("view-new-group"),
    fromPromo("move-tab-new-window"),
    fromPromo("cross-window-tab-drag"),
    // ponytail: NEW action (2026-08-01) — Window.tsx's own inline rename
    // (double-click the window title), distinct from renaming a GROUP or a
    // TAB (both already demonstrated elsewhere in this storyboard). See
    // actions.ts's renameWindow for the same 50ms auto-focus/caret-reset
    // race fix every other rename action in this file needs.
    {
        id: "rename-window",
        caption: "Rename each window so it's obvious at a glance.",
        durationMs: 8560,
        action: "renameWindow",
        zoom: 1.3,
    },
    // ponytail: NEW action (2026-08-01) — Window.tsx's real window-level
    // note feature (right-click -> Add note -> inline textarea -> Ctrl+Enter
    // commits), distinct from the group-level note feature. See actions.ts's
    // addWindowNote.
    {
        id: "add-window-note",
        caption: "Leave yourself a note on any window.",
        durationMs: 9840,
        action: "addWindowNote",
        zoom: 1.3,
    },
    fromPromo("rename-group-tab"),
    fromPromo("multi-select-drag"),
    fromPromo("cross-group-drag"),
    {
        id: "outro",
        caption: "TabMerger — tab chaos, tamed. Free to start.",
        durationMs: 3392,
        action: "",
        textCard: true,
    },
];

// 30s-ish fast-paced Chrome Web Store / social promo cut (see
// PROMO_VIDEO_SPEC.md). Reuses the SAME recorded .webm clips as the full
// walkthrough for every non-text step — record.ts/screenshots.ts key
// recordings by step id, and these ids match demoScript's, so no separate
// Playwright recording pass is needed for this cut. Only the two text-card
// bookends (chaos-hook's caption is reused as-is, promo-outro is unique) are
// specific to this cut, and being textCard-free/textCard:true respectively,
// the outro never touches record.ts/the recordings dir at all.
//
// ponytail: durationMs values for the reused steps are copied VERBATIM
// (via the shared literals in promoOnlySteps/demoScript above, not
// shortened) — those numbers are already tuned to each clip's real recorded
// length. Cutting a real action clip short freezes mid-animation, which
// reads as broken, not "fast" — pace instead comes from which scenes are
// included, not truncating the ones that remain. `closeNowOpenWindow` and
// `starGroupWindow` stay promo-exclusive (see the big comment above
// demoScript for why they're not in the full walkthrough too).
//
// ponytail: 2026-09-26 — REPLANNED per direct user ask: "make the pace
// faster so it's less than 30s" (this cut was 82.9s). Cut from 11 beats down
// to the 4 strongest + the outro, per the user's own priority list ("keep
// chaos -> organized, multi-select drag, cross-group/cross-window drag, and
// the closing brand card") — dropped create-group/color-new-group/
// copy-window-to-group/close-now-open-window/view-new-group/
// move-tab-new-window/rename-group-tab/star-group-window entirely rather
// than trim their durationMs (would freeze mid-action, see the ponytail
// above this used to say). `open-popup` (pulled from `demoScript`, same
// `fromPromo`-style verbatim reuse as `chaos-hook`) stands in for the
// "chaos -> organized" payoff — it's the beat that shows the settled,
// already-grouped sidebar. Combined with `WalkthroughDemo`'s new `speed`
// prop (applied in Root.tsx, not here — this array still holds each step's
// real, untruncated durationMs) to land under 30s: at speed 1.3, this cut's
// real content is ~28.8s (verified: 1.5s intro + 6320+9720+7200+6800=30040ms
// of action /1.3 + 4200ms outro = 28808ms — see Root.tsx's own comment for
// the arithmetic and re-verify there if any of these durationMs values ever
// change).
export const promoScript: DemoStep[] = [
    { ...demoScript.find((s) => s.id === "chaos-hook")! },
    { ...demoScript.find((s) => s.id === "open-popup")! },
    fromPromo("multi-select-drag"),
    fromPromo("cross-group-drag"),
    {
        id: "promo-outro",
        caption: "TabMerger — install free",
        durationMs: 4200,
        action: "",
        textCard: true,
    },
];
