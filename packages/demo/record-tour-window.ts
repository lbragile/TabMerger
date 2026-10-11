// Records the feature tour's scene 3 footage ("Drag a window into a new group,
// name it, colour it"), headless, as sharp 1600x1200 frames (see
// lib/tourCapture.ts for the capture method). Everything is the real
// extension: the first Now Open window card is dragged by its grip onto the
// "Drop for a new group" target (lib/actions.ts dragWindowToNewGroup), the new
// "temp group" is renamed to "Q4 Launch" and coloured pink with the same
// actions the walkthrough uses (renameGroup, colorNewGroup). The popup stays
// open at the end.
//
// Matching the real browser to the story: scene 2 opens TabMerger from window 3's
// toolbar icon, so the popup page is moved into the third real window before
// recording, and the dragged window (the first) is NOT the one TabMerger lives in.
// The extension closes every dragged tab at the drop except the active tab of the
// window the TabMerger page is in, so the first window closes completely; the
// recorder polls the browser for that and logs when. The real windows' active tabs
// are also set to the ones the drawn windows show (GitHub, React, Dribbble).
//
// Output (gitignored with the rest of public/tour/):
//   public/tour/frames/<theme>/window/f-0001.jpg ...
//   lib/tourWindowFootage.json   frame count, event frames (1-based), real timings
//
// Prereq: pnpm --filter @tabmerger/extension build:extension:demo (already built; do not rebuild here)
// Usage:  pnpm --filter @tabmerger/demo record:tour-window [dark|light]
import fs from "node:fs";
import path from "node:path";
import { runStepAction, setPace } from "./lib/actions";
import { frameAt, installCursor, makeGlide, openCleanChaosPopup, startGrabber, writeFrames } from "./lib/tourCapture";

const theme = (process.argv[2] as "light" | "dark" | undefined) ?? "dark";
if (theme !== "light" && theme !== "dark") {
    console.error(`[tour] invalid theme arg "${theme}" — expected "light" or "dark"`);
    process.exit(1);
}

const OUT_DIR = path.resolve(__dirname, `public/tour/frames/${theme}/window`);
const META_FILE = path.resolve(__dirname, "lib/tourWindowFootage.json");

const TOUR_PACE = { postClickMs: 120, typeDelayMs: 85, holdScale: 0.45, keyBadges: false, dragTravel: 2.2 };
const LEAD_IN_MS = 700; // popup idle (the scene's camera is still arriving)
const HOLD_AFTER_DROP_MS = 1900; // the window is gone and "Saved. The window closes." stays readable
const HOLD_AT_END_MS = 900; // the finished name and colour stay on screen
/** Tab indices the drawn windows show as active (see Scene01TheMess MESS_END_ACTIVE). */
const ACTIVE_TAB_INDEX = [3, 1, 3];
/** The pointer-hook calls, in order: drag grip, rename (double-click), rename input, colour dot, swatch, Apply. */
const POINTERS = ["grip", "renameText", "renameInput", "colorDot", "swatch", "apply"] as const;

async function main() {
    const { context, page } = await openCleanChaosPopup(theme);
    try {
        const helper = context.pages().find((p) => p !== page && p.url().startsWith("chrome-extension://"));
        if (!helper) throw new Error("[tour] no second extension page to watch the browser from");

        // Real active tabs = the drawn ones, then move the popup page into window 3 (where scene 2 opened it from).
        const setup = await helper.evaluate(
            ({ indices, popupUrl }) =>
                new Promise<{ ids: number[]; popupTab: number; popupWindow: number; hosts: string[][] }>((resolve) =>
                    chrome.windows.getAll({ populate: true }, (all) => {
                        const web = all.filter((w) => w.tabs?.some((t) => t.url?.startsWith("http")));
                        web.forEach((w, i) => {
                            const tab = w.tabs![indices[i]];
                            if (tab) chrome.tabs.update(tab.id!, { active: true });
                        });
                        const popupTab = all.flatMap((w) => w.tabs ?? []).find((t) => t.url === popupUrl && t.id !== undefined);
                        // The page under test is the newest popup tab (the setup page is the older one).
                        const candidates = all.flatMap((w) => w.tabs ?? []).filter((t) => t.url === popupUrl);
                        const target = candidates[candidates.length - 1] ?? popupTab;
                        chrome.tabs.move(target!.id!, { windowId: web[2].id!, index: -1 }, () => {
                            chrome.tabs.update(target!.id!, { active: true }, () =>
                                setTimeout(
                                    () =>
                                        chrome.windows.getAll({ populate: true }, (again) =>
                                            resolve({
                                                ids: web.map((w) => w.id!),
                                                popupTab: target!.id!,
                                                popupWindow: again.find((w) => w.tabs?.some((t) => t.id === target!.id))!.id!,
                                                hosts: again
                                                    .filter((w) => w.tabs?.some((t) => t.url?.startsWith("http")))
                                                    .map((w) => (w.tabs ?? []).map((t) => `${t.url!.startsWith("http") ? new URL(t.url!).host : "TABMERGER"}${t.active ? "*" : ""}`)),
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
        console.log("[tour] windows after setup (* active)", JSON.stringify(setup.hosts));
        if (setup.popupWindow !== setup.ids[2]) throw new Error("[tour] the popup page did not end up in the third window");
        const draggedWindowId = setup.ids[0];
        await page.setViewportSize({ width: 800, height: 600 });
        await page.waitForTimeout(1200);

        await installCursor(page);
        const grabber = await startGrabber(context, page);
        const glide = makeGlide({ x: 200, y: 430 });
        const times: Record<string, number> = {};
        let pointerCount = 0;
        const pointer = async (p: typeof page, x: number, y: number) => {
            await glide(p, x, y);
            times[POINTERS[pointerCount++]] = performance.now() + 120; // ~ripple wait before the click
        };
        const windowExists = (id: number) =>
            helper.evaluate((wid) => new Promise<boolean>((resolve) => chrome.windows.get(wid, () => resolve(!chrome.runtime.lastError))), id).catch(() => true);
        const mark = (name: string) => {
            times[name] = performance.now();
            if (name !== "drop") return;
            // Prove from the browser (not the footage) when the dragged window is completely gone.
            void (async () => {
                for (let i = 0; i < 400 && times.windowClosed === undefined; i++) {
                    if (!(await windowExists(draggedWindowId))) times.windowClosed = performance.now();
                    else await helper.waitForTimeout(10);
                }
            })();
            // ...and when the popup's Now Open badge reads two windows and ten tabs.
            void page
                .waitForFunction(
                    () => {
                        const row = document.querySelector<HTMLElement>("[data-sidebar-group-index]");
                        return /^Now Open\s*2.*10/.test((row?.textContent ?? "").replace(/\s+/g, " ").trim());
                    },
                    undefined,
                    { timeout: 8000, polling: 20 },
                )
                .then(() => (times.nowOpenTwo = performance.now()))
                .catch(() => null);
        };

        await page.mouse.move(200, 430);
        await page.waitForTimeout(LEAD_IN_MS);
        setPace({ ...TOUR_PACE, pointer, mark, renameGroup: { from: "temp group", to: "Q4 Launch" } });
        try {
            await runStepAction(page, "dragWindowToNewGroup", 0);
            // The drag moved the pointer itself; sync the glide so the next travel starts from there.
            const last = await page.evaluate(() => (window as unknown as { __tmLast?: { x: number; y: number } }).__tmLast);
            if (last) glide.setPos(last.x, last.y);
            await page.waitForTimeout(HOLD_AFTER_DROP_MS);
            await runStepAction(page, "renameGroup", 0);
            await runStepAction(page, "colorNewGroup", 0);
        } finally {
            setPace(null);
        }
        if (pointerCount !== POINTERS.length) throw new Error(`[tour] expected ${POINTERS.length} pointer calls, saw ${pointerCount}`);
        // The colour dot regains focus after Apply (tooltip): blur it and park the pointer on neutral ground.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await glide(page, 600, 330);
        await page.waitForTimeout(HOLD_AT_END_MS);
        if (times.windowClosed === undefined) throw new Error("[tour] the dragged window did NOT close after the drop; stop and report");

        const t0 = grabber.t0;
        const caps = await grabber.stop();
        const state = await helper.evaluate(
            () =>
                new Promise<string[][]>((resolve) =>
                    chrome.windows.getAll({ populate: true }, (all) =>
                        resolve(all.filter((w) => w.type === "normal").map((w) => (w.tabs ?? []).map((t) => (t.url!.startsWith("http") ? new URL(t.url!).host : "TABMERGER") + (t.active ? "*" : "")))),
                    ),
                ),
        );
        console.log("[tour] browser windows at the end", JSON.stringify(state));
        const end = await page.evaluate(() => {
            const leaf = Array.from(document.querySelectorAll<HTMLElement>("*"))
                .filter((n) => n.children.length === 0)
                .map((n) => (n.textContent ?? "").trim());
            return {
                header: leaf.find((t) => /^\d+ Windows? .* \d+ Tabs?$/.test(t)),
                rows: Array.from(document.querySelectorAll<HTMLElement>("[data-sidebar-group-index]")).map((r) => (r.textContent ?? "").replace(/\s+/g, " ").trim()),
            };
        });
        console.log("[tour] popup at the end", JSON.stringify(end));

        const total = writeFrames(OUT_DIR, caps);
        const events = Object.fromEntries(Object.entries(times).map(([name, t]) => [name, frameAt(t, t0)]));
        const meta = fs.existsSync(META_FILE) ? JSON.parse(fs.readFileSync(META_FILE, "utf-8")) : { frames: {}, events: {}, closeAfterReleaseMs: {} };
        delete meta.closeDelayMs;
        delete meta.reopened;
        meta.frames[theme] = total;
        meta.events[theme] = events;
        meta.closeAfterReleaseMs ??= {};
        meta.closeAfterReleaseMs[theme] = Math.round(times.windowClosed - times.drop);
        fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 4) + "\n");
        console.log(`[tour] ${total} frames (${(total / 30).toFixed(2)}s); dragged window fully closed ${Math.round(times.windowClosed - times.drop)}ms after release`, JSON.stringify(events));
    } finally {
        await context.close().catch(() => null);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
