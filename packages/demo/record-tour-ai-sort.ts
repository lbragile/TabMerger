// Records the feature tour scene 10 footage ("Pro AI: auto-group", Pro AI), headless, as sharp
// 1600x1200 frames (see lib/tourCapture.ts).
//
// LOCAL ONLY. A throwaway user on the local Supabase (keys via `pnpm exec supabase status -o json`,
// refuses any non-local URL) with an active Pro AI subscription (tier pro_ai, status active, ai_mode
// managed, ai_monthly_credits 2500) so the real server checks (plan, option, credit reservation)
// pass; deleted with its rows at the end. Needs Docker + the local Supabase stack, the existing
// packages/extension/.output/chrome-mv3-demo build (built against the local stack, VITE_AI_ENABLED
// on) and the web dev server on localhost:3000 (/api/ai/*; started by this script when port 3000 is
// free, stopped afterwards). With `AI_MOCK=true` in packages/web/.env.local (the dev default) the
// model call is the web app's own dev mock (lib/ai-mock.ts: one group per site, deterministic, no
// provider key, no cost); everything else about the request is real. The reply is checked in code.
//
// Pre-roll (unrecorded): scenes 3 to 7 are replayed on the demo profile, then it signs in and sets up
// encryption (as in scenes 8 and 9), so the first recorded frame equals scene 9's device A frame.
// Recorded: open the header's AI menu, click Auto-group, the groups appear (and the toast), open the
// first new group. Event times are on the grabber clock.
//
// Output (gitignored with the rest of public/tour/):
//   public/tour/frames/<theme>/ai-sort/f-0001.jpg ...
//   lib/tourAiSortFootage.json   frame count, event frames (1-based), the groups the AI returned
//
// Usage:  pnpm --filter @tabmerger/demo record:tour-ai-sort [dark|light]
import fs from "node:fs";
import net from "node:net";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { getCdpMouse, naturalMouseMove, runStepAction, setPace } from "./lib/actions";
import { frameAt, installCursor, makeGlide, openCleanChaosPopup, startGrabber, writeFrames } from "./lib/tourCapture";
import { checkAiGroups, parseRowCounts, type AiSortRow } from "./lib/tourAiSortCheck";

const theme = (process.argv[2] as "light" | "dark" | undefined) ?? "dark";
if (theme !== "light" && theme !== "dark") {
    console.error(`[tour] invalid theme arg "${theme}", expected "light" or "dark"`);
    process.exit(1);
}

const OUT_DIR = path.resolve(__dirname, `public/tour/frames/${theme}/ai-sort`);
const META_FILE = path.resolve(__dirname, "lib/tourAiSortFootage.json");

const SETUP_PACE = { postClickMs: 100, typeDelayMs: 30, holdScale: 0.3, keyBadges: false, dragTravel: 1 };
/** Tab indices the drawn windows show as active (see Scene01TheMess MESS_END_ACTIVE). */
const ACTIVE_TAB_INDEX = [3, 1, 3];
/** Where scene 4 parks the pointer at its end (page coordinates). */
const NEUTRAL = { x: 600, y: 500 };

const LEAD_IN_MS = 300;
const HOLD_MENU_MS = 900;
const HOLD_RESULT_MS = 1400;
const HOLD_AT_END_MS = 700;

const ROOT = path.resolve(__dirname, "../..");
const EMAIL = "tour-ai-sort@example.test";
const PASSWORD = "Tour-ai-sort-1!";
const PASSPHRASE = "tour-shots-passphrase";
const WEB_PORT = 3000;

function localKeys() {
    const out = execSync("pnpm exec supabase status -o json", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString();
    const j = JSON.parse(out.slice(out.indexOf("{")));
    const url = j.API_URL as string;
    if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error("refusing to run against non-local Supabase");
    return { url, service: j.SERVICE_ROLE_KEY as string };
}
const authHeaders = (service: string) => ({ apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" });

/** Deletes the throwaway user (its rows cascade). Safe to call when it does not exist. */
async function deleteThrowawayUser() {
    const { url, service } = localKeys();
    const h = authHeaders(service);
    const existing = await (await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers: h })).json();
    const old = existing.users?.find((u: { email: string }) => u.email === EMAIL);
    if (old) await fetch(`${url}/auth/v1/admin/users/${old.id}`, { method: "DELETE", headers: h });
    return old?.id as string | undefined;
}

/** Fresh throwaway Pro AI user on the local stack (managed mode, 2500 credits). Returns its id. */
async function createProAiUser() {
    const { url, service } = localKeys();
    const h = authHeaders(service);
    await deleteThrowawayUser();
    const res = await fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers: h, body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }) });
    if (!res.ok) throw new Error("could not create the local throwaway user");
    const id = (await res.json()).id as string;
    // handle_new_user pre-creates a free row (unique(user_id)): UPDATE it to pro_ai.
    const up = await fetch(`${url}/rest/v1/subscriptions?user_id=eq.${id}`, {
        method: "PATCH",
        headers: { ...h, Prefer: "return=minimal" },
        body: JSON.stringify({ tier: "pro_ai", status: "active", ai_mode: "managed", ai_monthly_credits: 2500, current_period_end: "2099-01-01T00:00:00Z" }),
    });
    if (!up.ok) throw new Error(`subscription update failed: ${up.status}`);
    return id;
}

/** Credits used this month by the throwaway user (a number only, never content). */
async function creditsUsed(userId: string) {
    const { url, service } = localKeys();
    const rows = (await (await fetch(`${url}/rest/v1/ai_usage?user_id=eq.${userId}&select=month,credits_used`, { headers: authHeaders(service) })).json()) as { credits_used: number }[];
    return rows.reduce((n, r) => n + (r.credits_used ?? 0), 0);
}

const portOpen = (port: number) =>
    new Promise<boolean>((resolve) => {
        const s = net.connect(port, "127.0.0.1");
        s.once("connect", () => (s.destroy(), resolve(true)));
        s.once("error", () => resolve(false));
    });

/** Starts `pnpm dev:web` when nothing listens on 3000; returns a stop function (a no-op for the owner's server). */
async function ensureWebServer(): Promise<() => void> {
    if (await portOpen(WEB_PORT)) {
        console.log("[tour] web dev server already on port 3000 (left running)");
        return () => undefined;
    }
    console.log("[tour] starting the web dev server");
    const child: ChildProcess = spawn("pnpm", ["dev:web"], { cwd: ROOT, shell: true, stdio: "ignore" });
    for (let i = 0; i < 120 && !(await portOpen(WEB_PORT)); i++) await new Promise((r) => setTimeout(r, 1000));
    if (!(await portOpen(WEB_PORT))) throw new Error("web dev server did not come up");
    return () => {
        try {
            execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
        } catch {
            /* already gone */
        }
    };
}

async function main() {
    const stopWeb = await ensureWebServer();
    const userId = await createProAiUser();
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
            // the product keeps the query after a pick; scene 6 ends by clicking "Clear search"
            await page.getByTestId("header-clear-search").click();
            await page.waitForFunction(() => document.querySelector('[data-testid="header-clear-search"]') === null, undefined, { timeout: 5000, polling: 20 });
            await page.waitForTimeout(400);

            // --- scene 7 actions (unrecorded): open Q4 Launch two saved windows in the browser ---
            await page.locator("[data-sidebar-group-index]").filter({ has: page.getByText("Q4 Launch", { exact: true }) }).first().click();
            await page.waitForTimeout(400);
            for (const w of [0, 1]) {
                await page.getByLabel("More window options").nth(w).click();
                await page.getByText("Open in browser", { exact: true }).click();
                await page.waitForTimeout(1500);
            }
            await page.waitForFunction(
                () => /^Now Open\s*4.*13$/.test((document.querySelector<HTMLElement>("[data-sidebar-group-index]")?.textContent ?? "").replace(/\s+/g, " ").trim()),
                undefined,
                { timeout: 15000, polling: 100 },
            );
            await page.waitForTimeout(1500);
        } catch (err) {
            console.error("[tour] replay failed; popup state:", JSON.stringify(await readPopup(page).catch(() => null)), JSON.stringify(await windowTitles(page).catch(() => null)));
            throw err;
        } finally {
            setPace(null);
        }
        // Park exactly where scene 7 ends.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.mouse.move(NEUTRAL.x, NEUTRAL.y);
        glide.setPos(NEUTRAL.x, NEUTRAL.y);
        await page.waitForTimeout(1200);

        const checkState = async (label: string) => {
            const st = await readPopup(page);
            console.log(`[tour] state ${label}`, JSON.stringify(st), JSON.stringify(await windowTitles(page)));
            const r = st.rows.join("|");
            if (!/^2 Windows .* 3 Tabs$/.test(st.header ?? "") || !/Work2◆7/.test(r) || !/Q4 Launch2◆3/.test(r) || !/Now Open4◆13/.test(r))
                throw new Error(`[tour] state ${label} does not match scene 7 end (Q4 Launch open, Work 2/7, Now Open 4/13)`);
            if (JSON.stringify(await windowTitles(page)) !== JSON.stringify(["Window", "Assets"])) throw new Error("[tour] the second window is not named Assets");
            if ((await page.locator('[aria-label="Edit tab note"]').count()) !== 1) throw new Error("[tour] the GitHub note icon is missing");
            if ((await page.getByLabel("Cancel selection").count()) > 0) throw new Error("[tour] selection mode is on");
            if ((await page.getByPlaceholder("Add a note…").count()) > 0 || (await page.locator(".fixed.z-50").count()) > 0) throw new Error("[tour] an editor or overlay is open");
        };
        await checkState("before sign-in (scene 7 end)");

        // --- sign in through the real modal, set up encryption (unrecorded) ----------------------
        await page.getByRole("button", { name: /Settings menu|Account menu/ }).click();
        await page.getByRole("menuitem", { name: "Sign in" }).click();
        await page.waitForTimeout(400);
        await page.locator('[role="dialog"]').getByLabel(/email/i).first().fill(EMAIL);
        await page.locator('[role="dialog"]').getByLabel(/password/i).first().fill(PASSWORD);
        await page.locator('[role="dialog"]').getByRole("button", { name: /^sign in$/i }).click();
        await page.getByRole("heading", { name: "Set up encryption" }).waitFor({ timeout: 15000 });
        await page.getByPlaceholder("New passphrase").fill(PASSPHRASE);
        await page.getByPlaceholder("Confirm passphrase").fill(PASSPHRASE);
        await page.getByRole("button", { name: "Set up encryption" }).click();
        await page.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 20000 });
        // Wait for the initial sync push and every toast to go away before recording.
        await page.waitForTimeout(6000);
        await page.waitForFunction(() => document.querySelectorAll("[data-sonner-toast]").length === 0, undefined, { timeout: 15000, polling: 100 });
        await page.mouse.move(NEUTRAL.x, NEUTRAL.y);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.waitForTimeout(1500);
        await checkState("after sign-in");

        const before = await readPopup(page);
        const nowOpenCount = parseRowCounts(before.rows).find((r) => r.name === "Now Open")?.tabs ?? 0;
        const beforeNames = new Set(parseRowCounts(before.rows).map((r) => r.name));

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
        await click("menuClick", page.getByRole("button", { name: "AI actions", exact: true }));
        await page.getByTestId("header-ai-menu").waitFor({ state: "visible", timeout: 5000 });
        mark("menuOpen");
        await page.waitForTimeout(HOLD_MENU_MS);
        await click("autoGroupClick", page.getByTestId("header-ai-auto-group"));
        const toast = page.locator("[data-sonner-toast]").filter({ hasText: /AI (created|added)/ }).first();
        await toast.waitFor({ state: "visible", timeout: 30000 });
        mark("groupsShown");
        const toastText = ((await toast.innerText()) ?? "").replace(/\s+/g, " ");
        await page.waitForTimeout(HOLD_RESULT_MS);

        // The new groups are the rows that were not there before.
        const after = await readPopup(page);
        const rows = parseRowCounts(after.rows);
        const created = rows.filter((r) => !beforeNames.has(r.name));
        const firstNew = page.locator("[data-sidebar-group-index]").filter({ has: page.getByText(created[0]?.name ?? "", { exact: true }) }).first();
        if (created.length > 0) await click("openGroupClick", firstNew);
        await page.mouse.move(NEUTRAL.x, NEUTRAL.y);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.waitForTimeout(HOLD_AT_END_MS);
        mark("end");

        const t0 = grabber.t0;
        const caps = await grabber.stop();
        console.log("[tour] AI toast:", JSON.stringify(toastText));
        console.log("[tour] rows after:", JSON.stringify(after.rows));
        console.log("[tour] credits used this month (managed):", await creditsUsed(userId));
        const problems = checkAiGroups({ nowOpenTabs: nowOpenCount, created });
        if (problems.length) throw new Error(`[tour] the AI result is not usable for the scene: ${problems.join("; ")}`);

        const total = writeFrames(OUT_DIR, caps);
        console.log(`[tour] ${caps.length} grabs for ${total} frames: ${Math.round((Math.min(caps.length, total) / total) * 100)}% new frames`);
        const events = Object.fromEntries(Object.entries(times).map(([name, t]) => [name, frameAt(t, t0)]));
        const meta = fs.existsSync(META_FILE) ? JSON.parse(fs.readFileSync(META_FILE, "utf-8")) : { frames: {}, events: {}, groups: {}, toast: {} };
        meta.frames[theme] = total;
        meta.events[theme] = events;
        meta.groups ??= {};
        meta.groups[theme] = created.map((g) => ({ name: g.name, windows: g.windows, tabs: g.tabs }));
        meta.toast ??= {};
        meta.toast[theme] = toastText;
        fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 4) + "\n");
        console.log(`[tour] ${total} frames (${(total / 30).toFixed(2)}s)`, JSON.stringify(events));
        console.log("[tour] AI groups:", JSON.stringify(created satisfies AiSortRow[]));
    } finally {
        await context.close().catch(() => null);
        await deleteThrowawayUser().catch((e) => console.error("[tour] could not delete the throwaway user", e));
        console.log("[tour] throwaway local user deleted");
        stopWeb();
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
