// Captures the "Sharing" test-area images for the beta guide
// (share-extension / share-page / share-page-previews / share-dashboard.webp
// in packages/web/public/beta). Sibling of beta-screenshots.ts so re-running
// it never overwrites the other beta images.
//
// LOCAL STACK ONLY: creates a throwaway Pro user on the local Supabase
// (http://127.0.0.1:54321, keys via `supabase status -o json`), signs the
// demo-mode extension in as that user, shares groups through the real
// selection-bar Share action, reads the copied link back from the clipboard,
// then opens that link on the local web app (http://localhost:3000).
// Requires: local Supabase + web dev server running, and
// `pnpm --filter @tabmerger/extension build:extension:demo` built against
// the local stack (extension .env.local points at 127.0.0.1:54321).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { chromium, type Page } from "@playwright/test";
process.env.TM_DEMO_EXT_DIR ??= path.resolve(__dirname, ".pw-ext-dev");
import { launchDemoContext } from "./lib/launchDemoContext";

const OUT_DIR = path.resolve(__dirname, "../web/public/beta");
const ROOT = path.resolve(__dirname, "../..");
const WEB = "http://localhost:3000";
const EMAIL = "beta-sharing-shots@example.test";
const PASSWORD = "Beta-sharing-shots-1!";
const PASSPHRASE = "beta-shots-passphrase";

function localKeys() {
    const out = execSync("pnpm exec supabase status -o json", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString();
    const j = JSON.parse(out.slice(out.indexOf("{")));
    return { url: j.API_URL as string, service: j.SERVICE_ROLE_KEY as string, anon: j.ANON_KEY as string };
}

async function ensureProUser() {
    const { url, service } = localKeys();
    if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error("refusing to run against non-local Supabase");
    const h = { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" };
    // Start from a clean account every run (fresh encryption state, no old
    // synced groups): delete any previous throwaway user, then recreate.
    const existing = await (await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers: h })).json();
    const old = existing.users?.find((u: { email: string }) => u.email === EMAIL);
    if (old) await fetch(`${url}/auth/v1/admin/users/${old.id}`, { method: "DELETE", headers: h });
    let res = await fetch(`${url}/auth/v1/admin/users`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
    });
    let id: string | undefined;
    if (res.ok) id = (await res.json()).id;
    else {
        const list = await (await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers: h })).json();
        id = list.users.find((u: { email: string }) => u.email === EMAIL)?.id;
    }
    if (!id) throw new Error("could not create/find local test user");
    // handle_new_user pre-creates a free row (unique(user_id)) — UPDATE it to pro.
    res = await fetch(`${url}/rest/v1/subscriptions?user_id=eq.${id}`, {
        method: "PATCH",
        headers: { ...h, Prefer: "return=minimal" },
        body: JSON.stringify({ tier: "pro", status: "active", current_period_end: "2026-10-29T12:00:00Z" }),
    });
    if (!res.ok) throw new Error(`subscription upsert failed: ${res.status} ${await res.text()}`);
}

async function saveWebp(page: Page, file: string, quality = 92) {
    const cdp = await page.context().newCDPSession(page);
    const { data } = await cdp.send("Page.captureScreenshot", {
        format: "webp",
        quality,
        clip: { x: 0, y: 0, width: 800, height: 600, scale: 2 },
    });
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    console.log(`[beta-sharing] saved ${path.basename(file)} (${(fs.statSync(file).size / 1024).toFixed(1)} KB)`);
}

async function phaseExtension() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    await ensureProUser();
    const { context, page } = await launchDemoContext(undefined, 2, "light");
    // Clipboard permissions can't be granted to chrome-extension:// origins
    // (opaque origin), so capture what the app writes instead of reading back.
    // (string evaluate: tsx injects __name helpers that don't exist in the page)
    await page.evaluate(
        `Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t) => { window.__copied = t; } }, configurable: true })`,
    );

    // Sign in through the real modal.
    await page.getByRole("button", { name: /Settings menu|Account menu/ }).click();
    await page.getByRole("menuitem", { name: "Sign in" }).click();
    await page.waitForTimeout(400);
    await page.getByLabel(/email/i).first().fill(EMAIL);
    await page.getByLabel(/password/i).first().fill(PASSWORD);
    await page.locator('[role="dialog"]').getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("heading", { name: "Set up encryption" }).waitFor({ timeout: 10000 });
    await page.waitForTimeout(2600); // let the "Signed in" toast slide in fully
    await saveWebp(page, path.join(OUT_DIR, "encryption-setup.webp"));

    // Complete setup so the account is a normal unlocked Pro user.
    await page.getByPlaceholder("New passphrase").fill(PASSPHRASE);
    await page.getByPlaceholder("Confirm passphrase").fill(PASSPHRASE);
    await page.getByRole("button", { name: "Set up encryption" }).click();
    await page.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 15000 });
    await page.waitForTimeout(3500); // initial sync push + toast dismiss

    // Multi-window group for "Sharing a group with many windows".
    await page.getByText("Research", { exact: true }).first().click();
    await page.getByText("Research", { exact: true }).first().click({ button: "right" });
    await page.waitForTimeout(300);
    await page.getByText("Split windows", { exact: true }).click();
    await page.waitForTimeout(800);

    // Selection mode -> tick two groups -> Share.
    await page.getByRole("button", { name: "Select items" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("checkbox", { name: "Select Work" }).click().catch(async () => page.getByLabel("Select Work").click());
    await page.getByRole("checkbox", { name: "Select Research" }).click().catch(async () => page.getByLabel("Select Research").click());
    await page.waitForTimeout(300);
    await page.mouse.move(0, 0);
    // Entry point: the selection bar with "Share" visible (before the toast covers it).
    await saveWebp(page, path.join(OUT_DIR, "share-extension.webp"));
    await page.getByRole("button", { name: /^Share/ }).click();
    await page.getByText("Link copied to clipboard").waitFor({ timeout: 10000 });
    await page.waitForTimeout(900);
    await page.mouse.move(0, 0);
    await saveWebp(page, path.join(OUT_DIR, "share-extension-toast.webp"));
    const copied = (await page.evaluate("window.__copied")) as string;
    console.log("[beta-sharing] share link host:", new URL(copied).origin, "(key in fragment, not printed)");
    fs.writeFileSync(path.join(process.env.TEMP ?? ".", "beta-share-url.txt"), copied);

    // ---- Settings (signed in, Pro) ------------------------------------------
    await page.getByRole("button", { name: "Exit selection mode" }).click();
    await page.waitForTimeout(3500);
    await openSettings(page);
    await page.getByRole("tab", { name: "Account", exact: true }).click();
    await page.waitForTimeout(600);
    await saveWebp(page, path.join(OUT_DIR, "settings-account.webp"));
    // Reset-encryption confirm dialog.
    await page.getByRole("button", { name: /Reset encryption/ }).click();
    await page.waitForTimeout(500);
    await saveWebp(page, path.join(OUT_DIR, "encryption-reset.webp"));
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(400);
    // General tab: cloud sync + stale threshold + URL rules, then an edit for "Unsaved changes".
    if (!(await page.getByRole("tab", { name: "General", exact: true }).isVisible().catch(() => false))) await openSettings(page);
    await page.getByRole("tab", { name: "General", exact: true }).click();
    await page.waitForTimeout(500);
    // Scroll the General tab down to Stale tab threshold + URL rules (+ Cloud sync).
    await page.getByText("URL rules", { exact: true }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.mouse.move(0, 0);
    await saveWebp(page, path.join(OUT_DIR, "settings-urlrules.webp"));
    await page.getByRole("button", { name: "Manage" }).click();
    await page.waitForTimeout(600);
    await saveWebp(page, path.join(OUT_DIR, "settings-urlrules-manager.webp"));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    // Unsaved-changes indicator: reopen Settings, flip a switch, don't save.
    if (!(await page.getByRole("tab", { name: "General", exact: true }).isVisible().catch(() => false))) await openSettings(page);
    await page.getByRole("switch").first().click();
    await page.waitForTimeout(400);
    await page.mouse.move(0, 0);
    await saveWebp(page, path.join(OUT_DIR, "settings-unsaved.webp"));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    await context.close();
}

async function openSettings(page: Page) {
    await page.getByRole("button", { name: /Settings menu|Account menu/ }).click();
    await page.waitForTimeout(200);
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await page.waitForTimeout(400);
}


// ---------------------------------------------------------------------------
// Phase 2: a SECOND device (fresh profile) signing in to the same account �
// the passphrase is not on this device yet, so the extension asks to unlock.
async function phaseSecondDevice() {
    const { context, page } = await launchDemoContext(undefined, 2, "light");
    await page.getByRole("button", { name: /Settings menu|Account menu/ }).click();
    await page.getByRole("menuitem", { name: "Sign in" }).click();
    await page.waitForTimeout(400);
    await page.getByLabel(/email/i).first().fill(EMAIL);
    await page.getByLabel(/password/i).first().fill(PASSWORD);
    await page.locator('[role="dialog"]').getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("heading", { name: "Unlock encryption" }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(2600);
    await saveWebp(page, path.join(OUT_DIR, "encryption-unlock.webp"));
    await context.close();
}

// ---------------------------------------------------------------------------
// Phase 3: the web app (headless Chromium, 1200x900 CSS px captured at
// scale 4/3 so the file is 1600x1200 like every other beta image).
async function saveWebWebp(page: Page, file: string, quality = 90) {
    const cdp = await page.context().newCDPSession(page);
    const { data } = await cdp.send("Page.captureScreenshot", {
        format: "webp",
        quality,
        clip: { x: 0, y: 0, width: 1200, height: 900, scale: 1600 / 1200 },
    });
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    console.log(`[beta-sharing] saved ${path.basename(file)} (${(fs.statSync(file).size / 1024).toFixed(1)} KB)`);
}

// Same as saveWebWebp but for a scrolled page: clip is in page (document)
// coordinates, so offset it by the current scroll position.
async function saveWebWebpScrolled(page: Page, file: string, quality = 90) {
    const y = (await page.evaluate("window.scrollY")) as number;
    const cdp = await page.context().newCDPSession(page);
    const { data } = await cdp.send("Page.captureScreenshot", {
        format: "webp",
        quality,
        clip: { x: 0, y, width: 1200, height: 900, scale: 1600 / 1200 },
    });
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    console.log(`[beta-sharing] saved ${path.basename(file)} (${(fs.statSync(file).size / 1024).toFixed(1)} KB)`);
}

async function phaseWeb() {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, colorScheme: "light" });
    const page = await ctx.newPage();

    // Recipient view: signed out, straight from the copied link.
    const url = fs.readFileSync(path.join(process.env.TEMP ?? ".", "beta-share-url.txt"), "utf8").trim();
    await page.goto(url, { waitUntil: "networkidle" });
    // Hide Next's dev-mode "N" indicator bubble.
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.getByText("Shared collection").waitFor();
    await page.waitForTimeout(1500);
    await saveWebWebp(page, path.join(OUT_DIR, "share-page.webp"));

    // Many-windows group: scroll the Research group (4 windows) into the frame.
    await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });
    await page.addStyleTag({ content: "footer{display:none!important}" });
    await page.evaluate("window.scrollTo({ top: 99999, behavior: 'instant' })");
    await page.waitForTimeout(500);
    await saveWebWebpScrolled(page, path.join(OUT_DIR, "share-page-windows.webp"));
    await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");

    // Preview switch -> confirm dialog.
    await page.getByRole("switch", { name: "Show page previews" }).click();
    await page.waitForTimeout(600);
    await saveWebWebp(page, path.join(OUT_DIR, "share-page-previews.webp"));

    await browser.close();
}

// Phase 4: the signed-in web dashboard (same account, so it holds the
// encrypted groups pushed in phase "ext"): locked state, then unlocked.
async function saveDashWebp(page: Page, file: string, quality = 90) {
    const y = (await page.evaluate("window.scrollY")) as number;
    const cdp = await page.context().newCDPSession(page);
    const { data } = await cdp.send("Page.captureScreenshot", {
        format: "webp",
        quality,
        clip: { x: 0, y, width: 1600, height: 1200, scale: 1 },
    });
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    console.log(`[beta-sharing] saved ${path.basename(file)} (${(fs.statSync(file).size / 1024).toFixed(1)} KB)`);
}

async function phaseDashboard() {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, colorScheme: "light", permissions: ["clipboard-read", "clipboard-write"] });
    const page = await ctx.newPage();
    await page.goto(`${WEB}/auth/sign-in`, { waitUntil: "networkidle" });
    await page.getByLabel(/email/i).first().fill(EMAIL);
    await page.getByLabel(/password/i).first().fill(PASSWORD);
    await page.locator(`form button[type="submit"]`).click();
    await page.waitForURL(/dashboard/, { timeout: 30000 });
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}html{scroll-behavior:auto!important}" });
    await page.waitForTimeout(2500);
    // 1600x1200 viewport at scale 1 = a 1600x1200 file, with room for stats + groups.
    await page.setViewportSize({ width: 1600, height: 1200 });
    await page.waitForTimeout(800);
    await page.getByText("Tab Groups", { exact: true }).scrollIntoViewIfNeeded();
    await page.evaluate("window.scrollTo({ top: 99999, behavior: 'instant' })");
    await page.waitForTimeout(400);
    await saveDashWebp(page, path.join(OUT_DIR, "dashboard-passphrase.webp"));

    await page.getByPlaceholder("Passphrase").fill(PASSPHRASE);
    await page.getByRole("button", { name: "Unlock" }).click();
    await page.getByText("(locked)").first().waitFor({ state: "hidden", timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(2000);
    await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
    await page.screenshot({ path: path.join(process.env.TEMP ?? ".", "dbg-dash-unlocked.png"), fullPage: true });
    await saveDashWebp(page, path.join(OUT_DIR, "dashboard-groups.webp"));

    // Share button on a group card -> "Link copied" toast.
    await page.getByText("Share", { exact: true }).nth(1).click(); // Work's card
    await page.getByText(/Link copied/).first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(900);
    await page.mouse.move(0, 0);
    await saveDashWebp(page, path.join(OUT_DIR, "share-dashboard.webp"));

    await browser.close();
}

const PHASES: Record<string, () => Promise<void>> = { ext: phaseExtension, device2: phaseSecondDevice, web: phaseWeb, dashboard: phaseDashboard };
const wanted = process.argv.slice(2);
(async () => {
    for (const name of wanted.length ? wanted : Object.keys(PHASES)) await PHASES[name]();
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
