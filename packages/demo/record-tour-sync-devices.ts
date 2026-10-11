// Records the feature tour scene 9 footage ("Sync across devices", Pro), headless, as sharp
// 1600x1200 frames from TWO popups at once (see lib/tourCapture.ts for the capture method).
//
// LOCAL STACK ONLY (same mechanism as scene 8 and beta-screenshots-sync.ts): a throwaway Pro user
// on the local Supabase (keys via `pnpm exec supabase status -o json`, refuses any non-local URL),
// deleted with its rows at the end. Requires Docker + the local Supabase stack running and the
// existing packages/extension/.output/chrome-mv3-demo build (built against the local stack).
//
// Device A = the demo-mode profile used by every tour scene: scenes 3 to 7 are replayed unrecorded,
// then it signs in and sets up encryption (as in scene 8) and pushes its groups. Device B = a second,
// plain browser profile (a temp dir, NOT demo mode, so it starts with no groups and can only show what
// synced down) with the same extension build, signed in to the same account and unlocked with the
// same passphrase, unrecorded; its groups arrive on sign-in. Both popups stay open. Recorded: a short
// idle stretch of both popups (nothing to click: live propagation of a change on A took 9 s in a probe
// but is paced by A's 30 s sync poll, so it is not holdable). Both grabbers run in this one process on
// one clock; B frame numbers are stored as an offset from A. The sync is proven from the backend.
//
// Output (gitignored with the rest of public/tour/):
//   public/tour/frames/<theme>/sync-devices/a/f-0001.jpg ... and .../b/f-0001.jpg ...
//   lib/tourSyncDevicesFootage.json   frame counts, B offset, event frames (1-based, A clock)
//
// Usage:  pnpm --filter @tabmerger/demo record:tour-sync-devices [dark|light]
import fs from "node:fs";
import { execSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { chromium, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { getCdpMouse, naturalMouseMove, runStepAction, setPace } from "./lib/actions";
import { frameAt, installCursor, makeGlide, openCleanChaosPopup, startGrabber, writeFrames } from "./lib/tourCapture";

const theme = (process.argv[2] as "light" | "dark" | undefined) ?? "dark";
if (theme !== "light" && theme !== "dark") {
    console.error(`[tour] invalid theme arg "${theme}", expected "light" or "dark"`);
    process.exit(1);
}

const OUT_DIR = path.resolve(__dirname, `public/tour/frames/${theme}/sync-devices`);
const OUT_A = path.join(OUT_DIR, "a");
const OUT_B = path.join(OUT_DIR, "b");
const META_FILE = path.resolve(__dirname, "lib/tourSyncDevicesFootage.json");

const SETUP_PACE = { postClickMs: 100, typeDelayMs: 30, holdScale: 0.3, keyBadges: false, dragTravel: 1 };
/** Tab indices the drawn windows show as active (see Scene01TheMess MESS_END_ACTIVE). */
const ACTIVE_TAB_INDEX = [3, 1, 3];
/** Where scene 4 parks the pointer at its end (page coordinates). */
const NEUTRAL = { x: 600, y: 500 };

const HOLD_MS = 1500;

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

/** Shape-only description of the user's synced groups (never content, keys or email). */
async function syncedGroupsShape(userId: string) {
    const { url, service } = localKeys();
    const rows = (await (await fetch(`${url}/rest/v1/groups?user_id=eq.${userId}&select=name,windows`, { headers: authHeaders(service) })).json()) as { name: unknown; windows: unknown; starred?: boolean }[];
    const enc = (v: unknown) => !!v && typeof v === "object" && Object.keys(v as object).sort().join(",") === "ct,iv,v";
    const plain = ["Work", "Research", "Shopping", "Reading List", "Q4 Launch", "Yahoo", "Slack"];
    const blob = JSON.stringify(rows);
    return { rows: rows.length, windowsIsCiphertext: rows.filter((r) => enc(r.windows)).length, nameKinds: [...new Set(rows.map((r) => (enc(r.name) ? "ciphertext object" : typeof r.name)))], anyKnownPlaintextInRows: plain.filter((w) => blob.includes(w)) };
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

        // --- device B: a second plain profile, same extension build, same account (unrecorded) ----
        const extensionId = page.url().split("/")[2];
        const extDir = path.resolve(process.env.TM_DEMO_EXT_DIR ?? path.resolve(__dirname, "../extension/.output/chrome-mv3-demo"));
        const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "tm-tour-sync-b-"));
        let ctxB: BrowserContext | undefined;
        try {
            ctxB = await chromium.launchPersistentContext(dirB, {
                headless: false,
                viewport: { width: 800, height: 600 },
                deviceScaleFactor: 2,
                colorScheme: theme,
                args: ["--headless=new", `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--window-size=800,600"],
                ...{ storageState: { cookies: [], origins: [{ origin: `chrome-extension://${extensionId}`, localStorage: [{ name: "tabmerger-theme", value: theme }] }] } },
            });
            for (const u of ["https://github.com", "https://developer.mozilla.org", "https://news.ycombinator.com"]) {
                const t = await ctxB.newPage();
                await t.goto(u, { waitUntil: "domcontentloaded" }).catch(() => null);
            }
            const pageB = await ctxB.newPage();
            await pageB.setViewportSize({ width: 800, height: 600 });
            await pageB.goto(`chrome-extension://${extensionId}/popup.html`);
            for (const p of ctxB.pages()) if (p !== pageB && (p.url() === "about:blank" || p.url().startsWith("chrome://"))) await p.close().catch(() => null);
            await pageB.getByRole("button", { name: /Settings menu|Account menu/ }).click();
            await pageB.getByRole("menuitem", { name: "Sign in" }).click();
            await pageB.waitForTimeout(400);
            await pageB.locator('[role="dialog"]').getByLabel(/email/i).first().fill(EMAIL);
            await pageB.locator('[role="dialog"]').getByLabel(/password/i).first().fill(PASSWORD);
            await pageB.locator('[role="dialog"]').getByRole("button", { name: /^sign in$/i }).click();
            await pageB.getByRole("heading", { name: "Unlock encryption" }).waitFor({ timeout: 20000 });
            await pageB.getByPlaceholder("Passphrase", { exact: true }).fill(PASSPHRASE);
            await pageB.getByRole("button", { name: "Unlock", exact: true }).click();
            await pageB.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 20000 });
            const tPull0 = Date.now();
            await pageB.getByText("Q4 Launch", { exact: true }).first().waitFor({ timeout: 60000 });
            console.log("[tour] device B received the groups", Date.now() - tPull0, "ms after unlock");
            await pageB.waitForTimeout(3000);
            await pageB.getByRole("button", { name: "Dismiss" }).click({ timeout: 1500 }).catch(() => null);
            await pageB.locator("[data-sidebar-group-index]").filter({ has: pageB.getByText("Q4 Launch", { exact: true }) }).first().click();
            await pageB.waitForTimeout(500);
            await pageB.mouse.move(NEUTRAL.x, NEUTRAL.y);
            await pageB.waitForFunction(() => document.querySelectorAll("[data-sonner-toast]").length === 0, undefined, { timeout: 15000, polling: 100 });
            await pageB.waitForTimeout(1500);
            const stB = await readPopup(pageB);
            console.log("[tour] device B state", JSON.stringify(stB), JSON.stringify(await windowTitles(pageB)), "notes:", await pageB.locator('[aria-label="Edit tab note"]').count());
            console.log("[tour] device B header text:", JSON.stringify(await pageB.evaluate(() => (document.querySelector("header")?.textContent ?? "").replace(/\s+/g, " ").trim().replace(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/g, "<email>"))));
            console.log("[tour] backend synced groups (shape):", JSON.stringify(await syncedGroupsShape(userId)));

            // --- recorded part: both popups, one clock --------------------------------------------
            const grabberA = await startGrabber(context, page);
            const grabberB = await startGrabber(ctxB, pageB);
            const times: Record<string, number> = {};
            const mark = (name: string) => {
                times[name] = performance.now();
            };
            const rowsOf = (p: Page) => p.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("[data-sidebar-group-index]")).map((r) => (r.textContent ?? "").replace(/\s+/g, " ").trim()));
            console.log("[tour] rows  A:", JSON.stringify(await rowsOf(page)), " B:", JSON.stringify(await rowsOf(pageB)));
            await page.waitForTimeout(HOLD_MS);
            mark("end");

            const tA = grabberA.t0;
            const tB = grabberB.t0;
            const capsA = await grabberA.stop();
            const capsB = await grabberB.stop();
            console.log("[tour] A end", JSON.stringify(await readPopup(page)), "toasts:", await page.locator("[data-sonner-toast]").count());
            console.log("[tour] B end", JSON.stringify(await readPopup(pageB)), "toasts:", await pageB.locator("[data-sonner-toast]").count());
                        const totalA = writeFrames(OUT_A, capsA);
            const totalB = writeFrames(OUT_B, capsB);
            const bOffset = Math.round(((tB - tA) / 1000) * 30);
            const events = Object.fromEntries(Object.entries(times).map(([name, t]) => [name, frameAt(t, tA)]));
            const meta = fs.existsSync(META_FILE) ? JSON.parse(fs.readFileSync(META_FILE, "utf-8")) : { frames: {}, framesB: {}, bOffset: {}, events: {} };
            meta.frames[theme] = totalA;
            meta.framesB ??= {};
            meta.framesB[theme] = totalB;
            meta.bOffset ??= {};
            meta.bOffset[theme] = bOffset;
            meta.events[theme] = events;
            fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 4) + "\n");
            console.log(`[tour] A ${totalA} frames (${(totalA / 30).toFixed(2)}s), B ${totalB} frames, B offset ${bOffset}`, JSON.stringify(events));
        } finally {
            await ctxB?.close().catch(() => null);
            fs.rmSync(dirB, { recursive: true, force: true });
        }
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
