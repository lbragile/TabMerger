// Records the feature tour scene 7 footage ("Restore"), headless, as sharp 1600x1200
// frames (see lib/tourCapture.ts).
//
// The popup must start exactly where scene 6 ends (Work open), so this first replays scenes 3
// to 6 UNRECORDED and quickly (see the earlier tour recorders). Only then does the grabber start
// and only scene 7 is recorded: click the Q4 Launch row, then open each of its two saved windows
// as a real browser window with the window menu "Open in browser" (the group-level "Open all in
// new window" would put every tab in ONE window). A poller on a second extension page logs, on the
// grabber clock, when each real window is created, and the popup's Now Open badge changes are
// logged too, so the drawn windows can appear at the measured moments.
//
// Output (gitignored with the rest of public/tour/):
//   public/tour/frames/<theme>/restore-group/f-0001.jpg ...
//   lib/tourRestoreGroupFootage.json   frame count and event frames (1-based)
//
// Prereq: the existing packages/extension/.output/chrome-mv3-demo build (do not rebuild here)
// Usage:  pnpm --filter @tabmerger/demo record:tour-restore-group [dark|light]
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

const OUT_DIR = path.resolve(__dirname, `public/tour/frames/${theme}/restore-group`);
const META_FILE = path.resolve(__dirname, "lib/tourRestoreGroupFootage.json");

const SETUP_PACE = { postClickMs: 100, typeDelayMs: 30, holdScale: 0.3, keyBadges: false, dragTravel: 1 };
/** Tab indices the drawn windows show as active (see Scene01TheMess MESS_END_ACTIVE). */
const ACTIVE_TAB_INDEX = [3, 1, 3];
/** Where scene 4 parks the pointer at its end (page coordinates). */
const NEUTRAL = { x: 600, y: 500 };

const LEAD_IN_MS = 250;
const HOLD_AT_END_MS = 1200;

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
        /** Quick unrecorded drag: pick up at the grip, carry to the target, release. */
        const quickDrag = async (grip: Locator, target: () => Promise<Locator>, holdOverMs: number) => {
            const g = await centre(grip);
            await page.mouse.move(g.x, g.y);
            await mouse.move(g.x, g.y);
            await mouse.down();
            await mouse.move(g.x, g.y - 6);
            await page.waitForTimeout(250);
            const t = await centre(await target());
            await naturalMouseMove(page, mouse, { x: g.x, y: g.y - 6 }, t, { overshoot: false });
            await page.waitForTimeout(holdOverMs);
            await mouse.up();
            await afterDrag();
        };
        const hasText = (re: RegExp) => (page: Page) =>
            page.waitForFunction(
                (src) => Array.from(document.querySelectorAll<HTMLElement>("*")).some((n) => n.children.length === 0 && new RegExp(src).test((n.textContent ?? "").trim())),
                re.source,
                { timeout: 8000, polling: 30 },
            );

        setPace({ ...SETUP_PACE, renameGroup: { from: "temp group", to: "Q4 Launch" } });
        try {
            await runStepAction(page, "dragWindowToNewGroup", 0);
            await page.waitForFunction(
                () => /^Now Open\s*2.*10/.test((document.querySelector<HTMLElement>("[data-sidebar-group-index]")?.textContent ?? "").replace(/\s+/g, " ").trim()),
                undefined,
                { timeout: 8000, polling: 50 },
            );
            await page.waitForTimeout(600);
            await runStepAction(page, "renameGroup", 0);
            await runStepAction(page, "colorNewGroup", 0);
            await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
            await page.mouse.move(600, 330);
            await page.waitForTimeout(600);

            // --- scene 4's actions (unrecorded) -------------------------------------------------
            await quickDrag(
                page.locator('[aria-label^="Drag to reorder tab: Dropbox"]').first(),
                async () => {
                    const zone = page.getByTestId("new-window-dropzone");
                    await zone.waitFor({ state: "visible", timeout: 5000 });
                    return zone;
                },
                300,
            );
            await hasText(/^2 Windows/)(page);
            await page.getByText("Google Calendar", { exact: false }).first().click({ modifiers: ["Control"] });
            await page.waitForTimeout(150);
            await page.getByText("Slack", { exact: false }).first().click({ modifiers: ["Control"] });
            await page.waitForTimeout(300);
            await quickDrag(
                page.locator('[aria-label^="Drag to reorder tab: Google Calendar"]').first(),
                async () => page.locator("[data-sidebar-group-index]").filter({ has: page.getByText("Work", { exact: true }) }),
                120,
            );
            await page.waitForFunction(
                () => Array.from(document.querySelectorAll<HTMLElement>("[data-sidebar-group-index]")).some((r) => /^Work\s*2\D+7/.test((r.textContent ?? "").replace(/\s+/g, " ").trim())),
                undefined,
                { timeout: 5000, polling: 20 },
            );
            await page.waitForTimeout(300);
            await page.getByLabel("Cancel selection").click();
            await page.waitForTimeout(400);

            // --- scene 5 actions (unrecorded) ---------------------------------------------------
            const title = page.locator(".bg-card").nth(1).locator("span.cursor-default").first();
            const header = await title.locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' group ')][1]").elementHandle();
            await title.dblclick();
            const input = await header!.waitForSelector("input", { state: "visible", timeout: 5000 });
            await page.waitForTimeout(250);
            await page.keyboard.press("Control+a");
            await input.type("Assets", { delay: 20 });
            await page.keyboard.press("Enter");
            await page.waitForFunction(() => Array.from(document.querySelectorAll("span.cursor-default")).some((s) => s.textContent?.trim() === "Assets"), undefined, { timeout: 5000, polling: 20 });
            await page.getByText("GitHub", { exact: false }).first().click({ button: "right" });
            const addNote = page.getByText(/^(Add|Edit) note$/).first();
            await addNote.waitFor({ state: "visible", timeout: 5000 });
            await addNote.click();
            const textarea = page.getByPlaceholder("Add a note…");
            await textarea.waitFor({ state: "visible", timeout: 5000 });
            await textarea.pressSequentially("Tag the release on Friday", { delay: 15 });
            await page.getByRole("button", { name: "Save", exact: true }).click();
            await page.waitForSelector('[aria-label="Edit tab note"]', { timeout: 5000 });

            // --- scene 6 actions (unrecorded): search "slack", pick the Work result ---------------
            await page.getByLabel("Open search").click();
            const sField = page.getByPlaceholder("Search tabs, groups…");
            await sField.waitFor({ state: "visible", timeout: 5000 });
            await sField.pressSequentially("slack", { delay: 20 });
            await page.locator(".fixed.z-50").getByText("Find your workspace", { exact: false }).first().click();
            await page.waitForFunction(() => document.querySelectorAll(".fixed.z-50").length === 0, undefined, { timeout: 5000, polling: 20 });
            await page.waitForTimeout(400);
        } finally {
            setPace(null);
        }
        // Park exactly where scene 4 ends.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.mouse.move(NEUTRAL.x, NEUTRAL.y);
        glide.setPos(NEUTRAL.x, NEUTRAL.y);
        await page.waitForTimeout(1200);

        const start = await readPopup(page);
        console.log("[tour] state at the start of scene 7", JSON.stringify(start));
        const rows = start.rows.join("|");
        if (!/^2 Windows .* 7 Tabs$/.test(start.header ?? "") || !/Work2◆7/.test(rows) || !/Q4 Launch2◆3/.test(rows) || !/Now Open2◆10/.test(rows))
            throw new Error("[tour] the pre-roll did not reproduce scene 6 end state (Work open)");
        if ((await page.getByLabel("Cancel selection").count()) > 0) throw new Error("[tour] selection mode is still on");
        if ((await page.getByPlaceholder("Add a note…").count()) > 0 || (await page.locator(".fixed.z-50").count()) > 0) throw new Error("[tour] an editor or overlay is open");
        
        const realWindows = () =>
            helper.evaluate(
                () =>
                    new Promise<{ id: number; tabs: string[]; type: string }[]>((resolve) =>
                        chrome.windows.getAll({ populate: true }, (all) =>
                            resolve(all.map((w) => ({ id: w.id!, type: w.type ?? "", tabs: (w.tabs ?? []).map((t) => (t.url?.startsWith("http") ? new URL(t.url).host : "TABMERGER") + (t.active ? "*" : "")) }))),
                        ),
                    ),
            );
        const before = await realWindows();
        console.log("[tour] real windows before", JSON.stringify(before));
        const knownIds = new Set(before.map((w) => w.id));

        // --- recorded part ----------------------------------------------------------------------
        const grabber = await startGrabber(context, page);
        const times: Record<string, number> = {};
        const mark = (name: string) => {
            times[name] = performance.now();
        };
        // Background pollers on the grabber clock: new real windows, and the Now Open badge text.
        let polling = true;
        const created: { id: number; t: number }[] = [];
        const nowOpen: { t: number; text: string }[] = [];
        const poller = (async () => {
            while (polling) {
                try {
                    const ws = await realWindows();
                    for (const w of ws) if (!knownIds.has(w.id)) { knownIds.add(w.id); created.push({ id: w.id, t: performance.now() }); }
                    const text = await page.evaluate(() => (document.querySelector<HTMLElement>("[data-sidebar-group-index]")?.textContent ?? "").replace(/\s+/g, " ").trim());
                    if (nowOpen.length === 0 || nowOpen[nowOpen.length - 1].text !== text) nowOpen.push({ t: performance.now(), text });
                } catch { /* page gone */ }
                await new Promise((r) => setTimeout(r, 25));
            }
        })();
        const click = async (name: string, l: Locator) => {
            const c = await centre(l);
            await glide(page, c.x, c.y);
            times[name] = performance.now() + 120;
            await ripple(c.x, c.y);
            await page.waitForTimeout(120);
            await l.click();
        };

        await page.waitForTimeout(LEAD_IN_MS);
        await click("groupClick", page.locator("[data-sidebar-group-index]").filter({ has: page.getByText("Q4 Launch", { exact: true }) }).first());
        await page.waitForTimeout(500);
        for (const w of [0, 1]) {
            await click(`menu${w}`, page.getByLabel("More window options").nth(w));
            const item = page.getByText("Open in browser", { exact: true });
            await item.waitFor({ state: "visible", timeout: 5000 });
            await page.waitForTimeout(250);
            await click(`open${w}`, item);
            // wait for the new real window and its tabs before the next open
            const t0w = performance.now();
            while (created.length < w + 1 && performance.now() - t0w < 8000) await page.waitForTimeout(25);
            await page.waitForTimeout(500);
        }
        // let the real windows fill with tabs and the Now Open badge settle
        {
            let last = nowOpen.length;
            let stable = performance.now();
            const limit = performance.now() + 9000;
            while (performance.now() < limit && performance.now() - stable < 1500) {
                await page.waitForTimeout(100);
                if (nowOpen.length !== last) { last = nowOpen.length; stable = performance.now(); }
            }
        }
        // Leave the last click with a quick flick to blank space (a glide would sweep across rows).
        {
            const from = await page.evaluate(() => (window as unknown as { __tmLast?: { x: number; y: number } }).__tmLast);
            const a = from ?? NEUTRAL;
            for (let i = 1; i <= 3; i++) {
                await page.mouse.move(a.x + ((NEUTRAL.x - a.x) * i) / 3, a.y + ((NEUTRAL.y - a.y) * i) / 3);
                await page.waitForTimeout(16);
            }
        }
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.waitForTimeout(HOLD_AT_END_MS);
        polling = false;
        await poller;

        const t0 = grabber.t0;
        const caps = await grabber.stop();
        const end = await readPopup(page);
        console.log("[tour] popup at the end", JSON.stringify(end));
        console.log("[tour] windows at the end:", JSON.stringify(await windowTitles(page)));
        console.log("[tour] real windows after", JSON.stringify(await realWindows()));
        console.log("[tour] new real windows (ms after groupClick):", JSON.stringify(created.map((c) => ({ id: c.id, ms: Math.round(c.t - times.groupClick) }))));
        console.log("[tour] Now Open badge changes (ms after groupClick):", JSON.stringify(nowOpen.map((n) => ({ ms: Math.round(n.t - times.groupClick), text: n.text }))));
        console.log("[tour] Q4 Launch tabs:", JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[aria-label^="Drag to reorder tab"]')).map((n) => (n.getAttribute("aria-label") ?? "").replace("Drag to reorder tab: ", "").slice(0, 30)))));
        created.forEach((c, i) => (times[`windowCreated${i}`] = c.t));
        nowOpen.slice(1).forEach((n, i) => (times[`nowOpen${i}`] = n.t));

        const total = writeFrames(OUT_DIR, caps);
        const events = Object.fromEntries(Object.entries(times).map(([name, t]) => [name, frameAt(t, t0)]));
        const meta = fs.existsSync(META_FILE) ? JSON.parse(fs.readFileSync(META_FILE, "utf-8")) : { frames: {}, events: {}, nowOpenTexts: {} };
        meta.frames[theme] = total;
        meta.events[theme] = events;
        meta.nowOpenTexts ??= {};
        meta.nowOpenTexts[theme] = nowOpen.map((n) => n.text);
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

/** Window titles shown in the main panel. */
function windowTitles(page: Page) {
    return page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("span.cursor-default")).map((s) => (s.textContent ?? "").trim()));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
