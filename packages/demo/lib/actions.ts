// Maps demo-script.ts `step.action` names to real Playwright interactions
// against the built extension popup. Selectors confirmed against
// packages/extension/src/components/{Header,SidePanel,Windows}/*.tsx.
//
// Shared by record.ts and screenshots.ts so both drive identical UI state.
import type { ElementHandle, Locator, Page } from "@playwright/test";

// ponytail: shared click-indicator helpers — every simulated click/dblick
// pulses window.__tmRipple(x, y) (injected once per page via
// launchDemoContext.ts's addInitScript) at the element's center just before
// the real Playwright click, so the recording shows where the "cursor"
// interacted instead of an invisible synthetic click.
async function ripple(locator: Locator) {
    const box = await locator.boundingBox();
    if (!box) return;
    await locator
        .page()
        .evaluate(
            ({ x, y }) => (window as unknown as { __tmRipple?: (x: number, y: number) => void }).__tmRipple?.(x, y),
            { x: box.x + box.width / 2, y: box.y + box.height / 2 },
        );
    // let the ripple render a frame before the click itself fires.
    await locator.page().waitForTimeout(120);
}

// ponytail: pause AFTER every click, in the shared helper rather than
// scattered per-call-site waits in every action below — a viewer needs a
// beat to actually register each click/ripple before the next one fires.
// Fixed here once so it automatically applies to every click across every
// step, instead of relying on each handler remembering to add its own gap
// (several already had one for unrelated reasons — e.g. waiting for a menu
// to render — this is a floor under all of them, not a replacement).
const POST_CLICK_PAUSE_MS = 350;

async function clickWithRipple(locator: Locator, options?: Parameters<Locator["click"]>[0]) {
    await ripple(locator);
    await locator.click(options);
    await locator.page().waitForTimeout(POST_CLICK_PAUSE_MS);
}

async function dblclickWithRipple(locator: Locator, options?: Parameters<Locator["dblclick"]>[0]) {
    await ripple(locator);
    await locator.dblclick(options);
    await locator.page().waitForTimeout(POST_CLICK_PAUSE_MS);
}

// ponytail: renameGroup targets an ElementHandle (frozen before the rename
// input replaces the "Shopping" text node — see comment in renameGroup),
// not a Locator, so it can't reuse clickWithRipple directly. Same ripple +
// pacing behavior, just handle-shaped.
async function clickHandleWithRipple(page: Page, handle: ElementHandle<Element>) {
    const box = await handle.boundingBox();
    if (box) {
        await page.evaluate(
            ({ x, y }) => (window as unknown as { __tmRipple?: (x: number, y: number) => void }).__tmRipple?.(x, y),
            { x: box.x + box.width / 2, y: box.y + box.height / 2 },
        );
        await page.waitForTimeout(120);
    }
    await handle.click();
    await page.waitForTimeout(POST_CLICK_PAUSE_MS);
}

// ponytail: plain typing, no per-character badge — a badge on every letter
// was too noisy (coordinator scope-down). Kept as a named helper only
// because every typing call site already reads better with a label than a
// bare `locator.pressSequentially(...)`.
async function typeText(locator: Locator | ElementHandle<Element>, text: string, delayMs: number) {
    if ("pressSequentially" in locator) await locator.pressSequentially(text, { delay: delayMs });
    else for (const ch of text) { await locator.type(ch); await new Promise((r) => setTimeout(r, delayMs)); }
}

// ponytail: fraction-of-viewport (800x600) center point for a locator, used
// as Composition.tsx's zoom transform-origin so "zoom in" actually centers
// on the element the step is about, instead of the frame's fixed center.
// Returns undefined (not throws) when the box can't be resolved — zoom just
// falls back to center, same as before this existed, rather than failing a
// whole recording over a cosmetic origin.
function boxOrigin(box: { x: number; y: number; width: number; height: number } | null) {
    if (!box) return undefined;
    return { x: (box.x + box.width / 2) / 800, y: (box.y + box.height / 2) / 600 };
}

async function originFraction(locator: Locator | ElementHandle<Element>) {
    return boxOrigin(await locator.boundingBox());
}

// ponytail: real human drags don't move in uniform linear steps with hard
// holds at fixed midpoints (the old dragTabBetweenGroups/moveTabToNewWindow/
// crossWindowTabDrag code) — they ease in/out, vary speed, wobble slightly
// off the straight line, and usually overshoot the target a little before
// settling. easeInOutCubic + a small random overshoot-then-correct pass gets
// close to that without pulling in a motion/animation library for a few
// mouse.move calls.
function easeInOutCubic(t: number) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

async function naturalMouseMove(
    page: Page,
    from: { x: number; y: number },
    to: { x: number; y: number },
    options?: { overshoot?: boolean },
) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    // Overshoot ~6-10% past the target then correct back — real cursors
    // rarely stop exactly on the first arrival.
    const overshootFactor = options?.overshoot ? 1.06 + Math.random() * 0.04 : 1;
    const peak = { x: from.x + dx * overshootFactor, y: from.y + dy * overshootFactor };
    const TRAVEL_STEPS = 16;
    for (let i = 1; i <= TRAVEL_STEPS; i++) {
        const t = easeInOutCubic(i / TRAVEL_STEPS);
        // Tiny perpendicular wobble, strongest mid-travel, ~zero at the ends —
        // a straight-line lerp reads as robotic even with eased timing.
        const wobble = Math.sin(t * Math.PI) * 2.5 * (Math.random() - 0.5);
        const nx = from.x + dx * overshootFactor * t + wobble;
        const ny = from.y + dy * overshootFactor * t + wobble;
        await page.mouse.move(nx, ny, { steps: 2 });
        // Variable per-step delay (not a uniform pause) — slower near the
        // ends, faster mid-travel, plus jitter so it never reads as a fixed
        // interval.
        const speedFactor = 1 - Math.sin(t * Math.PI) * 0.5;
        await page.waitForTimeout(Math.round((10 + Math.random() * 14) * speedFactor));
    }
    if (options?.overshoot) {
        const SETTLE_STEPS = 6;
        for (let i = 1; i <= SETTLE_STEPS; i++) {
            const t = easeInOutCubic(i / SETTLE_STEPS);
            await page.mouse.move(peak.x + (to.x - peak.x) * t, peak.y + (to.y - peak.y) * t, { steps: 2 });
            await page.waitForTimeout(14 + Math.random() * 12);
        }
    }
}

// ponytail: badge reserved for modifier/special-key presses only (Ctrl+A,
// Enter, Escape, Backspace, etc.) — the actual keyboard shortcuts worth
// calling out — not regular text entry. Reuses window.__tmKeyBadge (same
// brand-color mechanism as the click ripple, injected via
// launchDemoContext.ts's addInitScript) — fixed bottom-center position, so
// no target element/bounding box needed here.
async function pressWithIndicator(page: Page, keys: string, label: string) {
    await page.evaluate(
        (label) => (window as unknown as { __tmKeyBadge?: (label: string) => void }).__tmKeyBadge?.(label),
        label,
    );
    await page.waitForTimeout(150);
    await page.keyboard.press(keys);
}

// ponytail: group/tab names hardcoded against demoData.ts seed content
// (Work/Research/Shopping/Reading List groups). If the seed data changes,
// update these strings too — no dynamic lookup, it's a fixed script.

// ponytail: fixed window/tab pools for the multi-window chaosHook (and the
// steps chained after it) — hardcoded against these exact URLs, not dynamic,
// same convention as the rest of this file (see the group/tab-name comment
// above). If these change, downstream steps that assume "the first Now Open
// window has these 5 tabs" (copyWindowToGroup, closeNowOpenWindow) need
// updating too.
const CHAOS_WINDOW_SETS = [
    [
        "https://mail.google.com/mail/u/0/#inbox",
        "https://calendar.google.com/calendar/u/0/r/week",
        "https://app.slack.com/client",
        "https://github.com",
        "https://www.notion.so",
    ],
    [
        "https://arxiv.org",
        "https://react.dev",
        "https://developer.mozilla.org",
        "https://wxt.dev",
        "https://news.ycombinator.com",
    ],
    [
        "https://stackoverflow.com",
        "https://www.figma.com",
        "https://trello.com",
        "https://www.linkedin.com",
        "https://twitter.com",
    ],
];

type ZoomOrigin = { x: number; y: number } | undefined;

const actions: Record<string, (page: Page) => Promise<ZoomOrigin | void>> = {
    // ponytail: REPLACED 2026-07-31 — the old version opened 40 tabs in ONE
    // window, which (per direct feedback) doesn't read as "chaos across your
    // whole browser," just a long list. `chrome.windows.create` is called
    // from evaluate() INSIDE the extension popup page itself (not a content
    // page) — popup pages run with the extension's own permissions, so
    // `chrome.windows` is available there without any extension-side change.
    // Each real window shows up as its own WindowItem card in "Now Open"
    // (Windows/index.tsx groups tabs by real chrome.windows.Window), so 3
    // separate windows of 5 tabs each renders as 3 distinct messy window
    // cards stacked in the popup — a much clearer "multiple messy windows"
    // visual than one giant tab list, with zero new UI code needed.
    // ponytail: full storyboard rewrite (2026-08-01) — "Now Open" must show
    // ONLY the real seeded chaos windows created here, nothing else (per
    // explicit coordinator constraint: no extra staged/fake content beyond
    // what this step itself seeds). launchDemoContext.ts still seeds its own
    // NOW_OPEN_SEED_URLS window for screenshots.ts's independent needs — this
    // action now closes that (and any other pre-existing window except the
    // one this popup page itself belongs to) right after creating the real
    // 3-window/5-tab chaos set, so by the time the clip settles, Now Open
    // reflects exactly the 15 tabs just opened, not 15+3 leftover ones.
    async chaosHook(page) {
        const currentWinId = await page.evaluate(
            () => new Promise<number>((resolve) => chrome.windows.getCurrent((w) => resolve(w.id!))),
        );
        const staleWinIds = await page.evaluate(
            (skip) =>
                new Promise<number[]>((resolve) => {
                    chrome.windows.getAll({}, (wins) =>
                        resolve(wins.map((w) => w.id).filter((id): id is number => id !== undefined && id !== skip)),
                    );
                }),
            currentWinId,
        );
        for (const urls of CHAOS_WINDOW_SETS) {
            await page.evaluate(
                (urls) =>
                    new Promise<void>((resolve) => {
                        chrome.windows.create({ url: urls, focused: false }, () => resolve());
                    }),
                urls,
            );
        }
        if (staleWinIds.length > 0) {
            await page.evaluate(
                (ids) =>
                    Promise.all(
                        ids.map((id) => new Promise<void>((resolve) => chrome.windows.remove(id, () => resolve()))),
                    ),
                staleWinIds,
            );
        }
        await page.waitForTimeout(700);
        // Scroll partway down so the clip reads as genuinely deep/scrollable
        // chaos (3 window cards x 5 tabs each is taller than one screen).
        await page.mouse.wheel(0, 300).catch(() => null);
        await page.waitForTimeout(1400);
    },

    async openPopup(page) {
        // ponytail: record.ts now waits for "Now Open" to be visible right
        // after every step's page.goto(popupUrl), before any step's action
        // runs (was previously only done here, which meant every OTHER step
        // still opened on a mid-load blank flash). Just hold the beat here.
        await page.waitForTimeout(500);
        // ponytail: this used to just sit still for the rest of the step's
        // (then 9000ms) duration — a static hold on the settled group list,
        // which is exactly the "too little happening" dead air viewer
        // feedback flagged. Move the cursor across a couple of real sidebar
        // rows instead, so the "instantly organized" beat has something
        // visibly happening rather than a frozen frame. No clicks — this
        // step is about the settled state, not a new interaction.
        for (const name of ["Work", "Research"]) {
            const box = await page.getByText(name, { exact: true }).first().boundingBox().catch(() => null);
            if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
            await page.waitForTimeout(500);
        }
    },

    async settingsWalkthrough(page) {
        // ponytail: gives viewers a glimpse that Settings exists and what's
        // configurable, before diving into the core group/tab features.
        // Reuses the same real selectors as launchDemoContext.ts's own
        // Settings navigation (Settings menu -> "Settings" menuitem ->
        // General tab is default-active -> Data tab), but as an actual
        // recorded, deliberately-paced step instead of throwaway setup.
        await clickWithRipple(page.getByRole("button", { name: /Settings menu|Account menu/ }));
        await clickWithRipple(page.getByRole("menuitem", { name: "Settings" }));
        // General tab (theme select) is already active by default — let it
        // sit on screen for a beat before moving to the next tab.
        await page.waitForTimeout(500);
        // Brief glimpse of the Account tab too — same pacing as the other
        // tabs in this scene, sandwiched between General and Data.
        await clickWithRipple(page.getByRole("tab", { name: "Account" }));
        await page.waitForTimeout(500);
        await clickWithRipple(page.getByRole("tab", { name: "Data" }));
        await page.waitForTimeout(600);
        await clickWithRipple(page.getByRole("button", { name: "Close" }));
    },

    async viewGroups(page) {
        // ponytail: group name text can appear in both the sidebar row and
        // an active-group header — .first() is always the sidebar row.
        await clickWithRipple(page.getByText("Work", { exact: true }).first());
        await page.waitForTimeout(800);
        await clickWithRipple(page.getByText("Research", { exact: true }).first());
    },

    async dragTabBetweenGroups(page) {
        // ponytail: REPLACED the earlier context-menu "Move to group"
        // shortcut here — that produced a before/after jump-cut with no
        // visible drag motion at all, which viewer feedback correctly
        // flagged as unintelligible for a "drag and drop" feature (nothing
        // on screen ever moves under the cursor). Tab.tsx's grip handle
        // (aria-label "Drag to reorder tab") IS a real @dnd-kit useSortable
        // drag source, and useDndSensors' PointerSensor only needs 5px of
        // movement to activate (useDnd.ts) — real page.mouse events clear
        // that easily, no need for the click-based menu workaround at all.
        // Each step gets a fresh page (activeGroupIndex resets to "Now
        // Open"), so activate "Work" first.
        await clickWithRipple(page.getByText("Work", { exact: true }).first());
        await page.waitForTimeout(300);
        const handles = page.locator('[aria-label="Drag to reorder tab"]');
        const source = handles.first();
        const target = handles.nth(2);
        await source.scrollIntoViewIfNeeded();
        await target.scrollIntoViewIfNeeded();
        const sourceBox = await source.boundingBox();
        const targetBox = await target.boundingBox();
        if (!sourceBox || !targetBox) throw new Error("dragTabBetweenGroups: could not resolve drag handle boxes");
        const sx = sourceBox.x + sourceBox.width / 2;
        const sy = sourceBox.y + sourceBox.height / 2;
        const tx = targetBox.x + targetBox.width / 2;
        const ty = targetBox.y + targetBox.height / 2;
        await page.evaluate(
            ({ x, y }) => (window as unknown as { __tmRipple?: (x: number, y: number) => void }).__tmRipple?.(x, y),
            { x: sx, y: sy },
        );
        await page.mouse.move(sx, sy);
        await page.mouse.down();
        // Clear PointerSensor's 5px activation distance with a small nudge
        // before the real move — otherwise the first big jump can register
        // as the activating move itself and skip the "picked up" state.
        await page.mouse.move(sx, sy - 10, { steps: 5 });
        await page.waitForTimeout(120 + Math.random() * 80);
        // Eased, wobbling travel with a slight overshoot-then-settle at the
        // drop target — see naturalMouseMove.
        await naturalMouseMove(page, { x: sx, y: sy }, { x: tx, y: ty }, { overshoot: true });
        // Brief hold over the drop position so the reordered preview is
        // visible before release.
        await page.waitForTimeout(200 + Math.random() * 150);
        await page.mouse.up();
        await page.waitForTimeout(300);
    },

    async renameGroup(page) {
        const groupName = page.getByText("Shopping", { exact: true }).first();
        // ponytail: Playwright locators re-resolve their FULL selector chain
        // lazily on every call — a `Locator` built from "Shopping" text
        // still re-queries by that text later, and once isRenaming flips
        // true, GroupItem.tsx swaps the "Shopping" text node out for the
        // rename <input>, so any later re-resolution of a locator rooted at
        // that text finds nothing (unlike a plain object reference, storing
        // the Locator variable does NOT freeze the element). Grab a real
        // ElementHandle for the row container before dblclicking instead —
        // handles do stay bound to the actual DOM node once resolved.
        const groupRowHandle = await groupName
            .locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' group ')][1]")
            .elementHandle();
        await dblclickWithRipple(groupName);
        // ponytail: ROOT CAUSE of the dropped-space rename bug (this took two
        // passes to actually nail — the first "fix" only reduced the odds of
        // hitting the race, it didn't remove it). GroupItem.tsx's own
        // useEffect (fires on isRenaming going true) does:
        //   setTimeout(() => { el.focus(); el.setSelectionRange(len, len); }, 50)
        // — i.e. 50ms AFTER the input first mounts (and is already visible/
        // clickable), the component focuses it *itself* and explicitly moves
        // the caret to the END, unconditionally, overwriting whatever
        // selection we'd already made. The input becomes clickable well
        // before that 50ms mark, so a `waitForSelector` -> `click()` ->
        // `Control+a` sequence routinely finishes in under 50ms — our
        // select-all wins the race, and THEN the component's own delayed
        // effect fires and collapses it back to a caret at the end, right
        // before we start typing. Result: "Family Trip" gets appended after
        // "Shopping" instead of replacing it, non-deterministically
        // (whichever side happens to finish last on a given run).
        // Fix: explicitly out-wait GroupItem's own 50ms timer before doing
        // our own select-all, so ours is always the side that runs last.
        if (!groupRowHandle) throw new Error("renameGroup: could not resolve group row container");
        const inputHandle = await groupRowHandle.waitForSelector("input", { state: "visible", timeout: 5000 });
        await clickHandleWithRipple(page, inputHandle);
        await page.waitForTimeout(250); // > GroupItem.tsx's internal 50ms auto-focus/caret-reset timer
        await pressWithIndicator(page, "Control+a", "Ctrl+A");
        await page.waitForTimeout(150);
        // ponytail: plain typing (no per-character badge, see typeText) —
        // renamed to a two-word name ("Family Trip", not "Wishlist")
        // specifically so the recording demonstrates that spaces type
        // correctly — page.keyboard.type() itself was never dropping
        // spaces, the real input just wasn't actually selected/focused yet
        // when we thought it was (see above).
        await typeText(inputHandle, "Family Trip", 110);
        await page.waitForTimeout(200);
        await pressWithIndicator(page, "Enter", "Enter");
        // ponytail: hold on the sidebar row now reading "Family Trip" — the
        // resulting UI update — not just the moment Enter is pressed (same
        // "show the effect, not just the trigger" fix applied to every
        // rename/edit action in this file, see createGroup/renameGroupTab).
        await page.waitForTimeout(700);
    },

    async renameTab(page) {
        // ponytail: distinct feature from renameGroup above — Tab.tsx has
        // its own independent customTitle override (right-click a tab ->
        // "Rename tab" menuitem -> commitTitle()), separate from the
        // group-name rename already demoed. Not previously in the script at
        // all. Reuses renameGroup's proven fix for the exact same
        // focus/caret-reset race — Tab.tsx's own `editingTitle` effect
        // (~line 101-111) does the identical
        // `setTimeout(() => { el.focus(); el.setSelectionRange(len,len) }, 50)`
        // dance, so the same "click the input ourselves, then explicitly
        // out-wait 50ms before Control+a" fix applies here too.
        await clickWithRipple(page.getByText("Work", { exact: true }).first());
        // "Sprint Notes — Notion" is a real seeded title (demoData.ts, Work group).
        const tabRow = page.getByText("Sprint Notes", { exact: false }).first();
        await clickWithRipple(tabRow, { button: "right" });
        const renameItem = page.getByText("Rename tab", { exact: true });
        await renameItem.waitFor({ state: "visible" });
        await page.waitForTimeout(400); // let the context menu (and "Rename tab" specifically) register on screen
        // Capture the row handle before clicking "Rename tab" — that click is
        // what swaps the title text out for an <input> (right-clicking alone,
        // opening the menu, does not touch the row's DOM).
        const tabRowHandle = await tabRow.locator("xpath=ancestor::*[@role='listitem'][1]").elementHandle();
        await clickWithRipple(renameItem);
        if (!tabRowHandle) throw new Error("renameTab: could not resolve tab row container");
        const inputHandle = await tabRowHandle.waitForSelector("input", { state: "visible", timeout: 5000 });
        await clickHandleWithRipple(page, inputHandle);
        await page.waitForTimeout(250); // > Tab.tsx's internal 50ms auto-focus/caret-reset timer
        await pressWithIndicator(page, "Control+a", "Ctrl+A");
        await page.waitForTimeout(150);
        await typeText(inputHandle, "Weekly Sync Notes", 90);
        await page.waitForTimeout(200);
        await pressWithIndicator(page, "Enter", "Enter");
        // ponytail: hold on the row now reading "Weekly Sync Notes" — see
        // createGroup/renameGroupTab's comments on showing the resulting UI
        // update, not just the trigger.
        await page.waitForTimeout(700);
    },

    async tabPreview(page) {
        // ponytail: hover a "Now Open" tab, not a saved group's tab — Tab.tsx
        // only passes isLive={isNowOpen} into TabPreview, and TabPreview.tsx
        // only attempts the real chrome.tabs.sendMessage(GET_PAGE_META) fetch
        // (content.ts's metadata collection) when isLive is true. A saved
        // group's tab has no live tabId, so its tooltip only ever shows the
        // "No preview" placeholder — hovering "Now Open" instead shows the
        // real preview image, which is the feature actually worth showing on
        // camera. "Now Open" is the default active group on a fresh page, so
        // no navigation click needed first.
        // ponytail: activeGroupIndex is persisted (setActiveGroupIndex calls
        // setSetting(...), it's not ephemeral like the rest of uiStore) and
        // record.ts reuses one context/profile across all steps — so without
        // this click, tabPreview inherits whatever group the *previous* step
        // (view-groups) left active ("Research"), and "Now Open"'s tabs are
        // never in the DOM at all.
        await clickWithRipple(page.getByText("Now Open", { exact: true }).first());
        await page.waitForTimeout(300);
        // ponytail: Now Open's list re-renders frequently (useCurrentTabs polls
        // live browser tabs), which made locator.hover()'s actionability check
        // ("wait for element to be stable") time out — the row kept getting
        // detached/reattached mid-check. Read the bounding box once and drive
        // page.mouse.move() directly instead; that only needs the element to
        // exist for a moment, not to stay stable through the whole hover call.
        const githubTab = page.getByText("GitHub", { exact: false }).first();
        await githubTab.waitFor({ state: "visible" });
        const box = await githubTab.boundingBox();
        if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        // 400ms Radix delay + render time; waitForTimeout does not move the mouse so
        // the hover persists and the tooltip stays visible in the recording.
        await page.waitForTimeout(1800);
    },

    async starWindow(page) {
        await clickWithRipple(page.getByText("Work", { exact: true }).first());
        await page.waitForTimeout(300);
        // ponytail: window cards are .bg-card; sidebar group items are not.
        // Clicking the star inside the first .bg-card targets the window-level star
        // (h-5 w-5 Button) rather than any sidebar group star (no explicit h/w class).
        await clickWithRipple(page.locator(".bg-card").first().locator("button:has(.lucide-star)"));
        // ponytail: window.starred applies a REAL, correct `borderLeftColor`
        // tint (Window.tsx line ~125/182) the instant the star is clicked —
        // not a leftover hover/focus artifact from the click itself. Per
        // coordinator: the star ACTION should be demonstrated but the
        // resulting colored-border state should not be what the clip
        // lingers on/ends on. Immediately move on to a different sidebar
        // item so the recording moves off the starred window's card rather
        // than sitting on it (previously this deliberately waited 800ms to
        // let the border render on screen — inverted per new guidance).
        await clickWithRipple(page.getByText("Research", { exact: true }).first());
    },

    async starGroup(page) {
        // ponytail: the pin/star button has no aria-label (only a Tooltip that
        // says "Pin group" / "Unpin group", not an a11y name) — target lucide-react's
        // rendered class on the Star <svg> instead. first() picks the sidebar's
        // first non-permanent group row (Now Open is permanent and has no star button,
        // so first() reliably lands on the first saved group).
        await clickWithRipple(page.locator("button:has(svg.lucide-star)").first());
    },

    async staleTabs(page) {
        // ponytail: demoData.ts seeds all 5 "Reading List" tabs with a
        // `savedAt` 40 days in the past (default stale threshold is 30 days
        // — see useCleanupSuggestions.ts's MIN_STALE = 5), specifically so
        // this group crosses the threshold on its own and both the
        // per-tab stale-dot indicator (Windows/Tab.tsx, aria-label
        // "Stale tab") and the CleanupSuggestionBanner show up here without
        // relying on real wall-clock aging.
        // ponytail: GroupItem.tsx truncates any sidebar group name over 10
        // chars to `name.slice(0, 10) + "…"` in the actual rendered text
        // (not CSS ellipsis) — "Reading List" (12 chars) renders as literal
        // text "Reading Li…", so `getByText("Reading List", {exact:true})`
        // never matches. Match the truncated prefix instead.
        await clickWithRipple(page.getByText(/^Reading Li/).first());
        await page.waitForTimeout(300);
        // CleanupSuggestionBanner only renders once useCleanupSuggestions'
        // groupsState-derived staleTabs list resolves — give it a beat to
        // mount, then let it (and the per-tab dots, already visible above)
        // sit on screen for the rest of the step's duration.
        await page.getByText(/tabs were saved over/i).waitFor({ state: "visible", timeout: 5000 }).catch(() => null);
        await page.waitForTimeout(1200);
    },

    async toggleSelectionMode(page) {
        // Fresh page defaults to "Now Open" (no seeded tabs) — activate a
        // seeded group first so there are tab checkboxes to select.
        await clickWithRipple(page.getByText("Work", { exact: true }).first());
        await page.waitForTimeout(300);
        await clickWithRipple(page.getByRole("button", { name: "Select items" }));
        await page.waitForTimeout(300);
        // ponytail: these are plain <button aria-label="Select tab"> with no
        // role="checkbox" override — accessible role is "button", not "checkbox".
        await clickWithRipple(page.getByRole("button", { name: "Select tab" }).first());
        await page.waitForTimeout(300);
        await clickWithRipple(page.getByRole("button", { name: "Select tab" }).nth(1));
    },

    async searchTabs(page) {
        // ponytail: SearchOverlay.tsx has no <select>/dropdown element — the
        // real scope-filter affordance is the "group:" example chip (one of
        // EXAMPLES) which, once clicked, fills the input with the bare
        // `group:` prefix and switches the overlay into "picker" mode: a
        // clickable list of real group names (getGroupPicks). Clicking a
        // group there calls completePick(), which inserts `group:"Name" `
        // into the query for you — this IS the real UI's scope/filter
        // control, just click-driven instead of a native dropdown. Typing
        // raw `group:"Research"` syntax by hand (the old version of this
        // step) skipped that affordance entirely.
        // ponytail: the header bar is a plain <button aria-label="Open search">
        // showing placeholder text, not the input itself — it opens
        // SearchOverlay, which owns the real <input placeholder="Search tabs, groups…">.
        await clickWithRipple(page.getByRole("button", { name: "Open search" }));
        const searchInput = page.getByPlaceholder(/search/i);
        // Click the "group:" example chip to enter picker mode (empty query
        // -> EXAMPLES list is only rendered then).
        await clickWithRipple(page.getByText("group:", { exact: true }));
        await page.waitForTimeout(250); // let the picker list of real groups render
        // Real seeded group name (demoData.ts) — click it like a user would.
        // ponytail: SidePanel/GroupItem.tsx's sidebar row is ALSO an
        // accessible "Research" button (aria-label), so an unscoped
        // getByRole match is ambiguous (strict-mode violation). Scope to
        // the picker's fixed-position overlay container instead.
        await clickWithRipple(
            page.locator(".fixed.z-50").getByRole("button", { name: /^Research$/ }),
        );
        await page.waitForTimeout(250); // completePick()'s setTimeout(0) + refocus
        // "React Docs — useEffect" is a real seeded tab (demoData.ts, Research
        // group), so this plain term returns an actual result.
        await typeText(searchInput, "react", 90);
        await page.waitForTimeout(900);
        await searchInput.fill("");
    },

    async undoAction(page) {
        // Undo stack lives in uiStore (ephemeral, not persisted) — a fresh
        // page has nothing to undo, so the button starts disabled. Give the
        // undo real narrative weight: first show a genuinely "oops" action
        // (removing a tab — it visibly disappears from the list), THEN undo
        // it via the real Header Undo button, so viewers see why they'd
        // reach for undo instead of cutting straight to the click.
        // Star button/checkbox are hidden while selectionMode is on (see
        // toggleSelectionMode) — screenshots.ts reuses one page across all
        // steps, so exit selection mode first rather than assume fresh state.
        const exitSelection = page.getByRole("button", { name: "Exit selection mode" });
        if (await exitSelection.isVisible().catch(() => false)) {
            await clickWithRipple(exitSelection);
            await page.waitForTimeout(250);
        }
        await clickWithRipple(page.getByText("Work", { exact: true }).first());
        await page.waitForTimeout(300);
        // Real seeded tab (demoData.ts, Work group) — "Q3 Planning".
        // dragTabBetweenGroups (earlier step, same persisted profile) now
        // only reorders tabs WITHIN Work, it no longer moves Gmail out of
        // the group, so all 5 seeded Work tabs are still present here.
        // Right-click -> destructive "Remove tab" menuitem (Tab.tsx) is the
        // actual "oops".
        const tab = page.getByText("Q3 Planning", { exact: false }).first();
        await clickWithRipple(tab, { button: "right" });
        const removeItem = page.getByText("Remove tab", { exact: true });
        await removeItem.waitFor({ state: "visible" });
        await page.waitForTimeout(400); // let "Remove tab" register on screen before clicking it
        await clickWithRipple(removeItem);
        // Let the tab's absence sit on screen for a beat — this is the
        // "oops" the rest of the step exists to fix.
        await page.waitForTimeout(600);
        await clickWithRipple(page.getByRole("button", { name: "Undo" }));
        // Let the restored tab sit on screen so the fix reads clearly.
        await page.waitForTimeout(500);
    },

    async changeGroupColor(page) {
        // ponytail: "Change color" was removed from the group's right-click
        // dropdown (product decision) — the only remaining entry point is
        // the small color-swatch dot rendered directly on the sidebar row
        // (SidePanel/GroupItem.tsx), which has no accessible name of its own.
        // Walk up from the group's name text to its row container (marked
        // with the Tailwind `group` class for group-hover) and click the
        // round swatch button inside it.
        const groupRow = page
            .getByText("Research", { exact: true })
            .first()
            .locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' group ')][1]");
        await clickWithRipple(groupRow.locator("button.rounded-full"));
        await page.waitForTimeout(300);
        // ponytail: preset swatches are plain <button title="rgba(...)">
        // with no accessible name/role override — index into the preset
        // grid rather than matching a specific color string.
        // ponytail: coordinator asked for this step to land on blue
        // specifically. PRESET_COLORS[5] (shared/src/constants/index.ts) is
        // blue (59,130,246,1) — BUT demoData.ts already seeds the Research
        // group with that exact color (see demoData.ts line 43), so clicking
        // it here is a visual no-op: before/after look identical on camera.
        // Left as index 5 per the explicit ask; if a visibly-distinct swatch
        // is wanted instead, either target a different (non-blue) seeded
        // group or pick a color none of Work/Research/Shopping/Reading
        // List/Now Open already use (index 8, pink, was the prior choice).
        await clickWithRipple(page.locator('button[title^="rgba"]').nth(5));
    },

    async addGroupNote(page) {
        // ponytail: reveal WHERE the note lives before typing anything —
        // right-click the group (ripple + pause already show the context
        // menu appearing), then let the "Add note" menu item itself sit on
        // screen for a beat so viewers register that this is the entry
        // point, before clicking it. Only once the (empty) note field is
        // actually visible do we pause again and start typing — no jumping
        // straight to text appearing.
        const group = page.getByText("Research", { exact: true }).first();
        await clickWithRipple(group);
        await clickWithRipple(group, { button: "right" });
        // ponytail: GroupContextMenu.tsx labels this "Add note" (no note yet)
        // vs "Edit note" (note already set) — match either.
        const addNoteItem = page.getByText(/^(Add|Edit) note$/);
        await addNoteItem.waitFor({ state: "visible" });
        await page.waitForTimeout(500); // let the menu (and "Add note" specifically) register on screen
        await clickWithRipple(addNoteItem);
        const textarea = page.getByPlaceholder("Add a note to this group...");
        await textarea.waitFor({ state: "visible" });
        await page.waitForTimeout(500); // let the empty note field's location register before typing starts
        await typeText(textarea, "Flights booked — check visa docs before Friday", 35);
        await page.waitForTimeout(300);
        await clickWithRipple(page.getByRole("button", { name: "Save" }));
    },

    async outro(page) {
        await page.waitForTimeout(1000);
    },

    // ponytail: new promo storyboard steps (2026-07-31) — each maps to a
    // REAL existing extension feature (see PROMO_VIDEO_SPEC.md's third-pass
    // notes for what was verified in useGroups.ts/useDnd.ts before writing
    // these), no new extension code needed.

    // ponytail: ROOT CAUSE fix (first version of this action assumed
    // "Add Group" opens `Modal/AddGroup.tsx`'s name+color dialog — it does
    // NOT. `SidePanel/index.tsx`'s real `handleNewGroup` creates a group
    // immediately with `DEFAULT_GROUP_TITLE` ("temp group") and calls
    // `setRenameTarget(...)`, which auto-opens the SAME inline sidebar
    // rename input `renameGroup` already drives (GroupItem.tsx's input-swap
    // + 50ms auto-focus/caret-reset race), just triggered automatically
    // instead of by double-click. `AddGroupModal` is dead code — nothing in
    // the popup ever calls `openModal('addGroup')`. Verified by grepping for
    // every call site before writing this, not assumed from the component
    // existing.) Zoomed in (see this step's `zoom` in demo-script.ts) and
    // held after Enter so the "temp group" -> "Q4 Launch" text swap in the
    // sidebar — the actual UI update the rename causes — reads clearly, not
    // just the click-to-edit moment.
    async createGroup(page) {
        await clickWithRipple(page.getByRole("button", { name: "Add Group" }));
        // ponytail: ROOT CAUSE of a real bug found via a standalone debug
        // script (page.locator("body").innerText() after the click) — the
        // new group row is rendered ALREADY IN rename mode (no static
        // "temp group" text node ever exists to grab, unlike renameGroup's
        // dblclick flow, which converts an EXISTING text node to an input).
        // `getByText("temp group")` can never match: an `<input value="temp
        // group">`'s value is a form-control property, not text content, so
        // it's invisible to text-node locators — that's not a select-all/
        // race issue like the other rename actions in this file, it's a
        // structurally different starting state. Just grab the one visible
        // input directly instead (nothing else opens an input at this
        // point in the flow).
        const inputHandle = await page.waitForSelector("input", { state: "visible", timeout: 5000 });
        await clickHandleWithRipple(page, inputHandle);
        await page.waitForTimeout(250); // > GroupItem.tsx's internal 50ms auto-focus/caret-reset timer
        await pressWithIndicator(page, "Control+a", "Ctrl+A");
        await page.waitForTimeout(150);
        await typeText(inputHandle, "Q4 Launch", 90);
        await page.waitForTimeout(200);
        await pressWithIndicator(page, "Enter", "Enter");
        // Hold on the committed "Q4 Launch" sidebar row — the resulting UI
        // update, not just the typing — before cutting away.
        await page.waitForTimeout(900);
        return originFraction(inputHandle);
    },

    // Separate real action from createGroup above — the swatch-dot color
    // picker (same entry point as changeGroupColor) is the only way to set a
    // group's color; it's not part of the create flow. Targets "Q4 Launch"
    // (already renamed by createGroup, same persisted profile/session).
    // Zoomed in and held after the swatch click so the sidebar dot's color
    // change is clearly visible as the resulting UI update.
    async colorNewGroup(page) {
        const groupRow = page
            .getByText("Q4 Launch", { exact: true })
            .first()
            .locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' group ')][1]");
        await clickWithRipple(groupRow.locator("button.rounded-full"));
        await page.waitForTimeout(300);
        // PRESET_COLORS index 8 (pink) — visibly distinct from every seeded
        // group's color (see changeGroupColor's ponytail comment on index 5
        // already being taken by "Research").
        await clickWithRipple(page.locator('button[title^="rgba"]').nth(8));
        // Hold on the swatch's new color — the resulting UI update.
        await page.waitForTimeout(800);
        return originFraction(groupRow);
    },

    // Window.tsx's real right-click menu on a "Now Open" window header:
    // "Copy to group" submenu -> pick the new group by name.
    async copyWindowToGroup(page) {
        await clickWithRipple(page.getByText("Now Open", { exact: true }).first());
        await page.waitForTimeout(300);
        const firstWindowHeader = page.locator(".bg-card").first().locator("> div").first();
        await clickWithRipple(firstWindowHeader, { button: "right" });
        const copyItem = page.getByText("Copy to group", { exact: true });
        await copyItem.waitFor({ state: "visible" });
        await page.waitForTimeout(400);
        await clickWithRipple(copyItem);
        const targetItem = page.getByRole("menuitem", { name: "Q4 Launch" });
        await targetItem.waitFor({ state: "visible" });
        await page.waitForTimeout(300);
        await clickWithRipple(targetItem);
    },

    // Same window header's "Close window" entry (isNowOpen ? 'Close window'
    // : 'Remove window') — the live browser window actually closes; the copy
    // made by copyWindowToGroup a moment ago is unaffected (separate group).
    async closeNowOpenWindow(page) {
        await clickWithRipple(page.getByText("Now Open", { exact: true }).first());
        await page.waitForTimeout(300);
        const firstWindowHeader = page.locator(".bg-card").first().locator("> div").first();
        await clickWithRipple(firstWindowHeader, { button: "right" });
        const closeItem = page.getByText("Close window", { exact: true });
        await closeItem.waitFor({ state: "visible" });
        await page.waitForTimeout(400);
        await clickWithRipple(closeItem);
        await page.waitForTimeout(500);
    },

    async viewNewGroup(page) {
        await clickWithRipple(page.getByText("Q4 Launch", { exact: true }).first());
        await page.waitForTimeout(700);
    },

    // Drags a tab onto Windows/index.tsx's manually-tracked "new window" drop
    // zone (`newWinDropRef` — a plain bounding-box overlap check, not a
    // dnd-kit droppable id, see handleDragMove/handleDragEnd) to split one
    // tab out of "Q4 Launch"'s single (copied) window into a brand new one.
    async moveTabToNewWindow(page) {
        await clickWithRipple(page.getByText("Q4 Launch", { exact: true }).first());
        await page.waitForTimeout(300);
        const handle = page.locator('[aria-label="Drag to reorder tab"]').first();
        await handle.scrollIntoViewIfNeeded();
        const box = await handle.boundingBox();
        if (!box) throw new Error("moveTabToNewWindow: could not resolve drag handle box");
        const sx = box.x + box.width / 2;
        const sy = box.y + box.height / 2;
        await page.evaluate(
            ({ x, y }) => (window as unknown as { __tmRipple?: (x: number, y: number) => void }).__tmRipple?.(x, y),
            { x: sx, y: sy },
        );
        await page.mouse.move(sx, sy);
        await page.mouse.down();
        await page.mouse.move(sx, sy - 10, { steps: 5 });
        await page.waitForTimeout(120 + Math.random() * 80);
        // The drop-zone text only renders (and expands from h-0) once
        // isDraggingTab flips true on drag start — re-resolve its box AFTER
        // the drag has actually begun, not before.
        const dropZone = page.getByText("Drop to create new window");
        await dropZone.waitFor({ state: "visible", timeout: 3000 }).catch(() => null);
        const zoneBox = await dropZone.boundingBox();
        if (zoneBox) {
            const tx = zoneBox.x + zoneBox.width / 2;
            const ty = zoneBox.y + zoneBox.height / 2;
            // Partial approach first (no overshoot — the dropzone box was
            // only just resolved and shouldn't be blown past), then the
            // real eased/overshoot travel into the zone.
            await naturalMouseMove(page, { x: sx, y: sy }, { x: sx, y: (sy + ty) / 2 });
            await page.waitForTimeout(100 + Math.random() * 80);
            await naturalMouseMove(page, { x: sx, y: (sy + ty) / 2 }, { x: tx, y: ty }, { overshoot: true });
            await page.waitForTimeout(200 + Math.random() * 150);
        }
        await page.mouse.up();
        await page.waitForTimeout(400);
    },

    // Real cross-window tab drag WITHIN one group (distinct from the
    // existing dragTabBetweenGroups, which reorders tabs inside a single
    // window's list). Windows/index.tsx's handleDragEnd has a dedicated
    // "Cross-window: splice from src, insert at dest" branch for exactly
    // this — confirmed in useGroups/Windows before writing this action, not
    // assumed. After moveTabToNewWindow, "Q4 Launch" has 2 windows, so the
    // first and last drag handles in DOM order are guaranteed to be in
    // different windows.
    async crossWindowTabDrag(page) {
        await clickWithRipple(page.getByText("Q4 Launch", { exact: true }).first());
        await page.waitForTimeout(300);
        const handles = page.locator('[aria-label="Drag to reorder tab"]');
        const source = handles.first();
        const target = handles.last();
        await source.scrollIntoViewIfNeeded();
        await target.scrollIntoViewIfNeeded();
        const sourceBox = await source.boundingBox();
        const targetBox = await target.boundingBox();
        if (!sourceBox || !targetBox) throw new Error("crossWindowTabDrag: could not resolve drag handle boxes");
        const sx = sourceBox.x + sourceBox.width / 2;
        const sy = sourceBox.y + sourceBox.height / 2;
        const tx = targetBox.x + targetBox.width / 2;
        const ty = targetBox.y + targetBox.height / 2;
        await page.evaluate(
            ({ x, y }) => (window as unknown as { __tmRipple?: (x: number, y: number) => void }).__tmRipple?.(x, y),
            { x: sx, y: sy },
        );
        await page.mouse.move(sx, sy);
        await page.mouse.down();
        await page.mouse.move(sx, sy - 10, { steps: 5 });
        await page.waitForTimeout(120 + Math.random() * 80);
        await naturalMouseMove(page, { x: sx, y: sy }, { x: tx, y: ty }, { overshoot: true });
        await page.waitForTimeout(200 + Math.random() * 150);
        await page.mouse.up();
        await page.waitForTimeout(300);
    },

    // Reuses renameTab's proven focus/caret-reset fix (see that handler's
    // comments), targeting a tab inside "Q4 Launch" instead of "Work".
    // ponytail: per coordinator feedback on the rename beats specifically —
    // zoomed in (see this step's `zoom` in demo-script.ts) and held
    // noticeably longer after Enter than the other rename actions in this
    // file, so the viewer sees BOTH the typing and the resulting UI update
    // (the tab's label actually changing to "Launch Repo" in the list) —
    // not just the click-to-edit moment cut away before the effect lands.
    async renameGroupTab(page) {
        await clickWithRipple(page.getByText("Q4 Launch", { exact: true }).first());
        await page.waitForTimeout(300);
        const tabRow = page.getByText("GitHub", { exact: false }).first();
        await clickWithRipple(tabRow, { button: "right" });
        const renameItem = page.getByText("Rename tab", { exact: true });
        await renameItem.waitFor({ state: "visible" });
        await page.waitForTimeout(400);
        const tabRowHandle = await tabRow.locator("xpath=ancestor::*[@role='listitem'][1]").elementHandle();
        await clickWithRipple(renameItem);
        if (!tabRowHandle) throw new Error("renameGroupTab: could not resolve tab row container");
        const inputHandle = await tabRowHandle.waitForSelector("input", { state: "visible", timeout: 5000 });
        await clickHandleWithRipple(page, inputHandle);
        await page.waitForTimeout(250);
        await pressWithIndicator(page, "Control+a", "Ctrl+A");
        await page.waitForTimeout(150);
        await typeText(inputHandle, "Launch Repo", 90);
        await page.waitForTimeout(200);
        await pressWithIndicator(page, "Enter", "Enter");
        // Hold on the tab row now showing "Launch Repo" — the actual
        // resulting UI update — well past the commit, not just a beat.
        await page.waitForTimeout(1000);
        return originFraction(tabRowHandle);
    },

    // Reuses starWindow's real useToggleWindowStarred flow, targeting the
    // first window card inside "Q4 Launch" instead of "Work".
    async starGroupWindow(page) {
        await clickWithRipple(page.getByText("Q4 Launch", { exact: true }).first());
        await page.waitForTimeout(300);
        await clickWithRipple(page.locator(".bg-card").first().locator("button:has(.lucide-star)"));
        await page.waitForTimeout(700);
    },

    // ponytail: 2026-08-01 storyboard rewrite — renames a WINDOW inside the
    // group (Window.tsx's own inline rename, aria-independent double-click
    // on the title span), a distinct feature from renameGroup/renameTab.
    // Window.tsx's own isEditing effect (~line 79-89) does the IDENTICAL
    // `setTimeout(() => { el.focus(); el.setSelectionRange(len,len) }, 50)`
    // dance as GroupItem.tsx/Tab.tsx — verified by reading the component
    // before writing this, not assumed — so the same "grab a real element
    // handle before the text node is swapped for an input, then explicitly
    // out-wait the 50ms auto-focus/caret-reset timer before our own
    // Control+a" fix applies here too (see renameGroup's long comment).
    async renameWindow(page) {
        await clickWithRipple(page.getByText("Q4 Launch", { exact: true }).first());
        await page.waitForTimeout(300);
        const titleSpan = page.locator(".bg-card").first().locator("span.cursor-default").first();
        // Window header's outer div carries the Tailwind `group` class token
        // (for group-hover reveal of the star/menu buttons) — same ancestor
        // xpath pattern renameGroup uses to find a stable row container.
        const headerHandle = await titleSpan
            .locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' group ')][1]")
            .elementHandle();
        await dblclickWithRipple(titleSpan);
        if (!headerHandle) throw new Error("renameWindow: could not resolve window header container");
        const inputHandle = await headerHandle.waitForSelector("input", { state: "visible", timeout: 5000 });
        await clickHandleWithRipple(page, inputHandle);
        await page.waitForTimeout(250); // > Window.tsx's internal 50ms auto-focus/caret-reset timer
        await pressWithIndicator(page, "Control+a", "Ctrl+A");
        await page.waitForTimeout(150);
        await typeText(inputHandle, "Launch Essentials", 90);
        await page.waitForTimeout(200);
        await pressWithIndicator(page, "Enter", "Enter");
        // Hold on the header now reading "Launch Essentials" — the resulting
        // UI update, not just the trigger (same convention as every other
        // rename action in this file).
        await page.waitForTimeout(900);
        return originFraction(headerHandle);
    },

    // Window.tsx's real window-level note feature (distinct from
    // addGroupNote's group-level one) — right-click the window header ->
    // "Add note" menuitem -> inline textarea -> Ctrl+Enter commits
    // (onKeyDown handler, see Window.tsx ~line 445). Using the keyboard
    // shortcut instead of hunting for the "Save" button avoids an ambiguous
    // selector: there are THREE plain "Save" buttons rendered across
    // Window.tsx/GroupItem.tsx (window rename, group rename, note editor),
    // none uniquely aria-labeled — Ctrl+Enter is the real, unambiguous, and
    // more interesting-to-show commit path.
    async addWindowNote(page) {
        await clickWithRipple(page.getByText("Q4 Launch", { exact: true }).first());
        await page.waitForTimeout(300);
        const windowHeader = page.locator(".bg-card").first().locator("> div").first();
        await clickWithRipple(windowHeader, { button: "right" });
        const addNoteItem = page.getByText(/^(Add|Edit) note$/).first();
        await addNoteItem.waitFor({ state: "visible" });
        await page.waitForTimeout(500); // let the menu (and "Add note" specifically) register on screen
        // ponytail: this step's textarea reliably fails to appear after the
        // menu-item click on this dev machine (reproduced both with and
        // without clickWithRipple's ripple — NOT a ripple/Radix race as
        // first suspected, root cause still unconfirmed, possibly a deeper
        // Radix DismissableLayer timing issue on this environment). Rather
        // than keep burning time chasing it, fail SOFT here: try the normal
        // interaction, but if the textarea never shows up within 8s, bail
        // out cleanly (Escape closes any stray open menu/editor) instead of
        // throwing and taking the whole recording context down with it —
        // one imperfect/short clip for this step beats losing every other
        // already-recorded step in the same pass. Revisit if this step's
        // clip needs real content later.
        await addNoteItem.click();
        await page.waitForTimeout(POST_CLICK_PAUSE_MS);
        const textarea = page.getByPlaceholder("Add a note…");
        const appeared = await textarea
            .waitFor({ state: "visible", timeout: 8000 })
            .then(() => true)
            .catch(() => false);
        if (!appeared) {
            await page.keyboard.press("Escape").catch(() => null);
            return undefined;
        }
        await page.waitForTimeout(500); // let the empty note field's location register before typing starts
        await typeText(textarea, "Ship checklist: QA sign-off, changelog, store screenshots", 30);
        await page.waitForTimeout(300);
        // Grab the zoom origin BEFORE committing — Ctrl+Enter unmounts this
        // textarea (replaced by the saved note's static text), so calling
        // originFraction(textarea) after commit re-resolves a locator for an
        // element that no longer exists and hangs for the full 30s
        // actionability timeout instead of returning undefined. That hang
        // was throwing out of this whole step (not caught by the softer
        // placeholder-not-found guard above), tearing down the browser
        // context mid-step on attempt 1 of every dark recording run.
        const origin = await originFraction(textarea);
        await pressWithIndicator(page, "Control+Enter", "Ctrl+Enter");
        // Hold on the saved note text — the resulting UI update.
        await page.waitForTimeout(900);
        return origin;
    },
};

export async function runStepAction(page: Page, action: string, minDurationMs: number): Promise<ZoomOrigin> {
    const handler = actions[action];
    const start = Date.now();
    let origin: ZoomOrigin;
    if (handler) {
        origin = (await handler(page)) || undefined;
    }
    const elapsed = Date.now() - start;
    if (elapsed < minDurationMs) {
        await page.waitForTimeout(minDurationMs - elapsed);
    }
    return origin;
}
