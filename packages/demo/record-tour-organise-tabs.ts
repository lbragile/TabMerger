// Records the feature tour's scene 4 footage ("Organise by dragging"), headless,
// as sharp 1600x1200 frames (see lib/tourCapture.ts for the capture method).
//
// The popup must start exactly where scene 3 ends, so this first replays scene 3's
// story UNRECORDED and quickly (see record-tour-window.ts for why each step is
// needed): the popup page moves into the third real window, the first Now Open
// window is dragged onto the new-group target, the new "temp group" is renamed
// "Q4 Launch" and coloured pink. Only then does the frame grabber start, and only
// scene 4's own actions are recorded:
//   A. one tab of Q4 Launch (Dropbox) is dragged onto the real "Drop here for a new
//      window" target, so the group shows two windows;
//   B. two tabs (Google Calendar and Slack) are Ctrl-clicked to select them, then
//      dragged together by one grip onto the "Work" sidebar row; the stacked "+2"
//      ghost rides with the pointer and Work gains a new last window.
// Event times are logged on the grabber's clock and stored as frame numbers.
//
// Output (gitignored with the rest of public/tour/):
//   public/tour/frames/<theme>/organise-tabs/f-0001.jpg ...
//   lib/tourOrganiseTabsFootage.json   frame count and event frames (1-based)
//
// Prereq: the existing packages/extension/.output/chrome-mv3-demo build (do not rebuild here)
// Usage:  pnpm --filter @tabmerger/demo record:tour-organise-tabs [dark|light]
import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { getCdpMouse, naturalMouseMove, runStepAction, setPace } from "./lib/actions";
import { frameAt, installCursor, makeGlide, openCleanChaosPopup, startGrabber, writeFrames } from "./lib/tourCapture";

const theme = (process.argv[2] as "light" | "dark" | undefined) ?? "dark";
if (theme !== "light" && theme !== "dark") {
    console.error(`[tour] invalid theme arg "${theme}", expected "light" or "dark"`);
    process.exit(1);
}

const OUT_DIR = path.resolve(__dirname, `public/tour/frames/${theme}/organise-tabs`);
const META_FILE = path.resolve(__dirname, "lib/tourOrganiseTabsFootage.json");

/** Same drag carry speed as scene 3 (record-tour-window.ts). */
const TOUR_PACE = { postClickMs: 120, typeDelayMs: 85, holdScale: 0.45, keyBadges: false, dragTravel: 2.2 };
/** Quick pace for scene 3's unrecorded setup. */
const SETUP_PACE = { postClickMs: 100, typeDelayMs: 30, holdScale: 0.3, keyBadges: false, dragTravel: 1 };
/** Tab indices the drawn windows show as active (see Scene01TheMess MESS_END_ACTIVE). */
const ACTIVE_TAB_INDEX = [3, 1, 3];
/** Where scene 3 parks the pointer at its end (page coordinates); the first frame must show it there. */
const PARK = { x: 600, y: 330 };
/** Blank main-panel space, clear of every row (no hover, no tooltip). */
const NEUTRAL = { x: 600, y: 500 };

const LEAD_IN_MS = 250;
const HOLD_AFTER_A_MS = 450;
const HOLD_SELECTED_MS = 500;
// Short on purpose: a pointer drag held 600ms over a sidebar row springs that group open, which would swap the view to Work.
const HOLD_OVER_ROW_MS = 120;
const HOLD_RESULT_MS = 650;
const HOLD_AT_END_MS = 800;

async function main() {
    const { context, page } = await openCleanChaosPopup(theme);
    try {
        const helper = context.pages().find((p) => p !== page && p.url().startsWith("chrome-extension://"));
        if (!helper) throw new Error("[tour] no second extension page to watch the browser from");

        // --- scene 3's setup (unrecorded) -------------------------------------------------------
        const setup = await helper.evaluate(
            ({ indices, popupUrl }) =>
                new Promise<{ ids: number[]; popupWindow: number }>((resolve) =>
                    chrome.windows.getAll({ populate: true }, (all) => {
                        const web = all.filter((w) => w.tabs?.some((t) => t.url?.startsWith("http")));
                        web.forEach((w, i) => {
                            const tab = w.tabs![indices[i]];
                            if (tab) chrome.tabs.update(tab.id!, { active: true });
                        });
                        const candidates = all.flatMap((w) => w.tabs ?? []).filter((t) => t.url === popupUrl);
                        const target = candidates[candidates.length - 1];
                        chrome.tabs.move(target.id!, { windowId: web[2].id!, index: -1 }, () => {
                            chrome.tabs.update(target.id!, { active: true }, () =>
                                setTimeout(
                                    () =>
                                        chrome.windows.getAll({ populate: true }, (again) =>
                                            resolve({
                                                ids: web.map((w) => w.id!),
                                                popupWindow: again.find((w) => w.tabs?.some((t) => t.id === target.id))!.id!,
                                            }),
                                        ),
                                    600,
                                ),
                            );
                        });
                    }),
                ),
            { indices: ACTIVE_TAB_INDEX, popupUrl: page.url() },
        );
        if (setup.popupWindow !== setup.ids[2]) throw new Error("[tour] the popup page did not end up in the third window");
        await page.setViewportSize({ width: 800, height: 600 });
        await page.waitForTimeout(1200);

        await installCursor(page);
        const glide = makeGlide({ x: 200, y: 430 });
        await page.mouse.move(200, 430);
        setPace({ ...SETUP_PACE, renameGroup: { from: "temp group", to: "Q4 Launch" } });
        try {
            await runStepAction(page, "dragWindowToNewGroup", 0);
            await page
                .waitForFunction(
                    () => {
                        const row = document.querySelector<HTMLElement>("[data-sidebar-group-index]");
                        return /^Now Open\s*2.*10/.test((row?.textContent ?? "").replace(/\s+/g, " ").trim());
                    },
                    undefined,
                    { timeout: 8000, polling: 50 },
                );
            await page.waitForTimeout(600);
            await runStepAction(page, "renameGroup", 0);
            await runStepAction(page, "colorNewGroup", 0);
        } finally {
            setPace(null);
        }
        // Park exactly where scene 3 ends: nothing focused, no tooltip, pointer on blank main-panel space.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.mouse.move(PARK.x, PARK.y);
        glide.setPos(PARK.x, PARK.y);
        await page.waitForTimeout(900);

        // Scene 3's end state, checked before recording a single frame.
        const start = await readPopup(page);
        console.log("[tour] state at the start of scene 4", JSON.stringify(start));
        if (!/^1 Windows? .* 5 Tabs?$/.test(start.header ?? "")) throw new Error("[tour] the setup did not end on Q4 Launch with 1 window and 5 tabs");
        const tabOrder = await gripLabels(page);
        console.log("[tour] tabs before:", JSON.stringify(tabOrder));

        // --- recorded part ----------------------------------------------------------------------
        const grabber = await startGrabber(context, page);
        const times: Record<string, number> = {};
        const mark = (name: string) => {
            times[name] = performance.now();
        };
        setPace({ ...TOUR_PACE });
        const mouse = await getCdpMouse(page);
        const ripple = (x: number, y: number) =>
            page.evaluate(({ x, y }) => (window as unknown as { __tmRipple?: (x: number, y: number) => void }).__tmRipple?.(x, y), { x, y });
        const centre = async (l: Locator) => {
            const b = await l.boundingBox();
            if (!b) throw new Error("[tour] could not resolve an element box");
            return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        };
        const afterDrag = async () => {
            const last = await page.evaluate(() => (window as unknown as { __tmLast?: { x: number; y: number } }).__tmLast);
            if (last) glide.setPos(last.x, last.y);
        };
        /** Glide to the element, log the click moment (~ripple wait before the click), then click it. */
        const click = async (name: string, l: Locator, modifiers?: ("Control")[]) => {
            const c = await centre(l);
            await glide(page, c.x, c.y);
            times[name] = performance.now() + 120;
            await ripple(c.x, c.y);
            await page.waitForTimeout(120);
            await l.click({ modifiers });
            await page.waitForTimeout(120);
        };
        /** Pick up at a grip, carry to the target the caller resolves once the drag is live, release. */
        const drag = async (prefix: string, grip: Locator, target: () => Promise<Locator>, holdOverMs: number) => {
            const g = await centre(grip);
            await glide(page, g.x, g.y);
            times[`${prefix}Grip`] = performance.now() + 120;
            await ripple(g.x, g.y);
            await page.waitForTimeout(200);
            await mouse.move(g.x, g.y);
            await mouse.down();
            mark(`${prefix}Pickup`);
            await mouse.move(g.x, g.y - 6);
            await page.waitForTimeout(250);
            const t = await centre(await target());
            await naturalMouseMove(page, mouse, { x: g.x, y: g.y - 6 }, t, { overshoot: false });
            mark(`${prefix}Over`);
            await page.waitForTimeout(holdOverMs);
            await mouse.up();
            mark(`${prefix}Drop`);
            await afterDrag();
        };

        await page.waitForTimeout(LEAD_IN_MS);
        try {
            // Beat A: Dropbox out into its own window.
            await drag(
                "a",
                page.locator('[aria-label^="Drag to reorder tab: Dropbox"]').first(),
                async () => {
                    const zone = page.getByTestId("new-window-dropzone");
                    await zone.waitFor({ state: "visible", timeout: 5000 });
                    return zone;
                },
                450,
            );
            await page.waitForFunction(
                () => Array.from(document.querySelectorAll<HTMLElement>("*")).some((n) => n.children.length === 0 && /^2 Windows/.test((n.textContent ?? "").trim())),
                undefined,
                { timeout: 5000, polling: 20 },
            );
            mark("aTwoWindows");
            await glide(page, NEUTRAL.x, NEUTRAL.y);
            await page.waitForTimeout(HOLD_AFTER_A_MS);

            // Beat B: select Google Calendar and Slack, drag both onto Work.
            await click("selectCalendar", page.getByText("Google Calendar", { exact: false }).first(), ["Control"]);
            await click("selectSlack", page.getByText("Slack", { exact: false }).first(), ["Control"]);
            await glide(page, NEUTRAL.x, NEUTRAL.y);
            await page.waitForTimeout(HOLD_SELECTED_MS);
            await drag(
                "b",
                page.locator('[aria-label^="Drag to reorder tab: Google Calendar"]').first(),
                async () => page.locator("[data-sidebar-group-index]").filter({ has: page.getByText("Work", { exact: true }) }),
                HOLD_OVER_ROW_MS,
            );
            await page.waitForFunction(
                () => Array.from(document.querySelectorAll<HTMLElement>("[data-sidebar-group-index]")).some((r) => /^Work\s*2\D+7/.test((r.textContent ?? "").replace(/\s+/g, " ").trim())),
                undefined,
                { timeout: 5000, polling: 20 },
            );
            mark("bWorkCounts");
            // Sidebar counts changed (Work 2 windows 7 tabs, Q4 Launch 2 windows 3 tabs): let them read, then leave selection mode.
            await glide(page, NEUTRAL.x, NEUTRAL.y);
            await page.waitForTimeout(HOLD_RESULT_MS);
            await click("cancelSelection", page.getByLabel("Cancel selection"));
            mark("selectionCleared");
        } finally {
            setPace(null);
        }
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await glide(page, NEUTRAL.x, NEUTRAL.y);
        await page.waitForTimeout(HOLD_AT_END_MS);

        const t0 = grabber.t0;
        const caps = await grabber.stop();
        const end = await readPopup(page);
        console.log("[tour] popup at the end", JSON.stringify(end));
        console.log("[tour] tabs after (Q4 Launch):", JSON.stringify(await gripLabels(page)));
        // Not part of the footage any more: open Work and Q4 Launch to prove what is in each from the DOM.
        for (const name of ["Work", "Q4 Launch"]) {
            await page.locator("[data-sidebar-group-index]").filter({ has: page.getByText(name, { exact: true }) }).first().click();
            await page.waitForTimeout(500);
            const windows = await page.evaluate(() =>
                Array.from(document.querySelectorAll<HTMLElement>('[aria-label^="Drag to reorder window"]')).map((g) => {
                    let el: HTMLElement | null = g;
                    while (el && el.querySelectorAll('[aria-label^="Drag to reorder tab"]').length === 0) el = el.parentElement;
                    return Array.from(el?.querySelectorAll<HTMLElement>('[aria-label^="Drag to reorder tab"]') ?? []).map((n) => (n.getAttribute("aria-label") ?? "").replace("Drag to reorder tab: ", ""));
                }),
            );
            console.log(`[tour] ${name} tabs`, JSON.stringify(await gripLabels(page)), "windows", windows.length, (await readPopup(page)).header);
        }

        const total = writeFrames(OUT_DIR, caps);
        const events = Object.fromEntries(Object.entries(times).map(([name, t]) => [name, frameAt(t, t0)]));
        const meta = fs.existsSync(META_FILE) ? JSON.parse(fs.readFileSync(META_FILE, "utf-8")) : { frames: {}, events: {} };
        meta.frames[theme] = total;
        meta.events[theme] = events;
        fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 4) + "\n");
        console.log(`[tour] ${total} frames (${(total / 30).toFixed(2)}s)`, JSON.stringify(events));
    } finally {
        await context.close().catch(() => null);
    }
}

/** The "N Windows ◆ M Tabs" header and every sidebar row's text, straight from the popup DOM. */
function readPopup(page: Page) {
    return page.evaluate(() => {
        const leaf = Array.from(document.querySelectorAll<HTMLElement>("*"))
            .filter((n) => n.children.length === 0)
            .map((n) => (n.textContent ?? "").trim());
        return {
            header: leaf.find((t) => /^\d+ Windows? .* \d+ Tabs?$/.test(t)),
            rows: Array.from(document.querySelectorAll<HTMLElement>("[data-sidebar-group-index]")).map((r) => (r.textContent ?? "").replace(/\s+/g, " ").trim()),
        };
    });
}

/** The visible tab rows' titles, in order (from the drag grips' labels). */
function gripLabels(page: Page) {
    return page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('[aria-label^="Drag to reorder tab"]')).map((n) => (n.getAttribute("aria-label") ?? "").replace("Drag to reorder tab: ", "").slice(0, 28)),
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
