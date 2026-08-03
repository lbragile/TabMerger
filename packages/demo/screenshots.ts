// Captures raw 800x600 popup screenshots for Chrome Web Store listing
// assets. Reuses the same demo-mode entry as record.ts but takes a
// page.screenshot() per step instead of recording video — no ffmpeg/frame
// extraction needed, Playwright already does this directly.
//
// Output (raw, uncomposed) goes to screenshots/raw/*.png. Run
// `pnpm render-store-assets` afterwards to composite these onto branded
// 1280x800 canvases via Remotion (see remotion/stills/ScreenshotFrame.tsx).
import fs from "node:fs";
import path from "node:path";
import { demoScript } from "./demo-script";
import { runStepAction } from "./lib/actions";
import { launchDemoContext } from "./lib/launchDemoContext";

const RAW_DIR = path.resolve(__dirname, "screenshots/raw");

// Chrome Web Store screenshots are capped at 5 per listing, but this pool
// is deliberately larger (6 features) so there's a real choice of which 5
// to actually publish, plus both themes for whichever ones get picked.
// Picked to cover distinct, demonstrable features rather than one per
// demo-script step — six real selling points: the unified popup, saved
// groups, color-coding, notes, scoped search, and bulk selection.
// ponytail: 2026-08-01 — remapped after demoScript's full storyboard
// rewrite dropped the old feature-tour steps these ids used to point to
// (view-groups/change-color/add-note/search/selection-mode no longer exist).
// New ids cover the same kind of selling points from the new one-workflow
// storyboard: the unified Now Open view, a colored group, organizing tabs
// into windows, and a window note.
const SCREENSHOT_STEP_IDS = [
    "open-popup",
    "view-new-group",
    "color-new-group",
    "add-window-note",
    "cross-window-tab-drag",
];

const THEMES = ["light", "dark"] as const;

async function main() {
    // ponytail: without this, removed/renamed steps leave stale *.png behind
    // (render-store-assets.ts picks up whatever's in RAW_DIR, not just current steps).
    fs.rmSync(RAW_DIR, { recursive: true, force: true });
    fs.mkdirSync(RAW_DIR, { recursive: true });

    for (const theme of THEMES) {
        // deviceScaleFactor 2 — these PNGs get composited/downscaled onto larger
        // store & promo canvases (ScreenshotFrame/PromoTile), a 1x source was
        // the soft/upscaled look reported in the rendered assets.
        // theme is driven through launchDemoContext's real Settings > General
        // flow (IndexedDB appSettings.theme), not a localStorage-only trick —
        // see launchDemoContext.ts's comment on why that's the only thing
        // useTheme.ts actually honors after mount.
        const { context, page } = await launchDemoContext(undefined, 2, theme);

        for (const step of demoScript) {
            if (step.textCard) continue; // text-only scene, no popup state to capture
            await runStepAction(page, step.action, Math.min(step.durationMs, 1500));
            // ponytail: leftover cursor/focus state from a prior step's real
            // interaction can intercept the NEXT step's click even when that
            // step isn't one we screenshot. Two distinct leftover-state bugs,
            // both needed: (1) mouse.move alone does NOT dismiss Radix
            // Tooltip when it's showing because the trigger element still has
            // real DOM focus (not just :hover) — changeGroupColor's final
            // click leaves its swatch/sidebar-row focused, and Radix tooltips
            // open on focus-visible too, so a plain mouse move away left the
            // tooltip open and blocking starWindow's next click. Blur
            // whatever's focused explicitly. (2) still move the mouse too,
            // for the separate hover-preview-tooltip case (e.g. after
            // tabPreview's hover).
            // (3) searchTabs clears the query but never closes SearchOverlay —
            // its "fixed inset-0 z-40" backdrop (SearchOverlay.tsx) stays
            // mounted and blocks every later step's clicks on the real popup
            // underneath it. SearchOverlay has no Escape handler (grepped —
            // only its backdrop's onClick={onClose}), so click the backdrop
            // itself, exactly like a user clicking outside the search box.
            await page.locator("div.fixed.inset-0.z-40").click({ timeout: 500 }).catch(() => null);
            await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
            await page.mouse.move(0, 0);
            await page.waitForTimeout(200);
            if (SCREENSHOT_STEP_IDS.includes(step.id)) {
                const file = path.join(RAW_DIR, `${step.id}-${theme}.png`);
                await page.screenshot({ path: file });
                console.log(`[screenshots] saved ${file}`);
            }
        }

        // ponytail: promo-only capture, not a demo-script step — doesn't need to
        // exist in the video (would add an extra scene/pacing decision there for
        // no reason), just a source image for PromoTile.tsx to show off
        // multi-window support. "Split windows" turns Research's 4 tabs into 4
        // real populated windows (an empty "Add Window" would just show a blank
        // column — not demonstrable). Only captured once (dark) — it's a small
        // corner inset in PromoTile.tsx, not a theme comparison, so one theme is
        // enough and avoids an unused light variant sitting on disk.
        if (theme === "dark") {
            await page.getByText("Research", { exact: true }).first().click();
            await page.waitForTimeout(300);
            await page.getByText("Research", { exact: true }).first().click({ button: "right" });
            await page.waitForTimeout(300);
            await page.getByText("Split windows", { exact: true }).click();
            await page.waitForTimeout(600);
            await page.mouse.move(0, 0);
            await page.waitForTimeout(200);
            await page.screenshot({ path: path.join(RAW_DIR, "multi-window.png") });
            console.log(`[screenshots] saved ${path.join(RAW_DIR, "multi-window.png")}`);
        }

        await context.close();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
