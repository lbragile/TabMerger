// Shared by record.ts and screenshots.ts: launches the built demo-mode
// extension in --app= mode and flips it into demo mode. See record.ts's
// header comment for why the demo-mode build + --app= trick are needed.
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";

// ponytail: MUST be the "-demo" output dir — `pnpm build:extension:demo`
// (wxt build -m demo) is what actually keeps the Settings > Dev tab's Demo
// Mode "Enter" button in the bundle; the regular `pnpm build:extension`
// build tree-shakes it out as dead code (see record.ts's header comment),
// and WXT names that mode's output `chrome-mv3-demo`, not `chrome-mv3` (the
// plain build's dir, which happens to also exist on disk if both builds
// have ever been run — silently loading the wrong one gives no error, it
// just hangs later waiting for a "Dev" tab/"Enter" button that was never
// shipped in that build).
const EXTENSION_PATH = path.resolve(
    __dirname,
    "../../extension/.output/chrome-mv3-demo",
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
    // ponytail: default 1, but both callers now pass 2 explicitly.
    // screenshots.ts's PNGs get scaled down onto store/promo canvases, and
    // record.ts's video recording has the same issue — a 1x-DPI source is
    // what was making both the composited Chrome Web Store assets AND the
    // final walkthrough .mp4 look soft/upscaled (Playwright's VP8 recorder
    // is fairly lossy at native 1x resolution). Left at 1 as the default
    // rather than changed, so any future caller has to make the same
    // deliberate choice screenshots.ts/record.ts already did.
    deviceScaleFactor = 1,
    // Forces the extension's own theme for the whole session, so a full
    // recording pass comes out consistently light or dark (see lib/theme.ts
    // + public/theme-init.js in the extension — theme-init.js reads this
    // exact localStorage key synchronously before React mounts, so setting
    // it via addInitScript before any page navigates avoids a flash of the
    // wrong theme on the very first frame).
    theme?: "light" | "dark",
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

    // ponytail: --app=chrome-extension://... makes Chrome start navigating to
    // the popup as part of process startup, racing ahead of any post-launch
    // CDP call. addInitScript() registered after launchPersistentContext()
    // resolves loses that race against theme-init.js's synchronous read on
    // this near-instant local resource — the very first page (where all the
    // Settings > Demo Mode setup happens) reliably renders in the wrong
    // theme. storageState is seeded as part of context construction, before
    // the --app navigation is even requested, so it has no such race.
    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: false,
        viewport: { width: 800, height: 600 },
        deviceScaleFactor,
        args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            `--app=chrome-extension://${extensionId}/popup.html`,
            "--window-size=800,600",
        ],
        ...(theme
            ? {
                  storageState: {
                      cookies: [],
                      origins: [
                          {
                              origin: `chrome-extension://${extensionId}`,
                              localStorage: [{ name: "tabmerger-theme", value: theme }],
                          },
                      ],
                  },
              }
            : {}),
        ...(recordVideo ? { recordVideo } : {}),
    });

    // ponytail: record.ts gives every demo-script step its own fresh
    // context.newPage() (for one .webm per step) — recordVideo starts
    // capturing from the moment that blank page is created, before goto()
    // even resolves, so frame 0 of every clip briefly shows the browser's
    // default white canvas regardless of theme. That's an invisible no-op
    // for the light recording (white matches white) but was a jarring white
    // flash at the start of every single dark-theme clip. Paint the
    // about:blank canvas itself in the right theme color immediately —
    // synchronous, no dependency on the extension's CSS having loaded yet.
    if (theme) {
        const bg = theme === "dark" ? "#0b0f14" : "#ffffff";
        // ponytail: `document.documentElement` is `null` at the exact instant
        // Chromium fires addInitScript's underlying
        // Page.addScriptToEvaluateOnNewDocument for these chrome-extension://
        // pages (same root cause as the ripple init script below — confirmed
        // by try/catch probing, not assumed) — a bare
        // `document.documentElement.style...` throws and the paint silently
        // never applies. `<html>` shows up a tick later, so poll for it
        // instead of assuming it exists synchronously.
        await context.addInitScript((color) => {
            const paint = () => {
                if (document.documentElement) {
                    document.documentElement.style.backgroundColor = color;
                } else {
                    setTimeout(paint, 0);
                }
            };
            paint();
        }, bg);
    }

    // ponytail: injects window.__tmRipple(x, y) via addInitScript (context-
    // wide, so it applies to every future page/tab record.ts opens per-step)
    // so simulated clicks leave a visible on-screen trace in the recording.
    // actions.ts's clickWithRipple/dblclickWithRipple helpers call it right
    // before the real Playwright click.
    // ponytail: ROOT CAUSE of "ripple never shows up in any recorded video,
    // ever, on any step" — this used to also build a <style> tag and
    // `document.documentElement.appendChild(style)` *inside the init script
    // body itself*, at registration time. `document.documentElement` is
    // `null` at the point Chromium fires `Page.addScriptToEvaluateOnNewDocument`
    // scripts for this extension's `chrome-extension://` pages (verified by
    // wrapping the body in try/catch and reading the caught error back out —
    // it was a plain `TypeError: Cannot read properties of null (reading
    // 'appendChild')`), which threw and aborted the rest of the script
    // BEFORE the `window.__tmRipple = ...` assignment on the next line ever
    // ran — so the function silently never existed on any page, and every
    // `clickWithRipple` call in `actions.ts` was a harmless no-op the whole
    // time (its `?.()` optional call swallowed the "not a function" case).
    // Fix: the init script itself must do NOTHING except assign a plain
    // function reference (no DOM access at all) — defer every DOM read/
    // write (creating the <style> tag, appending the ripple div) to CALL
    // TIME inside `__tmRipple`, by which point the page has definitely
    // finished loading (every caller already awaits a real click target
    // first).
    // ponytail: ripple color is the app's real brand primary
    // (globals.css --primary: 193 100% 40% ≈ rgb(0, 180, 204) — same teal/cyan
    // already hardcoded in GroupItem.tsx for the rename input's focus
    // border), not a generic red/gray debug dot, so it reads as an
    // intentional branded UI cue in the recording rather than a leftover
    // devtool artifact.
    await context.addInitScript(() => {
        (window as unknown as { __tmRipple: (x: number, y: number) => void }).__tmRipple = (x, y) => {
            if (!document.getElementById("tm-ripple-style")) {
                const style = document.createElement("style");
                style.id = "tm-ripple-style";
                style.textContent = `
                    .tm-click-ripple {
                        position: fixed; z-index: 2147483647; pointer-events: none;
                        width: 26px; height: 26px; margin-left: -13px; margin-top: -13px;
                        border-radius: 50%; background: rgba(0, 180, 204, 0.5);
                        border: 2px solid rgba(0, 180, 204, 0.95);
                        animation: tm-ripple-pulse 550ms ease-out forwards;
                    }
                    @keyframes tm-ripple-pulse {
                        0% { transform: scale(0.35); opacity: 1; }
                        100% { transform: scale(2.4); opacity: 0; }
                    }
                `;
                document.head.appendChild(style);
            }
            const el = document.createElement("div");
            el.className = "tm-click-ripple";
            el.style.left = `${x}px`;
            el.style.top = `${y}px`;
            document.body.appendChild(el);
            setTimeout(() => el.remove(), 700);
        };
    });

    // ponytail: window.__tmKeyBadge(label) — same brand-color, same
    // lazy-DOM-at-call-time pattern as __tmRipple above (the init script
    // body itself must stay DOM-free, see the ROOT CAUSE comment on
    // __tmRipple — `document.documentElement`/`document.head` are `null` at
    // registration time for this extension's pages). Reserved for
    // modifier/special-key presses only (Ctrl+A, Enter, Escape, ...) —
    // actions.ts's pressWithIndicator() calls this, NOT regular text entry
    // (too noisy per-character). Fixed-position bottom-center of the
    // 800x600 recording — same coordinate space as Composition.tsx's video
    // canvas (no scaling), so this lines up as a real overlay above the
    // caption bar (which sits at `bottom: 32` in Composition.tsx, ~40px
    // tall) without needing the pressed element's on-screen position at all.
    await context.addInitScript(() => {
        (window as unknown as { __tmKeyBadge: (label: string) => void }).__tmKeyBadge = (label) => {
            if (!document.getElementById("tm-key-badge-style")) {
                const style = document.createElement("style");
                style.id = "tm-key-badge-style";
                style.textContent = `
                    .tm-key-badge {
                        position: fixed; z-index: 2147483647; pointer-events: none;
                        left: 50%; bottom: 90px; transform: translateX(-50%);
                        padding: 4px 12px; border-radius: 0;
                        background: rgba(0, 180, 204, 1); color: white;
                        font: 700 13px/1.4 sans-serif; text-align: center; white-space: nowrap;
                        animation: tm-key-badge-pulse 800ms ease-out forwards;
                    }
                    /* ponytail: fully opaque (was 0.95) and given a real held
                       plateau (10%-70% stays at opacity 1) instead of
                       immediately fading back out right after popping in —
                       coordinator feedback: badge needs to read as visible
                       for longer, not just flash. */
                    @keyframes tm-key-badge-pulse {
                        0% { opacity: 0; transform: translateX(-50%) translateY(6px) scale(0.85); }
                        10% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
                        70% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
                        100% { opacity: 0; transform: translateX(-50%) translateY(0) scale(1); }
                    }
                `;
                document.head.appendChild(style);
            }
            const el = document.createElement("div");
            el.className = "tm-key-badge";
            el.textContent = label;
            document.body.appendChild(el);
            setTimeout(() => el.remove(), 850);
        };
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

    // ponytail: Settings used to be its own icon button (aria-label
    // "Settings"). It's now folded into the profile dropdown trigger
    // (aria-label "Settings menu" signed-out / "Account menu" signed-in,
    // see Header/index.tsx) — open that first, then pick the "Settings"
    // menu item before the tab list even exists in the DOM.
    await page.getByRole("button", { name: /Settings menu|Account menu/ }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();

    // ponytail: THE REAL BUG behind "dark recording still renders light" —
    // the storageState `tabmerger-theme` localStorage seed above only
    // affects theme-init.js's synchronous pre-mount class toggle (the very
    // first paint). The actual source of truth is `appSettings.theme` in
    // IndexedDB (useAppSettings.ts), which useTheme.ts's mount-time
    // useEffect reads and re-applies via applyTheme() on every popup load —
    // unconditionally, even when it resolves to the DEFAULT_APP_SETTINGS
    // fallback ('system'). Since a fresh profile has no saved appSettings
    // row yet, that effect fires on literally the first popup mount and
    // immediately clobbers the pre-mount `.dark` class back to whatever
    // `system` resolves to (light, on a typical CI/dev machine) — so the
    // localStorage-only fix "worked" for one un-rendered frame and then lost
    // the race to React every single time. Fix: actually drive the real
    // Settings > General theme <Select> and click "Save changes" so
    // appSettings.theme is persisted to IndexedDB before any recording
    // starts — that mutation is what useTheme() reads from, and it holds for
    // the rest of this profile/session (record.ts reuses one context across
    // every step).
    if (theme) {
        await page.getByRole("combobox").first().click();
        await page.waitForTimeout(200);
        await page.getByRole("option", { name: theme === "dark" ? "Dark" : "Light" }).click();
        await page.waitForTimeout(200);
        await page.getByRole("button", { name: "Save changes" }).click();
        await page.waitForTimeout(300);
    }

    // ponytail: selector drift 2026-07-31 — the Demo Mode trigger moved off
    // the "Data" tab onto its own "Dev" tab (Settings.tsx ~line 381), and
    // the button itself is labeled "Enter" (the "Demo Mode" text is now a
    // <Label>, not the button's accessible name) — click() on the old
    // `getByRole("button", { name: "Demo Mode" })` just timed out waiting
    // for a button that no longer exists under that name.
    await page.getByRole("tab", { name: "Dev" }).click();

    // ponytail: enterDemoMode() (packages/extension/src/lib/demo.ts) opens a
    // fresh blank window and closes every other window to reset browser
    // state — including the --app popup window this `page` lives in. Wait
    // for Chrome to actually close it, then reopen the extension popup as a
    // plain page in the context (which now has only the fresh window).
    const closed = page.waitForEvent("close", { timeout: 5000 }).catch(() => null);
    await page.getByRole("button", { name: "Enter" }).click();
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
    await freshPage.setViewportSize({ width: 800, height: 600 });
    await freshPage.goto(`chrome-extension://${extensionId}/popup.html`);
    freshPage.on("dialog", (dialog) => void dialog.accept());

    return { context, page: freshPage };
}
