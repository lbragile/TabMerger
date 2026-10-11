// Records the feature tour scene 8 footage ("Share a group", Pro), headless, as sharp
// 1600x1200 frames (see lib/tourCapture.ts).
//
// LOCAL STACK ONLY (same mechanism as beta-screenshots-sharing.ts): it creates a throwaway Pro
// user on the local Supabase (keys via `pnpm exec supabase status -o json`, refuses any
// non-local URL), signs the demo-mode extension in as that user through the real modal, sets up
// encryption, and deletes the user (and its rows) at the end. Requires Docker + the local
// Supabase stack running and the existing packages/extension/.output/chrome-mv3-demo build
// (built against the local stack; do not rebuild it here). No web dev server is needed.
//
// Pre-roll (unrecorded): replays scenes 3 to 7 quickly (new group Q4 Launch, Dropbox to its own
// window, Google Calendar and Slack onto Work, window renamed Assets, GitHub note, search
// "slack", Q4 Launch's two windows opened in the real browser), then signs in and waits for sync
// to go quiet. Recorded: selection mode, tick Q4 Launch, the selection bar's Share, the
// "Link copied to clipboard" toast, leave selection mode. The share is proven from the backend
// (one shared_bundles row, ciphertext shape only). Event times are on the grabber clock.
//
// Output (gitignored with the rest of public/tour/):
//   public/tour/frames/<theme>/share-group/f-0001.jpg ...
//   lib/tourShareGroupFootage.json   frame count and event frames (1-based)
//
// Usage:  pnpm --filter @tabmerger/demo record:tour-share-group [dark|light]
import fs from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { getCdpMouse, naturalMouseMove, runStepAction, setPace } from "./lib/actions";
import { frameAt, installCursor, makeGlide, openCleanChaosPopup, startGrabber, writeFrames } from "./lib/tourCapture";

const theme = (process.argv[2] as "light" | "dark" | undefined) ?? "dark";
if (theme !== "light" && theme !== "dark") {
    console.error(`[tour] invalid theme arg "${theme}", expected "light" or "dark"`);
    process.exit(1);
}

const OUT_DIR = path.resolve(__dirname, `public/tour/frames/${theme}/share-group`);
const META_FILE = path.resolve(__dirname, "lib/tourShareGroupFootage.json");

const SETUP_PACE = { postClickMs: 100, typeDelayMs: 30, holdScale: 0.3, keyBadges: false, dragTravel: 1 };
/** Tab indices the drawn windows show as active (see Scene01TheMess MESS_END_ACTIVE). */
const ACTIVE_TAB_INDEX = [3, 1, 3];
/** Where scene 4 parks the pointer at its end (page coordinates). */
const NEUTRAL = { x: 600, y: 500 };

const LEAD_IN_MS = 250;
const HOLD_TOAST_MS = 1700;
const HOLD_AT_END_MS = 900;

const ROOT = path.resolve(__dirname, "../..");
const EMAIL = "tour-share-shots@example.test";
const PASSWORD = "Tour-share-shots-1!";
const PASSPHRASE = "tour-shots-passphrase";

function localKeys() {
    const out = execSync("pnpm exec supabase status -o json", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString();
    const j = JSON.parse(out.slice(out.indexOf("{")));
    return { url: j.API_URL as string, service: j.SERVICE_ROLE_KEY as string };
}
const authHeaders = (service: string) => ({ apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" });

/** Deletes the throwaway user (its rows cascade). Safe to call when it does not exist. */
async function deleteThrowawayUser() {
    const { url, service } = localKeys();
    if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error("refusing to run against non-local Supabase");
    const h = authHeaders(service);
    const existing = await (await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers: h })).json();
    const old = existing.users?.find((u: { email: string }) => u.email === EMAIL);
    if (old) await fetch(`${url}/auth/v1/admin/users/${old.id}`, { method: "DELETE", headers: h });
    return old?.id as string | undefined;
}

/** Fresh throwaway Pro user on the local stack. Returns its id. */
async function createProUser() {
    const { url, service } = localKeys();
    if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error("refusing to run against non-local Supabase");
    const h = authHeaders(service);
    await deleteThrowawayUser();
    const res = await fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers: h, body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }) });
    if (!res.ok) throw new Error("could not create the local throwaway user");
    const id = (await res.json()).id as string;
    // handle_new_user pre-creates a free row (unique(user_id)): UPDATE it to pro.
    const up = await fetch(`${url}/rest/v1/subscriptions?user_id=eq.${id}`, {
        method: "PATCH",
        headers: { ...h, Prefer: "return=minimal" },
        body: JSON.stringify({ tier: "pro", status: "active", current_period_end: "2026-10-29T12:00:00Z" }),
    });
    if (!up.ok) throw new Error(`subscription update failed: ${up.status}`);
    return id;
}

/** Shape-only description of the user's shared_bundles rows (never the content, keys or email). */
async function sharedBundleShape(userId: string) {
    const { url, service } = localKeys();
    const rows = (await (await fetch(`${url}/rest/v1/shared_bundles?user_id=eq.${userId}&select=slug,groups_snapshot`, { headers: authHeaders(service) })).json()) as { slug: string; groups_snapshot: Record<string, unknown> }[];
    return rows.map((r) => ({ slugLength: r.slug.length, snapshotKeys: Object.keys(r.groups_snapshot ?? {}).sort(), ctIsString: typeof r.groups_snapshot?.ct === "string", ctLength: String(r.groups_snapshot?.ct ?? "").length, plaintextGroupNames: JSON.stringify(r.groups_snapshot).includes("Q4 Launch") }));
}

async function main() {
    const userId = await createProUser();
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
        } finally {
            setPace(null);
        }
        // Park exactly where scene 7 ends.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.mouse.move(NEUTRAL.x, NEUTRAL.y);
        glide.setPos(NEUTRAL.x, NEUTRAL.y);
        await page.waitForTimeout(1200);

        // Clipboard permission cannot be granted to chrome-extension:// pages: capture what the app writes.
        await page.evaluate(`Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t) => { window.__copied = t; } }, configurable: true })`);

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
        console.log("[tour] header text after sign-in:", JSON.stringify(await page.evaluate(() => (document.querySelector("header")?.textContent ?? "").replace(/\s+/g, " ").trim().replace(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/g, "<email>"))));

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
        await click("selectClick", page.getByRole("button", { name: "Select items" }));
        await page.waitForTimeout(350);
        const tick = page.getByRole("checkbox", { name: "Select Q4 Launch" });
        await tick.waitFor({ state: "visible", timeout: 5000 });
        await click("groupTick", tick);
        await page.waitForTimeout(500);
        console.log("[tour] selection bar text:", JSON.stringify(((await page.locator("body").innerText()) ?? "").split("\n").filter((l) => /selected|Share|Delete|Move/i.test(l)).slice(0, 8)));
        const share = page.getByRole("button", { name: /^Share/ });
        await click("shareClick", share);
        const toast = page.getByText("Link copied to clipboard");
        await toast.waitFor({ state: "visible", timeout: 12000 });
        mark("toastShown");
        await page.waitForTimeout(HOLD_TOAST_MS);
        await click("cancelClick", page.getByLabel("Cancel selection"));
        {
            const from = await page.evaluate(() => (window as unknown as { __tmLast?: { x: number; y: number } }).__tmLast);
            const a = from ?? NEUTRAL;
            for (let i = 1; i <= 3; i++) {
                await page.mouse.move(a.x + ((NEUTRAL.x - a.x) * i) / 3, a.y + ((NEUTRAL.y - a.y) * i) / 3);
                await page.waitForTimeout(16);
            }
        }
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await toast.waitFor({ state: "hidden", timeout: 12000 }).catch(() => null);
        mark("toastGone");
        await page.waitForTimeout(HOLD_AT_END_MS);
        polling = false;
        await poller;

        const t0 = grabber.t0;
        const caps = await grabber.stop();
        const end = await readPopup(page);
        console.log("[tour] popup at the end", JSON.stringify(end));
        console.log("[tour] windows at the end:", JSON.stringify(await windowTitles(page)));
        console.log("[tour] toasts still on screen at the end:", await page.locator("[data-sonner-toast]").count());
        const copied = (await page.evaluate("window.__copied")) as string | undefined;
        console.log("[tour] link copied:", copied ? `${new URL(copied).origin}/share/<slug>#key=<hidden>` : "NOTHING COPIED");
        console.log("[tour] backend shared_bundles rows for the throwaway user:", JSON.stringify(await sharedBundleShape(userId)));
        void created;
        void nowOpen;

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
        await deleteThrowawayUser().catch((e) => console.error("[tour] could not delete the throwaway user", e));
        console.log("[tour] throwaway local user deleted");
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
