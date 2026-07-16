// Shared by record.ts and screenshots.ts: launches the built demo-mode
// extension in --app= mode and flips it into demo mode. See record.ts's
// header comment for why the demo-mode build + --app= trick are needed.
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";

const EXTENSION_PATH = path.resolve(
    __dirname,
    "../../extension/.output/chrome-mv3",
);
const USER_DATA_DIR = path.resolve(__dirname, "../.pw-user-data");

// ponytail: generic, PII-free real sites for the "Now Open" group — no
// personal accounts, no "New Tab" placeholders.
const NOW_OPEN_SEED_URLS = [
    "https://github.com",
    "https://developer.mozilla.org",
    "https://news.ycombinator.com",
];

export async function launchDemoContext(
    recordVideo?: { dir: string; size: { width: number; height: number } },
    // ponytail: default 1 (matches historical behavior / video recording,
    // where a bigger backing buffer just means bigger .webm for no visual
    // gain). screenshots.ts passes 2 — those PNGs get scaled down onto
    // store/promo canvases, and a 1x-DPI source is what was making the
    // composited Chrome Web Store assets look soft/upscaled.
    deviceScaleFactor = 1,
): Promise<{ context: BrowserContext; page: Page }> {
    // ponytail: demoData.ts assigns fresh nanoid() ids on every extension
    // load, and saveGroupsState() put()s by id rather than replacing the
    // whole table — reusing a stale profile silently accumulates duplicate
    // groups across runs instead of overwriting them. Always start clean.
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });

    const probeContext = await chromium.launchPersistentContext(
        USER_DATA_DIR,
        {
            headless: false,
            args: [
                `--disable-extensions-except=${EXTENSION_PATH}`,
                `--load-extension=${EXTENSION_PATH}`,
            ],
        },
    );
    let [sw] = probeContext.serviceWorkers();
    if (!sw) sw = await probeContext.waitForEvent("serviceworker");
    const extensionId = sw.url().split("/")[2];
    await probeContext.close();

    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: false,
        viewport: { width: 780, height: 600 },
        deviceScaleFactor,
        args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            `--app=chrome-extension://${extensionId}/popup.html`,
            "--window-size=780,600",
        ],
        ...(recordVideo ? { recordVideo } : {}),
    });

    const page = context.pages()[0] ?? (await context.waitForEvent("page"));
    await page.waitForLoadState("domcontentloaded");
    page.on("dialog", (dialog) => void dialog.accept());

    // ponytail: --app= sometimes races the extension's registration in a
    // fresh browser process, landing on chrome-error://chromewebdata/
    // instead of popup.html. A single reload of the same extension URL
    // reliably recovers once the extension has finished loading.
    if (page.url().startsWith("chrome-error://")) {
        await page.goto(`chrome-extension://${extensionId}/popup.html`);
    }

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "Data" }).click();

    // ponytail: enterDemoMode() (packages/extension/src/lib/demo.ts) opens a
    // fresh blank window and closes every other window to reset browser
    // state — including the --app popup window this `page` lives in. Wait
    // for Chrome to actually close it, then reopen the extension popup as a
    // plain page in the context (which now has only the fresh window).
    const closed = page.waitForEvent("close", { timeout: 5000 }).catch(() => null);
    await page.getByRole("button", { name: "Demo Mode" }).click();
    await closed;

    // ponytail: enterDemoMode() leaves the browser with a single blank
    // "New Tab" window — open real, useful sites so "Now Open" shows actual
    // content, then close the blank one so it never shows up. No PII (no
    // personal accounts/emails).
    for (const url of NOW_OPEN_SEED_URLS) {
        const tab = await context.newPage();
        await tab.goto(url, { waitUntil: "domcontentloaded" }).catch(() => null);
    }
    // ponytail: modern Chrome's built-in NTP resolves to "chrome://new-tab-page/"
    // rather than "chrome://newtab/" — match both, plus a blank "about:blank".
    for (const p of context.pages()) {
        const u = p.url();
        if (u === "chrome://newtab/" || u.startsWith("chrome://new-tab-page") || u === "about:blank") {
            await p.close().catch(() => null);
        }
    }

    const freshPage = await context.newPage();
    await freshPage.setViewportSize({ width: 780, height: 600 });
    await freshPage.goto(`chrome-extension://${extensionId}/popup.html`);
    freshPage.on("dialog", (dialog) => void dialog.accept());

    return { context, page: freshPage };
}
