// Records the feature tour's scene 5 footage ("Rename and annotate"), headless, as
// sharp 1600x1200 frames (see lib/tourCapture.ts).
//
// The popup must start exactly where scene 4 ends, so this first replays scene 3's
// and scene 4's stories UNRECORDED and quickly (see record-tour-window.ts and
// record-tour-organise-tabs.ts for why each step is needed): move the popup page
// into window 3, drag window 1 to a new group, rename it "Q4 Launch", colour it
// pink; drag Dropbox into its own window; select Google Calendar and Slack, drag
// them onto Work; cancel the selection. Only then does the frame grabber start
// and only scene 5's own actions are recorded:
//   A. the second window of Q4 Launch (holding Dropbox) is renamed "Window" -> "Assets"
//      (double-click the title, type, Enter);
//   B. a note is added to the GitHub tab (right-click the row, "Add note", type,
//      click Save). The note shows afterwards as a small note icon on the row.
//
// Output (gitignored with the rest of public/tour/):
//   public/tour/frames/<theme>/name-and-note/f-0001.jpg ...
//   lib/tourNameAndNoteFootage.json   frame count and event frames (1-based)
//
// Prereq: the existing packages/extension/.output/chrome-mv3-demo build (do not rebuild here)
// Usage:  pnpm --filter @tabmerger/demo record:tour-name-and-note [dark|light]
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

const OUT_DIR = path.resolve(__dirname, `public/tour/frames/${theme}/name-and-note`);
const META_FILE = path.resolve(__dirname, "lib/tourNameAndNoteFootage.json");

const SETUP_PACE = { postClickMs: 100, typeDelayMs: 30, holdScale: 0.3, keyBadges: false, dragTravel: 1 };
/** Tab indices the drawn windows show as active (see Scene01TheMess MESS_END_ACTIVE). */
const ACTIVE_TAB_INDEX = [3, 1, 3];
/** Where scene 4 parks the pointer at its end (page coordinates). */
const NEUTRAL = { x: 600, y: 500 };

const WINDOW_NAME = "Assets";
const NOTE_TEXT = "Tag the release on Friday";
const TYPE_DELAY_MS = 85; // scene 3's typing pace for names
const NOTE_TYPE_DELAY_MS = 55;
const LEAD_IN_MS = 250;
const HOLD_AFTER_RENAME_MS = 600;
const HOLD_AFTER_NOTE_MS = 300;
const HOLD_AT_END_MS = 1300; // the scene draws a "Note saved" cue over this hold

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
        console.log("[tour] windows before:", JSON.stringify(await windowTitles(page)));

        // --- recorded part ----------------------------------------------------------------------
        const grabber = await startGrabber(context, page);
        const times: Record<string, number> = {};
        const mark = (name: string) => {
            times[name] = performance.now();
        };
        /** Glide to the element, log the click moment (~ripple wait before the click), ripple, then click. */
        const click = async (name: string, l: Locator, options?: Parameters<Locator["click"]>[0]) => {
            const c = await centre(l);
            await glide(page, c.x, c.y);
            times[name] = performance.now() + 120;
            await ripple(c.x, c.y);
            await page.waitForTimeout(120);
            await l.click(options);
            await page.waitForTimeout(120);
        };

        await page.waitForTimeout(LEAD_IN_MS);
        // Beat A: rename the second window.
        const card = page.locator(".bg-card").nth(1);
        const title = card.locator("span.cursor-default").first();
        const header = await title.locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' group ')][1]").elementHandle();
        if (!header) throw new Error("[tour] could not resolve the second window header");
        {
            const c = await centre(title);
            await glide(page, c.x, c.y);
            times.renameDblclick = performance.now() + 120;
            await ripple(c.x, c.y);
            await page.waitForTimeout(120);
            await title.dblclick();
        }
        const input = await header.waitForSelector("input", { state: "visible", timeout: 5000 });
        await page.waitForTimeout(250); // out-wait the window title's own 50ms focus/caret-reset timer
        await page.keyboard.press("Control+a");
        await page.waitForTimeout(100);
        mark("renameTypeStart");
        await input.type(WINDOW_NAME, { delay: TYPE_DELAY_MS });
        await page.waitForTimeout(200);
        mark("renameCommit");
        await page.keyboard.press("Enter");
        await page.waitForFunction((n) => Array.from(document.querySelectorAll("span.cursor-default")).some((s) => s.textContent?.trim() === n), WINDOW_NAME, { timeout: 5000, polling: 20 });
        mark("renamed");
        // The pointer stays on the window title: gliding it down to blank space would sweep it across the Dropbox row (hover highlight, remove button).
        await page.waitForTimeout(HOLD_AFTER_RENAME_MS);

        // Beat B: add a note to the GitHub tab.
        const githubRow = page.getByText("GitHub", { exact: false }).first();
        await click("noteMenuOpen", githubRow, { button: "right" });
        const addNote = page.getByText(/^(Add|Edit) note$/).first();
        await addNote.waitFor({ state: "visible", timeout: 5000 });
        await page.waitForTimeout(250);
        await click("noteItemClick", addNote);
        const textarea = page.getByPlaceholder("Add a note…");
        await textarea.waitFor({ state: "visible", timeout: 5000 });
        await page.waitForTimeout(250);
        mark("noteTypeStart");
        await textarea.pressSequentially(NOTE_TEXT, { delay: NOTE_TYPE_DELAY_MS });
        await page.waitForTimeout(HOLD_AFTER_NOTE_MS);
        mark("noteTyped");
        const save = page.getByRole("button", { name: "Save", exact: true });
        {
            // Same as click(), but with no wait after the click: the pointer must leave the Save position at once.
            const c = await centre(save);
            await glide(page, c.x, c.y);
            times.noteSave = performance.now() + 120;
            await ripple(c.x, c.y);
            await page.waitForTimeout(120);
            await save.click();
        }
        // Leave the Save position at once with a quick flick (about 50ms) to blank space: the editor collapses on the click, and a
        // pointer left there would hover the Dropbox row (fading remove button) or sweep across rows in a normal glide.
        {
            const from = await page.evaluate(() => (window as unknown as { __tmLast?: { x: number; y: number } }).__tmLast);
            const a = from ?? NEUTRAL;
            for (let i = 1; i <= 3; i++) {
                await page.mouse.move(a.x + ((NEUTRAL.x - a.x) * i) / 3, a.y + ((NEUTRAL.y - a.y) * i) / 3);
                await page.waitForTimeout(16);
            }
            glide.setPos(NEUTRAL.x, NEUTRAL.y);
        }
        await page.waitForSelector('[aria-label="Edit tab note"]', { timeout: 5000 });
        mark("noteSaved");
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.waitForTimeout(HOLD_AT_END_MS);

        const t0 = grabber.t0;
        const caps = await grabber.stop();
        const end = await readPopup(page);
        console.log("[tour] popup at the end", JSON.stringify(end));
        console.log("[tour] window names at the end:", JSON.stringify(await windowTitles(page)));
        // Not part of the footage any more: prove the note is on the GitHub row and read its stored text.
        const noteRows = await page.evaluate(() =>
            Array.from(document.querySelectorAll<HTMLElement>('[aria-label="Edit tab note"]')).map((b) => {
                let el: HTMLElement | null = b;
                while (el && !el.querySelector('[aria-label^="Drag to reorder tab"]')) el = el.parentElement;
                return (el?.querySelector('[aria-label^="Drag to reorder tab"]')?.getAttribute("aria-label") ?? "").slice(0, 60);
            }),
        );
        console.log("[tour] rows showing the note icon:", JSON.stringify(noteRows));
        await page.locator('[aria-label="Edit tab note"]').first().click();
        const stored = await page.getByPlaceholder("Add a note…").inputValue();
        console.log("[tour] stored note text:", JSON.stringify(stored));
        await page.keyboard.press("Escape");

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
