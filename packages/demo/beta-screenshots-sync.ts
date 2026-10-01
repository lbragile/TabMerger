// Captures the "Sign-in and sync across devices" beta-guide images
// (sync-device-a/b, sync-rename-a/b, sync-delete-a/b .webp). Two separate
// persistent browser profiles = two "devices" signed into ONE throwaway LOCAL
// Pro account. LOCAL STACK ONLY (127.0.0.1:54321 + localhost:3000).
// Device A: demo-mode profile (canned groups). Device B: a plain fresh profile
// (no demo data, so it can only show what synced down), unlocked with the
// passphrase. Sync runs in the popup (useSync: on mount + every 30 s), so B is
// "reopened" like a real user would to pull changes.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
process.env.TM_DEMO_EXT_DIR ??= path.resolve(__dirname, ".pw-ext-dev");
process.env.TM_DEMO_USER_DATA_DIR ??= path.resolve(__dirname, ".pw-user-sync-a");
import { launchDemoContext } from "./lib/launchDemoContext";
import { saveWebp, settle } from "./lib/betaShot";

const ROOT = path.resolve(__dirname, "../..");
const EMAIL = "beta-sync-shots@example.test";
const PASSWORD = "Beta-sync-shots-1!";
const PASSPHRASE = "beta-shots-passphrase";
const DIR_B = path.resolve(__dirname, ".pw-user-sync-b");

function localKeys() {
    const out = execSync("pnpm exec supabase status -o json", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString();
    const j = JSON.parse(out.slice(out.indexOf("{")));
    return { url: j.API_URL as string, service: j.SERVICE_ROLE_KEY as string };
}

async function ensureProUser() {
    const { url, service } = localKeys();
    if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error("refusing to run against non-local Supabase");
    const h = { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" };
    const existing = await (await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers: h })).json();
    const old = existing.users?.find((u: { email: string }) => u.email === EMAIL);
    if (old) await fetch(`${url}/auth/v1/admin/users/${old.id}`, { method: "DELETE", headers: h });
    const res = await fetch(`${url}/auth/v1/admin/users`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
    });
    if (!res.ok) throw new Error("could not create local test user");
    const id = (await res.json()).id;
    const up = await fetch(`${url}/rest/v1/subscriptions?user_id=eq.${id}`, {
        method: "PATCH",
        headers: { ...h, Prefer: "return=minimal" },
        body: JSON.stringify({ tier: "pro", status: "active", current_period_end: "2026-10-29T12:00:00Z" }),
    });
    if (!up.ok) throw new Error(`subscription update failed: ${up.status}`);
}

const shot = async (page: Page, name: string) => {
    // Device B pulls the 40-days-stale demo tabs, which raises the cleanup banner; dismiss it (A's was dismissed by launchDemoContext).
    await page.getByRole("button", { name: "Dismiss" }).click({ timeout: 1000 }).catch(() => null);
    await settle(page);
    await page.waitForTimeout(400);
    await saveWebp(page, name);
};

async function signIn(page: Page) {
    await page.getByRole("button", { name: /Settings menu|Account menu/ }).click();
    await page.getByRole("menuitem", { name: "Sign in" }).click();
    await page.waitForTimeout(400);
    await page.getByLabel(/email/i).first().fill(EMAIL);
    await page.getByLabel(/password/i).first().fill(PASSWORD);
    await page.locator('[role="dialog"]').getByRole("button", { name: /^sign in$/i }).click();
}

async function launchDeviceB(extensionId: string): Promise<{ context: BrowserContext; page: Page }> {
    fs.rmSync(DIR_B, { recursive: true, force: true });
    const ext = path.resolve(process.env.TM_DEMO_EXT_DIR!);
    const context = await chromium.launchPersistentContext(DIR_B, {
        headless: false,
        viewport: { width: 800, height: 600 },
        deviceScaleFactor: 2,
        colorScheme: "light",
        args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--window-size=800,600"],
        storageState: {
            cookies: [],
            origins: [{ origin: `chrome-extension://${extensionId}`, localStorage: [{ name: "tabmerger-theme", value: "light" }] }],
        },
    });
    for (const url of ["https://github.com", "https://developer.mozilla.org", "https://news.ycombinator.com"]) {
        const t = await context.newPage();
        await t.goto(url, { waitUntil: "domcontentloaded" }).catch(() => null);
    }
    const page = await context.newPage();
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    for (const p of context.pages()) if (p !== page && (p.url() === "about:blank" || p.url().startsWith("chrome://"))) await p.close().catch(() => null);
    return { context, page };
}

/** Close the popup and open a fresh one, as a real user reopening it. */
async function reopen(context: BrowserContext, old: Page, extensionId: string): Promise<Page> {
    const page = await context.newPage();
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await old.close();
    return page;
}

async function pickGroup(page: Page, name: string) {
    await page.getByText(name, { exact: true }).first().click();
    await page.waitForTimeout(400);
}

async function main() {
    await ensureProUser();

    // ---- Device A -----------------------------------------------------------
    const a = await launchDemoContext(undefined, 2, "light");
    const ctxA = a.context;
    let pageA = a.page;
    const extensionId = pageA.url().split("/")[2];
    await signIn(pageA);
    await pageA.getByRole("heading", { name: "Set up encryption" }).waitFor({ timeout: 15000 });
    await pageA.getByPlaceholder("New passphrase").fill(PASSPHRASE);
    await pageA.getByPlaceholder("Confirm passphrase").fill(PASSPHRASE);
    await pageA.getByRole("button", { name: "Set up encryption" }).click();
    await pageA.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 15000 });
    await pageA.waitForTimeout(3500); // initial push

    // ---- Device B -----------------------------------------------------------
    const b = await launchDeviceB(extensionId);
    const ctxB = b.context;
    let pageB = b.page;
    await signIn(pageB);
    await pageB.getByRole("heading", { name: "Unlock encryption" }).waitFor({ timeout: 15000 });
    await pageB.getByPlaceholder("Passphrase", { exact: true }).fill(PASSPHRASE);
    await pageB.getByPlaceholder("Confirm passphrase").fill(PASSPHRASE);
    await pageB.getByRole("button", { name: "Save" }).click();
    await pageB.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 15000 });
    await pageB.getByText("Reading List", { exact: true }).first().waitFor({ timeout: 45000 });
    await pageB.waitForTimeout(3500);

    // 1) two devices, same groups
    await pickGroup(pageA, "Work");
    await pickGroup(pageB, "Work");
    await settle(pageA);
    await settle(pageB);
    await shot(pageA, "sync-device-a.webp");
    await shot(pageB, "sync-device-b.webp");

    // 2) rename on A -> B
    await pageA.getByText("Research", { exact: true }).first().click({ button: "right" });
    await pageA.getByRole("menuitem", { name: /^Rename/ }).click();
    await pageA.waitForTimeout(300);
    await pageA.keyboard.press("Control+A");
    await pageA.keyboard.type("Research papers");
    await pageA.keyboard.press("Enter");
    await pageA.waitForTimeout(500);
    await pickGroup(pageA, "Research papers");
    await settle(pageA);
    await pageA.waitForTimeout(2200); // any toast out
    await shot(pageA, "sync-rename-a.webp");
    pageA = await reopen(ctxA, pageA, extensionId); // mount -> push
    await pageA.waitForTimeout(6000);
    pageB = await reopen(ctxB, pageB, extensionId); // mount -> pull
    await pageB.getByText("Research papers", { exact: true }).first().waitFor({ timeout: 45000 });
    await pickGroup(pageB, "Research papers");
    await settle(pageB);
    await pageB.waitForTimeout(2200);
    await shot(pageB, "sync-rename-b.webp");

    // 3) delete on A -> B
    await pageA.getByText("Shopping", { exact: true }).first().click({ button: "right" });
    await pageA.getByRole("menuitem", { name: /^Delete group/ }).click();
    await pageA.waitForTimeout(600);
    if (await pageA.locator('[role="dialog"]').isVisible().catch(() => false)) {
        await pageA.locator('[role="dialog"]').getByRole("button", { name: /delete/i }).click();
        await pageA.waitForTimeout(600);
    }
    await pickGroup(pageA, "Work");
    await settle(pageA);
    await pageA.waitForTimeout(3000);
    await shot(pageA, "sync-delete-a.webp");
    pageA = await reopen(ctxA, pageA, extensionId);
    await pageA.waitForTimeout(6000);
    pageB = await reopen(ctxB, pageB, extensionId);
    await pageB.getByText("Reading List", { exact: true }).first().waitFor({ timeout: 45000 });
    await pageB.waitForTimeout(6000);
    const stillThere = await pageB.getByText("Shopping", { exact: true }).count();
    console.log("[sync] Shopping still on B after sync:", stillThere);
    await pickGroup(pageB, "Work");
    await settle(pageB);
    await pageB.waitForTimeout(2500);
    await shot(pageB, "sync-delete-b.webp");

    await ctxA.close();
    await ctxB.close();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
