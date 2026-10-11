// Records the feature tour scene 6 footage ("Find a tab"), headless, as sharp
// 1600x1200 frames (see lib/tourCapture.ts).
//
// The popup must start exactly where scene 5 ends, so this first replays scenes 3, 4
// and 5 UNRECORDED and quickly (see record-tour-window.ts, record-tour-organise-tabs.ts
// and record-tour-find-a-tab.ts): new group "Q4 Launch" (pink), Dropbox into its own
// window, Google Calendar and Slack onto Work, the second window renamed "Assets", a note on
// the GitHub tab. Only then does the frame grabber start and only scene 6 is recorded:
// click the search field, type "slack", the results (across all groups) show with their group
// names, and the result for the Slack tab that lives in Work is clicked, which switches the
// popup to that group and clears the query. Event times are logged on the grabber clock.
//
// Output (gitignored with the rest of public/tour/):
//   public/tour/frames/<theme>/find-a-tab/f-0001.jpg ...
//   lib/tourFindATabFootage.json   frame count and event frames (1-based)
//
// Prereq: the existing packages/extension/.output/chrome-mv3-demo build (do not rebuild here)
// Usage:  pnpm --filter @tabmerger/demo record:tour-find-a-tab [dark|light]
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

const OUT_DIR = path.resolve(__dirname, `public/tour/frames/${theme}/find-a-tab`);
const META_FILE = path.resolve(__dirname, "lib/tourFindATabFootage.json");

const SETUP_PACE = { postClickMs: 100, typeDelayMs: 30, holdScale: 0.3, keyBadges: false, dragTravel: 1 };
/** Tab indices the drawn windows show as active (see Scene01TheMess MESS_END_ACTIVE). */
const ACTIVE_TAB_INDEX = [3, 1, 3];
/** Where scene 4 parks the pointer at its end (page coordinates). */
const NEUTRAL = { x: 600, y: 500 };

const QUERY = "slack";
const TYPE_DELAY_MS = 85; // scene 3 typing pace for names
const LEAD_IN_MS = 250;
const HOLD_RESULTS_MS = 1500;
const HOLD_AT_END_MS = 1000;

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
        } finally {
            setPace(null);
        }
        // Park exactly where scene 4 ends.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.mouse.move(NEUTRAL.x, NEUTRAL.y);
        glide.setPos(NEUTRAL.x, NEUTRAL.y);
        await page.waitForTimeout(1200);

        const start = await readPopup(page);
        console.log("[tour] state at the start of scene 5", JSON.stringify(start));
        const rows = start.rows.join("|");
        if (!/^2 Windows .* 3 Tabs$/.test(start.header ?? "") || !/Work2◆7/.test(rows) || !/Q4 Launch2◆3/.test(rows) || !/Now Open2◆10/.test(rows))
            throw new Error("[tour] the pre-roll did not reproduce scene 4's end state");
        if ((await page.getByLabel("Cancel selection").count()) > 0) throw new Error("[tour] selection mode is still on");
        if (JSON.stringify(await windowTitles(page)) !== JSON.stringify(["Window", "Assets"])) throw new Error("[tour] the second window is not named Assets");
        if ((await page.locator('[aria-label="Edit tab note"]').count()) !== 1) throw new Error("[tour] the GitHub note icon is missing");
        if ((await page.getByPlaceholder("Add a note…").count()) > 0 || (await page.locator(".fixed.z-50").count()) > 0) throw new Error("[tour] an editor or overlay is open");
        console.log("[tour] windows before:", JSON.stringify(await windowTitles(page)));

        // --- recorded part ----------------------------------------------------------------------
        const grabber = await startGrabber(context, page);
        const times: Record<string, number> = {};
        const mark = (name: string) => {
            times[name] = performance.now();
        };
        const click = async (name: string, l: Locator) => {
            const c = await centre(l);
            await glide(page, c.x, c.y);
            times[name] = performance.now() + 120;
            await ripple(c.x, c.y);
            await page.waitForTimeout(120);
            await l.click();
        };

        await page.waitForTimeout(LEAD_IN_MS);
        await click("searchClick", page.getByLabel("Open search"));
        const field = page.getByPlaceholder("Search tabs, groups…");
        await field.waitFor({ state: "visible", timeout: 5000 });
        await page.waitForTimeout(300);
        mark("typeStart");
        await field.pressSequentially(QUERY, { delay: TYPE_DELAY_MS });
        const overlay = page.locator(".fixed.z-50");
        const row = overlay.getByText("Find your workspace", { exact: false }).first();
        await row.waitFor({ state: "visible", timeout: 5000 });
        mark("resultsShown");
        console.log("[tour] overlay text with results:", JSON.stringify(((await overlay.innerText()) ?? "").replace(/\s+/g, " ").slice(0, 600)));
        await page.waitForTimeout(HOLD_RESULTS_MS);
        await click("resultClick", row);
        await page.waitForFunction(() => document.querySelectorAll(".fixed.z-50").length === 0, undefined, { timeout: 5000, polling: 20 });
        mark("overlayClosed");
        // Leave with a quick flick to blank space (a glide would sweep the pointer across rows).
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

        const t0 = grabber.t0;
        const caps = await grabber.stop();
        const end = await readPopup(page);
        console.log("[tour] popup at the end", JSON.stringify(end));
        console.log("[tour] search field text at the end:", JSON.stringify(await page.getByLabel("Open search").innerText()));
        console.log("[tour] windows at the end:", JSON.stringify(await windowTitles(page)));
        console.log("[tour] tabs shown at the end:", JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[aria-label^="Drag to reorder tab"]')).map((n) => (n.getAttribute("aria-label") ?? "").replace("Drag to reorder tab: ", "").slice(0, 30)))));

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

/** Window titles shown in the main panel. */
function windowTitles(page: Page) {
    return page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("span.cursor-default")).map((s) => (s.textContent ?? "").trim()));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
