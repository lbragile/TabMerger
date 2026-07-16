// Captures raw 780x600 popup screenshots for Chrome Web Store listing
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

// Chrome Web Store allows up to 5 screenshots — pick a representative
// subset of steps rather than one per step (demo-script.ts has more steps
// than that budget).
const SCREENSHOT_STEP_IDS = [
    "open-popup",
    "view-groups",
    "rename-group",
    "selection-mode",
    // ponytail: swapped out for "dark-mode" (was "star-group") — PromoTile.tsx
    // needs an actual dark-mode scene, and the store listing benefits from
    // showing dark mode off just as much as star-group's near-duplicate of
    // view-groups' sidebar.
    "dark-mode",
];

async function main() {
    // ponytail: without this, removed/renamed steps leave stale *.png behind
    // (render-store-assets.ts picks up whatever's in RAW_DIR, not just current steps).
    fs.rmSync(RAW_DIR, { recursive: true, force: true });
    fs.mkdirSync(RAW_DIR, { recursive: true });
    // deviceScaleFactor 2 — these PNGs get composited/downscaled onto larger
    // store & promo canvases (ScreenshotFrame/PromoTile), a 1x source was
    // the soft/upscaled look reported in the rendered assets.
    const { context, page } = await launchDemoContext(undefined, 2);

    for (const step of demoScript) {
        if (step.textCard) continue; // text-only scene, no popup state to capture
        await runStepAction(page, step.action, Math.min(step.durationMs, 1500));
        if (SCREENSHOT_STEP_IDS.includes(step.id)) {
            // ponytail: leftover cursor position from a prior step's real
            // mouse movement (e.g. dragTabBetweenGroups's hover) can trigger
            // a hover-preview tooltip that has nothing to do with this step —
            // move the mouse off content and let it dismiss before capturing.
            await page.mouse.move(0, 0);
            await page.waitForTimeout(200);
            const file = path.join(RAW_DIR, `${step.id}.png`);
            await page.screenshot({ path: file });
            console.log(`[screenshots] saved ${file}`);
        }
    }

    // ponytail: promo-only capture, not a demo-script step — doesn't need to
    // exist in the video (would add an extra scene/pacing decision there for
    // no reason), just a source image for PromoTile.tsx to show off
    // multi-window support. "Split windows" turns Research's 4 tabs into 4
    // real populated windows (an empty "Add Window" would just show a blank
    // column — not demonstrable).
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

    await context.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
