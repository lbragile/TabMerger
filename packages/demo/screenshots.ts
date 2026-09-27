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
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
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

// PromoTile.tsx's marquee "chaos" panel needs a REAL Chrome browser screenshot
// (actual tab strip + bookmarks bar, not a CSS-drawn illustration — coordinator
// explicitly rejected the illustrated version). page.screenshot() only rasterizes
// the page viewport; it can't see native browser chrome (tabs/bookmarks bar) at
// all since that's outside the CDP-rendered frame. So this launches a bare
// (extension-free) Chrome window seeded with a cluttered profile, sizes/positions
// it via CDP, then falls back to an OS-level screen capture (PowerShell +
// System.Drawing) cropped to the window bounds — the only way to actually see
// native chrome in the output image.
// ponytail: Windows-only capture path (this repo's dev machine). Add a macOS
// `screencapture -R`/Linux path if this pipeline ever needs to run cross-platform.
async function captureClutteredChrome() {
    const userDataDir = path.resolve(__dirname, ".pw-cluttered-chrome");
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(userDataDir, "Default"), { recursive: true });

    // Real Chrome Bookmarks-file format — dozens of bookmarks packed edge-to-
    // edge so the bar reads as genuinely cluttered, per the coordinator's
    // reference screenshot.
    const bookmarkNames = [
        "GitHub", "MDN", "Stack Overflow", "Jira", "Figma", "Notion", "Slack",
        "AWS Console", "Vercel", "Supabase", "Gmail", "Calendar", "Drive",
        "Docs", "Sheets", "Trello", "Linear", "Sentry", "Datadog", "Postman",
        "npm", "Vite", "React Docs", "TypeScript", "Tailwind", "Chrome DevRel",
        "Hacker News", "Reddit", "Twitter", "YouTube", "Amazon", "LinkedIn",
        "Zoom", "Discord", "Confluence",
    ];
    const dateAdded = String(Date.now() * 1000);
    const children = bookmarkNames.map((name, i) => ({
        type: "url",
        name,
        url: "https://example.com",
        id: String(i + 10),
        date_added: dateAdded,
    }));
    fs.writeFileSync(
        path.join(userDataDir, "Default", "Bookmarks"),
        JSON.stringify({
            version: 1,
            roots: {
                bookmark_bar: { id: "1", name: "Bookmarks bar", type: "folder", date_added: dateAdded, children },
                other: { id: "2", name: "Other bookmarks", type: "folder", date_added: dateAdded, children: [] },
                synced: { id: "3", name: "Mobile bookmarks", type: "folder", date_added: dateAdded, children: [] },
            },
        }),
    );
    // "bookmark_bar.show_on_all_tabs" is the real Preferences key Chrome reads
    // to keep the bookmarks bar pinned open on every tab (not just the NTP).
    fs.writeFileSync(
        path.join(userDataDir, "Default", "Preferences"),
        JSON.stringify({ bookmark_bar: { show_on_all_tabs: true } }),
    );

    // ponytail: 2026-09-26 — deliberately headed, and ONLY reachable when the
    // caller (main(), below) has already gated this behind `TM_DEMO_HEADED=1`.
    // Not portable to headless: PrintWindow needs a real HWND to grab native
    // Chrome tab-strip/bookmarks-bar pixels, and headless Chrome has none.
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        viewport: null,
        args: ["--window-size=1400,900", "--window-position=50,50"],
    });

    // Generic real sites, no PII, enough tabs to look genuinely cluttered
    // (matches the ~8-tab reference screenshot).
    const tabUrls = [
        "https://github.com",
        "https://developer.mozilla.org",
        "https://news.ycombinator.com",
        "https://en.wikipedia.org/wiki/Main_Page",
        "https://stackoverflow.com",
        "https://www.npmjs.com",
        "https://vercel.com",
        "https://tailwindcss.com",
    ];
    const first = context.pages()[0] ?? (await context.newPage());
    await first.goto(tabUrls[0], { waitUntil: "domcontentloaded" }).catch(() => null);
    for (const url of tabUrls.slice(1)) {
        const p = await context.newPage();
        await p.goto(url, { waitUntil: "domcontentloaded" }).catch(() => null);
    }
    await first.waitForTimeout(800);

    // page.screenshot() cannot capture the tab strip/bookmarks bar (native
    // chrome, outside the page's own render tree) — get the real OS window
    // bounds via CDP so PrintWindow (below) can find the matching HWND.
    const cdp = await context.newCDPSession(first);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    const { bounds } = await cdp.send("Browser.getWindowBounds", { windowId });

    // PromoTile's marquee panel uses objectFit:"contain" on the WHOLE raw
    // image, so a full 900px-tall window capture is dominated by the loaded
    // page body (only ~150px of a 900px capture is tab strip/bookmarks bar) —
    // the "clutter" reads as barely-visible slivers. Crop to just the native
    // chrome band (tab strip + address bar + bookmarks bar). 155px is the
    // measured bottom edge of the bookmarks bar for this 900px-tall /
    // --window-size=1400,900 capture; re-measure if that window size changes.
    const outFile = path.join(RAW_DIR, "cluttered-chrome.png");
    const chromeBandHeight = 155;
    // ponytail: this used to be a full-screen CopyFromScreen crop, but that
    // grabs whatever's frontmost on the real desktop at that screen
    // coordinate — on this dev machine that's a shared, interactive desktop
    // (verified: caught it capturing the user's own real Chrome window, a
    // File Explorer window, and a PowerToys popup on separate runs, all
    // sitting on top of the automated window). PrintWindow captures a
    // specific HWND's content directly from its own device context, so it's
    // correct regardless of stacking order — find our window by matching
    // class + the position we launched it at (--window-position=50,50 above),
    // since multiple "chrome.exe" windows (the dev's real browser) can be
    // running at once and window title isn't a reliable enough match.
    const psScript = [
        "Add-Type -AssemblyName System.Drawing",
        `Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32Capture {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder buf, int max);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@`,
        "$foundHwnd = [IntPtr]::Zero",
        "$cb = [Win32Capture+EnumProc]{ param($hWnd, $lParam)",
        "  $rect = New-Object Win32Capture+RECT",
        "  [Win32Capture]::GetWindowRect($hWnd, [ref]$rect) | Out-Null",
        "  $cls = New-Object System.Text.StringBuilder 256",
        "  [Win32Capture]::GetClassName($hWnd, $cls, 256) | Out-Null",
        `  if ([Win32Capture]::IsWindowVisible($hWnd) -and $cls.ToString() -eq "Chrome_WidgetWin_1" -and [Math]::Abs($rect.Left - ${bounds.left}) -le 15 -and [Math]::Abs($rect.Top - ${bounds.top}) -le 15) {`,
        "    $script:foundHwnd = $hWnd",
        "    return $false",
        "  }",
        "  return $true",
        "}",
        "[Win32Capture]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null",
        `if ($foundHwnd -eq [IntPtr]::Zero) { throw "cluttered-chrome window not found for PrintWindow capture" }`,
        `$full = New-Object System.Drawing.Bitmap ${bounds.width}, ${bounds.height}`,
        "$g = [System.Drawing.Graphics]::FromImage($full)",
        "$hdc = $g.GetHdc()",
        "[Win32Capture]::PrintWindow($foundHwnd, $hdc, 2) | Out-Null",
        "$g.ReleaseHdc($hdc)",
        `$crop = $full.Clone((New-Object System.Drawing.Rectangle(0, 0, ${bounds.width}, ${chromeBandHeight})), $full.PixelFormat)`,
        `$crop.Save("${outFile.replace(/\\/g, "\\\\")}")`,
        "$g.Dispose(); $full.Dispose(); $crop.Dispose()",
    ].join("\n");
    const scriptFile = path.join(userDataDir, "_capture.ps1");
    fs.writeFileSync(scriptFile, psScript);
    execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptFile]);
    console.log(`[screenshots] saved ${outFile} (PrintWindow capture, cropped to chrome band only)`);

    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
}

async function main() {
    // ponytail: 2026-09-26 — captureClutteredChrome() is the one capture in
    // this whole pipeline that MUST open a real, visible OS window
    // (PrintWindow needs an actual HWND to grab native Chrome tab-strip/
    // bookmarks-bar pixels — headless Chrome has no real window at all, so
    // there is nothing to point PrintWindow at). The user's hard rule is no
    // visible browser under ANY circumstances for a normal run, so this is
    // now opt-in only (`TM_DEMO_HEADED=1`, the same escape hatch
    // launchDemoContext.ts uses) — a default run REUSES whatever
    // cluttered-chrome.png already exists on disk instead of recapturing it.
    // Back it up before the unconditional RAW_DIR wipe below (which exists
    // to clear stale PNGs from removed/renamed steps) so a plain headless
    // run doesn't destroy the one asset it can't regenerate itself.
    const clutteredChromePath = path.join(RAW_DIR, "cluttered-chrome.png");
    const existingClutteredChrome = fs.existsSync(clutteredChromePath)
        ? fs.readFileSync(clutteredChromePath)
        : null;

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
            // ponytail: coordinator ask — screenshots for these 3 steps must
            // show the interaction MID-GESTURE (popover/menu open, drag in
            // flight), not the resting before/after state page.screenshot()
            // below would otherwise capture once runStepAction returns. The
            // handlers themselves call this hook at the interesting moment
            // (see actions.ts's colorNewGroup/addWindowNote/crossWindowTabDrag).
            const midGestureIds = new Set(["color-new-group", "add-window-note", "cross-window-tab-drag"]);
            const midGesture = midGestureIds.has(step.id)
                ? async () => {
                      const file = path.join(RAW_DIR, `${step.id}-${theme}.png`);
                      await page.screenshot({ path: file });
                      console.log(`[screenshots] saved ${file} (mid-gesture)`);
                  }
                : undefined;
            await runStepAction(page, step.action, Math.min(step.durationMs, 1500), midGesture);
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
            if (SCREENSHOT_STEP_IDS.includes(step.id) && !midGestureIds.has(step.id)) {
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

    // Promo-only, theme-independent — real Chrome UI, not extension state.
    // See the top-of-function comment: this is the one capture that needs a
    // real visible window, so it's opt-in only.
    if (process.env.TM_DEMO_HEADED === "1") {
        await captureClutteredChrome();
    } else if (existingClutteredChrome) {
        fs.writeFileSync(clutteredChromePath, existingClutteredChrome);
        console.log(
            `[screenshots] reused existing ${clutteredChromePath} (headless run — set TM_DEMO_HEADED=1 to recapture a fresh one)`,
        );
    } else {
        console.warn(
            `[screenshots] WARNING: no cluttered-chrome.png on disk and TM_DEMO_HEADED is not set — ` +
                `the promo marquee's "chaos" panel has no source image. Run once with TM_DEMO_HEADED=1 to generate it.`,
        );
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
