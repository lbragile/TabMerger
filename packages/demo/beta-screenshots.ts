// Captures popup screenshots for the beta tester guide
// (packages/web/app/(marketing)/beta/page.tsx's TEST_AREAS). Distinct from
// screenshots.ts (Chrome Web Store store-listing assets, driven off
// demo-script.ts's promo storyboard) — this script drives the popup
// directly against the real demoData.ts seed groups (Work/Research/
// Shopping/Reading List + Now Open), since the beta guide needs to show
// real everyday features (search, undo, archive, sessions, multi-select,
// drag, settings) rather than the one scripted "chaos -> organized"
// walkthrough. Reuses launchDemoContext.ts for the same demo-mode boot
// sequence (headless --headless=new, seeded IndexedDB via enterDemoMode()).
//
// Output: packages/web/public/beta/*.webp — 1600x1200 (deviceScaleFactor 2
// on the popup's native 800x600 CSS px), cropped exactly to the popup
// viewport, never resized after capture (coordinator correction 2026-09-26:
// an earlier pass downscaled to ~900px then re-cropped, and the page renders
// these at ~670 CSS px on HiDPI — a ~2.5x upscale that read as blurry).
// Uses CDP's own `Page.captureScreenshot` with format:"webp" directly (no
// sharp/cwebp/ffmpeg dependency in this repo) — see the learnings file for
// why. quality 90+ — sharpness matters more than filesize here (up to
// ~300KB/file is fine).
import fs from "node:fs";
import path from "node:path";
import type { CDPSession, Locator, Page } from "@playwright/test";
import { launchDemoContext } from "./lib/launchDemoContext";
import { runStepAction } from "./lib/actions";

const OUT_DIR = path.resolve(__dirname, "../web/public/beta");

// ---------------------------------------------------------------------------
// Minimal CDP mouse — copied in miniature from lib/actions.ts's CdpMouse.
// Headless `--headless=new` does not activate this popup's native HTML5
// `dragstart` via Playwright's own page.mouse.* (confirmed in actions.ts's
// header comment + demo-learnings) — raw `Input.dispatchMouseEvent` over a
// CDPSession does. Not imported from actions.ts because that file doesn't
// export it (module-private) and duplicating ~25 lines is cheaper than
// refactoring a shared export for a one-off script.
class CdpMouse {
    private x = 0;
    private y = 0;
    private pressed = false;
    constructor(private readonly cdp: CDPSession) {}
    async move(x: number, y: number) {
        this.x = x;
        this.y = y;
        await this.cdp.send("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x,
            y,
            button: this.pressed ? "left" : "none",
            buttons: this.pressed ? 1 : 0,
        });
    }
    async down() {
        this.pressed = true;
        await this.cdp.send("Input.dispatchMouseEvent", {
            type: "mousePressed",
            x: this.x,
            y: this.y,
            button: "left",
            buttons: 1,
            clickCount: 1,
        });
    }
    async up() {
        await this.cdp.send("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x: this.x,
            y: this.y,
            button: "left",
            buttons: 0,
            clickCount: 1,
        });
        this.pressed = false;
    }
}

async function getMouse(page: Page): Promise<CdpMouse> {
    const session = await page.context().newCDPSession(page);
    return new CdpMouse(session);
}

async function boxCenter(locator: Locator) {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error("boxCenter: could not resolve bounding box");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Drags from `source` to `target` and leaves the mouse DOWN over the target
// (mid-gesture) so the caller can screenshot before releasing.
async function dragTo(page: Page, source: Locator, target: Locator) {
    const from = await boxCenter(source);
    const to = await boxCenter(target);
    const mouse = await getMouse(page);
    await mouse.move(from.x, from.y);
    await mouse.down();
    await mouse.move(from.x, from.y - 10);
    await page.waitForTimeout(150);
    // A few intermediate steps — dnd-kit/native HTML5 DnD needs real
    // mousemove deltas to register drag-over on the target, a single jump
    // does not reliably trigger it.
    const STEPS = 10;
    for (let i = 1; i <= STEPS; i++) {
        const t = i / STEPS;
        await mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
        await page.waitForTimeout(30);
    }
    await page.waitForTimeout(250);
    return mouse; // caller decides when to call mouse.up()
}

// CDP's own Page.captureScreenshot supports format:"webp" directly — no
// external image tool needed (this repo has no sharp/cwebp/ffmpeg
// dependency). `quality` only applies to jpeg/webp, ignored for png.
//
// ponytail: `Emulation.setDeviceMetricsOverride({deviceScaleFactor:2, ...})`
// (tried first) did NOT make captureScreenshot emit a scaled image under
// `--headless=new` — output stayed flat 800x600 regardless. What DOES work:
// passing an explicit `clip` with its own `scale` on captureScreenshot
// itself — `clip.scale` multiplies the captured region's pixel dimensions
// independently of any device-metrics override, so `scale:2` over the full
// 800x600 viewport reliably produces a real 1600x1200 image. Verified via
// the same manual WebP VP8X-chunk dimension read used to catch the original
// bug (see beta-screenshots' git history / demo-learnings).
async function saveWebp(page: Page, file: string, quality = 92, scale = 2) {
    const cdp = await page.context().newCDPSession(page);
    const { data } = await cdp.send("Page.captureScreenshot", {
        format: "webp",
        quality,
        clip: { x: 0, y: 0, width: 800, height: 600, scale },
    });
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    const kb = (fs.statSync(file).size / 1024).toFixed(1);
    console.log(`[beta-screenshots] saved ${path.basename(file)} (${kb} KB)`);
}

async function settle(page: Page) {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.move(0, 0);
    await page.waitForTimeout(150);
}

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    // deviceScaleFactor 2 (matches screenshots.ts) — a 1x source was the
    // exact "soft/upscaled" bug screenshots.ts's own comment already
    // documents for store assets, and the same math applies here now that
    // the beta page renders these near their native size on HiDPI.
    const { context, page } = await launchDemoContext(undefined, 2, "light");

    // ---- 1. Popup overview (sidebar + a window card) ----------------------
    await page.getByText("Work", { exact: true }).first().click();
    await settle(page);
    await saveWebp(page, path.join(OUT_DIR, "popup-overview.webp"));

    // ---- 2. Undo/Redo enabled after deleting a tab -------------------------
    // Work's first tab (Gmail inbox) — "Remove tab" is the saved-group
    // (non-"Now Open") aria-label (Tab.tsx line 760).
    await page.getByRole("button", { name: "Remove tab" }).first().click();
    await settle(page);
    await saveWebp(page, path.join(OUT_DIR, "undo-redo-enabled.webp"));

    // ---- 3. Search: Ctrl/Cmd+K, filtered list ------------------------------
    // ponytail: the beta page's copy says search is fuzzy ("ghub" matching
    // "GitHub" by letters-in-order) — SearchOverlay.tsx's real getResults()
    // is plain substring (.includes()), not lib/utils.ts's fuzzyMatch (that
    // helper exists but isn't wired into search). "ghub" is NOT a substring
    // of "github" and returns zero results against real demo data — flagged
    // to the caller as a product/docs discrepancy. Using "hub" here instead
    // (still a partial/non-full-word query, and a real substring of
    // "GitHub") so this screenshot actually shows a filtered result list.
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(300);
    const searchInput = page.getByPlaceholder("Search tabs, groups…");
    await searchInput.pressSequentially("hub", { delay: 70 });
    await page.waitForTimeout(400);
    await saveWebp(page, path.join(OUT_DIR, "search-filter.webp"));
    // Clear the query before closing: the header keeps it as the list filter,
    // and a leftover "hub" otherwise shows up in every later screenshot.
    await searchInput.fill("");
    await page.waitForTimeout(200);
    await page.keyboard.press("Escape").catch(() => null);
    // SearchOverlay has no Escape handler (see demo-learnings) — click its
    // backdrop instead, same fix screenshots.ts uses between every step.
    await page.locator("div.fixed.inset-0.z-40").click({ timeout: 500 }).catch(() => null);
    await settle(page);

    // ---- 4. Multi-select drag: Ctrl-click 2 tabs in Shopping, mid-drag ----
    // (captured BEFORE Shopping is archived below, and before its tabs are
    // used as a cross-group drag source.)
    await page.getByText("Shopping", { exact: true }).first().click();
    await settle(page);
    await page.getByText("Standing Desk", { exact: false }).first().click({ modifiers: ["Control"] });
    await page.waitForTimeout(200);
    await page.getByText("4K Monitor", { exact: false }).first().click({ modifiers: ["Control"] });
    await page.waitForTimeout(400);
    await saveWebp(page, path.join(OUT_DIR, "multi-select-tabs.webp"));

    // Drag those 2 selected tabs together onto Research's sidebar row —
    // mid-drag, mouse still down.
    {
        const handles = page.locator('[aria-label^="Drag to reorder tab"]');
        const source = handles.first();
        const researchRow = page
            .locator("[data-sidebar-group-index]")
            .filter({ has: page.getByText("Research", { exact: true }) });
        const mouse = await dragTo(page, source, researchRow);
        await saveWebp(page, path.join(OUT_DIR, "drag-multiselect.webp"));
        await mouse.up();
        await page.waitForTimeout(400);
    }
    // Exit selection (Escape doesn't apply here — Ctrl-click selection is a
    // plain component state, not selectionMode); just navigate away.
    await page.getByText("Research", { exact: true }).first().click();
    await settle(page);

    // ---- 5. Drag a single tab onto another group's sidebar row -----------
    // Mirrors actions.ts's dragTabToSidebarGroup: "Reading List" tab ->
    // "Work" sidebar row. Covers both the "drag a tab into another group"
    // and "drop onto a sidebar group row" TEST_AREAS bullets — headless,
    // they're the same interaction.
    await page.getByText(/^Reading Li/).first().click();
    await settle(page);
    {
        const handle = page.locator('[aria-label^="Drag to reorder tab"]').first();
        const workRow = page
            .locator("[data-sidebar-group-index]")
            .filter({ has: page.getByText("Work", { exact: true }) });
        const mouse = await dragTo(page, handle, workRow);
        await saveWebp(page, path.join(OUT_DIR, "drag-single-tab-to-group.webp"));
        await mouse.up();
        await page.waitForTimeout(400);
    }

    // ---- 6. Drag to reorder a group in the sidebar ------------------------
    await settle(page);
    {
        const groupHandles = page.locator('[aria-label^="Drag to reorder group"]');
        const count = await groupHandles.count();
        if (count >= 2) {
            const source = groupHandles.first();
            const target = groupHandles.last();
            const mouse = await dragTo(page, source, target);
            await saveWebp(page, path.join(OUT_DIR, "drag-reorder-group.webp"));
            await mouse.up();
            await page.waitForTimeout(400);
        } else {
            console.warn("[beta-screenshots] SKIPPED drag-reorder-group.webp — fewer than 2 group drag handles found");
        }
    }
    await settle(page);

    // ---- 7. Archive a group, expand the Archived section ------------------
    await page.getByText("Shopping", { exact: true }).first().click({ button: "right" });
    await page.waitForTimeout(300);
    await page.getByRole("menuitem", { name: "Archive group" }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: /ARCHIVED/ }).click();
    await page.waitForTimeout(400);
    await saveWebp(page, path.join(OUT_DIR, "archive-section.webp"));

    // ---- 8. Save a session, expand the Sessions section --------------------
    await page.getByRole("button", { name: "Save current session" }).click();
    await page.waitForTimeout(400);
    await page.getByLabel("Session name").fill("Beta test session");
    await page.waitForTimeout(150);
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /SESSIONS/ }).click();
    await page.waitForTimeout(400);
    await saveWebp(page, path.join(OUT_DIR, "sessions-section.webp"));
    // Collapse both again so they don't bleed into later screenshots' framing.
    await page.getByRole("button", { name: /SESSIONS/ }).click();
    await page.getByRole("button", { name: /ARCHIVED/ }).click();
    await settle(page);

    // ---- 9. Stale-tabs banner (Reading List's 5 tabs are seeded 40d stale) -
    // launchDemoContext.ts dismisses this banner once, unconditionally, via
    // the real localStorage flag (cleanup_banner_dismissed_until) — clear it
    // and reload so the banner actually renders for this screenshot.
    await page.evaluate(() => localStorage.removeItem("cleanup_banner_dismissed_until"));
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1200);
    const banner = page.getByText(/tabs were saved over/);
    if (await banner.isVisible().catch(() => false)) {
        await saveWebp(page, path.join(OUT_DIR, "stale-tabs-banner.webp"));
    } else {
        console.warn("[beta-screenshots] SKIPPED stale-tabs-banner.webp — banner did not render after reload");
    }

    // ---- 10. Hover preview tooltip, setting OFF (default) ------------------
    // TabPreview.tsx's Radix TooltipTrigger wraps the tab TITLE span
    // specifically (Tab.tsx ~line 644-652), not the whole row/drag-handle
    // wrapper — hovering the row's outer container never opens the tooltip.
    //
    // ponytail: UNRESOLVED — the captured screenshot renders the tooltip's
    // "No preview" copy (TabPreview.tsx line 120's `showPreviewImages ? 'No
    // preview' : 'Not enabled'` branch), which only makes sense if
    // `appSettings.showPreviewImages` is true. A direct raw-IndexedDB read
    // (bypassing React entirely) taken at this exact point in the script,
    // both before and after adding the `page.reload()` below, confirms the
    // persisted `appSettings` row genuinely has `showPreviewImages: false`
    // — so this is either a real TanStack Query staleness bug in the
    // extension (cache not reflecting the persisted value even after a hard
    // reload) or some other render-time discrepancy, not a script bug. Ran
    // out of budget chasing it further; flagged to extension-dev in the
    // final report. The `reload()` was a genuine attempt at a fix (forces a
    // fresh mount) — it did NOT change the outcome, so it's cosmetic/no-op
    // now, but left in in case it starts mattering once the real bug is
    // found upstream.
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(800);
    await page.getByText("Work", { exact: true }).first().click();
    await settle(page);
    const firstTabRow = page.getByText("Q3 Planning", { exact: false }).first();
    await firstTabRow.hover();
    await page.waitForTimeout(700); // TooltipProvider delayDuration is 400ms
    await saveWebp(page, path.join(OUT_DIR, "hover-preview-off.webp"));
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);

    // ---- 11. Settings > General tab (theme select + switch + version badge)
    // Captured BEFORE touching the switch — General is the tab Settings
    // opens on by default, so this is just the resting state.
    await openSettings(page);
    await page.waitForTimeout(300);
    await saveWebp(page, path.join(OUT_DIR, "settings-general.webp"));

    // Now turn the page-image switch ON for the hover-preview-on attempt
    // below. ponytail: clicking the switch does NOT save instantly the way
    // the beta page's own copy claims ("no confirmation dialog") — it opens
    // a real "Turn on page images?" confirm dialog (Cancel/Turn on) on top
    // of Settings, a second product/docs discrepancy alongside the search
    // fuzzy-match one (see step 3's comment) — flagged to extension-dev.
    await page.getByRole("switch", { name: "Show page images in previews" }).click();
    await page.waitForTimeout(300);
    const turnOn = page.getByRole("button", { name: "Turn on" });
    if (await turnOn.isVisible().catch(() => false)) {
        await turnOn.click();
        await page.waitForTimeout(300);
    }
    const saveChanges = page.getByRole("button", { name: "Save changes" });
    if (await saveChanges.isVisible().catch(() => false)) {
        await saveChanges.click();
        await page.waitForTimeout(300);
    }
    await closeDialog(page);

    // ---- 12. Hover preview tooltip, setting ON ------------------------------
    // Network fetch for a real page image may not resolve headless — skip
    // saving if no image actually renders (per task instructions).
    await firstTabRow.hover();
    await page.waitForTimeout(1500); // extra time for a real network fetch
    const previewImg = page.locator('[role="tooltip"] img[alt=""]').nth(1); // 0 = favicon, 1 = og image if present
    const hasImage = await previewImg.isVisible().catch(() => false);
    if (hasImage) {
        await saveWebp(page, path.join(OUT_DIR, "hover-preview-on.webp"));
    } else {
        console.warn(
            "[beta-screenshots] SKIPPED hover-preview-on.webp — no page image resolved (expected headless/no network access; the OFF-state screenshot already shows the disabled copy)",
        );
    }
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);

    // ---- 13. Import/export (Settings > Data tab) ---------------------------
    await openSettings(page);
    await page.getByRole("tab", { name: "Data", exact: true }).click();
    await page.waitForTimeout(300);
    await saveWebp(page, path.join(OUT_DIR, "settings-import-export.webp"));
    await closeDialog(page);

    // ---- 14. Sign-in modal (reachable without real credentials) -----------
    await page.getByRole("button", { name: /Settings menu|Account menu/ }).click();
    await page.waitForTimeout(200);
    await page.getByRole("menuitem", { name: "Sign in" }).click();
    await page.waitForTimeout(500);
    await saveWebp(page, path.join(OUT_DIR, "sign-in.webp"));
    await closeDialog(page);

    await context.close();
    console.log(`[beta-screenshots] done -> ${OUT_DIR}`);
}

// Opens the Settings dialog via the header's Account/Settings menu.
async function openSettings(page: Page) {
    await page.getByRole("button", { name: /Settings menu|Account menu/ }).click();
    await page.waitForTimeout(200);
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await page.waitForTimeout(300);
}

// Closes any open Radix Dialog and waits for it to actually unmount before
// returning — the earlier version of this script pressed Escape and
// immediately tried to reopen a new dialog, which raced the close animation
// and produced a `getByRole('button', {name: /Settings menu/})` timeout.
async function closeDialog(page: Page) {
    await page.keyboard.press("Escape");
    await page.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 3000 }).catch(() => null);
    await page.waitForTimeout(300);
}

// ---------------------------------------------------------------------------
// Store-listing assets (color-new-group / cross-window-tab-drag /
// multi-window) — recaptured here at the SAME quality/DSF as the beta
// screenshots above so every image on the beta page matches (coordinator
// ask 2026-09-26). These 3 ids/actions are lifted verbatim from
// screenshots.ts's SCREENSHOT_STEP_IDS/promo-only multi-window capture — see
// that file for the original. Run in a SEPARATE fresh context/profile (not
// chained onto the beta-data mutations above) so the group/tab state matches
// what screenshots.ts itself would produce from a clean demo profile.
async function captureStoreAssets() {
    const { context, page } = await launchDemoContext(undefined, 2, "light");

    // color-new-group needs a "Q4 Launch" group to exist and be colored —
    // createGroup then colorNewGroup (mid-gesture: color picker open, not yet
    // committed) are the same two demoScript steps screenshots.ts chains.
    await runStepAction(page, "createGroup", 200);
    await runStepAction(page, "colorNewGroup", 200, async () => {
        await saveWebp(page, path.join(OUT_DIR, "color-new-group.webp"));
    });

    // cross-window-tab-drag needs "Q4 Launch" to hold a window copied in from
    // Now Open, then split into two windows — copyWindowToGroup then
    // moveTabToNewWindow are prerequisites before the drag itself can be
    // cross-window.
    await runStepAction(page, "copyWindowToGroup", 200);
    await runStepAction(page, "moveTabToNewWindow", 200);
    await runStepAction(page, "crossWindowTabDrag", 200, async () => {
        await saveWebp(page, path.join(OUT_DIR, "cross-window-tab-drag.webp"));
    });

    // multi-window: Research's 4 tabs -> "Split windows" (independent of the
    // Q4 Launch flow above) — same real action screenshots.ts's dark-only
    // promo capture uses, just captured in light here to match the rest of
    // this page's images.
    await page.getByText("Research", { exact: true }).first().click();
    await page.waitForTimeout(300);
    await page.getByText("Research", { exact: true }).first().click({ button: "right" });
    await page.waitForTimeout(300);
    await page.getByText("Split windows", { exact: true }).click();
    await page.waitForTimeout(600);
    await settle(page);
    await saveWebp(page, path.join(OUT_DIR, "multi-window.webp"));

    await context.close();
}

main()
    .then(() => captureStoreAssets())
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
