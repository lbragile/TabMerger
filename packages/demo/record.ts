// Drives the built extension with Playwright, triggers demo mode (see
// packages/extension/src/lib/demo.ts), then steps through demo-script.ts
// recording one .webm clip per step.
//
// Prereq: `pnpm --filter @tabmerger/extension build:extension:demo` — this
// loads the unpacked .output/chrome-mv3 build, not the dev server. Must be
// the demo-mode build (`-m demo`, sets VITE_DEMO_BUILD=true): the regular
// `pnpm build:extension` dead-code-eliminates the Settings > Demo Mode
// button, so record.ts can't reach it.
import fs from "node:fs";
import path from "node:path";
import { demoScript, promoOnlySteps, LEADING_TRIM_MS } from "./demo-script";
import { runStepAction } from "./lib/actions";
import { launchDemoContext } from "./lib/launchDemoContext";

// Theme is a CLI arg, not an env var (`tsx record.ts dark` / `tsx record.ts
// light`) — avoids pulling in cross-env for a value that's just as easy to
// pass positionally and needs to work the same in bash and PowerShell.
const theme = (process.argv[2] as "light" | "dark" | undefined) ?? "dark";
if (theme !== "light" && theme !== "dark") {
    console.error(`[demo] invalid theme arg "${theme}" — expected "light" or "dark"`);
    process.exit(1);
}

// ponytail: must live under public/ — Remotion's staticFile() (used by
// Composition.tsx to play these back) rejects "../" traversal, so the
// recordings can't stay as a sibling of remotion/. Nested by theme so a
// light and dark pass don't clobber each other's clips — Composition.tsx's
// `theme` prop picks the matching subdir at render time.
const RECORDINGS_DIR = path.resolve(__dirname, `public/recordings/${theme}`);

// ponytail: some sandboxed/low-resource dev machines see the recording
// Chromium instance hard-crash ("Target page, context or browser has been
// closed") partway through a 15-step run — not reproducible on every
// machine, and not caused by anything a single step does (it's happened
// mid-drag, mid-rename, mid-undo — different steps each time). Rather than
// lose all prior clips on every crash, retry by relaunching a fresh context
// and resuming from the first step that doesn't already have a saved
// .webm, instead of re-recording everything from scratch. Capped so a
// genuinely broken build/selector still fails loudly instead of looping
// forever.
const MAX_LAUNCH_ATTEMPTS = 8;

// ponytail: promoOnlySteps (new promo-storyboard steps — createGroup,
// copyWindowToGroup, etc.) aren't part of the full walkthrough's `demoScript`
// array, but still need recording for the promo cut. Concatenated here
// (single dedicated recording pass covers both) rather than a second
// record.ts invocation — `runStepAction`/the per-step page lifecycle below
// doesn't care which array a step came from.
// ponytail: 2026-08-01 storyboard rewrite — demoScript now pulls several
// steps VERBATIM (same id) out of promoOnlySteps via demo-script.ts's
// fromPromo() so both cuts share one recorded clip per shared beat. That
// means the two arrays now legitimately overlap by id (not just chaos-hook
// like before) — dedupe by id here, otherwise the same step gets recorded
// twice into the same output path in one pass (harmless but wasteful) and,
// worse, briefly shows up "missing" to the next attempt's resume check.
const recordedSteps = Array.from(
    new Map([...demoScript, ...promoOnlySteps].map((step) => [step.id, step])).values(),
).filter((step) => !step.textCard);

function stepFile(id: string) {
    return path.join(RECORDINGS_DIR, `${id}.webm`);
}

// ponytail: measured per-step zoom transform-origin (fraction of the 800x600
// viewport, centered on whatever element the step's action actually targets
// — e.g. the tab row being renamed, the window card getting a note — instead
// of Composition.tsx's old fixed center-of-frame zoom). Captured here (not
// hand-guessed) because actions.ts already knows the real element's
// boundingBox at the moment it matters; committed to the repo like every
// other measured constant in this pipeline (durationMs, LEADING_TRIM_MS) —
// layout is deterministic across themes/re-recordings for the same build, so
// one committed file covers both. Composition.tsx statically imports it.
const ZOOM_ORIGINS_FILE = path.resolve(__dirname, "zoom-origins.json");
const zoomOrigins: Record<string, { x: number; y: number }> = fs.existsSync(ZOOM_ORIGINS_FILE)
    ? JSON.parse(fs.readFileSync(ZOOM_ORIGINS_FILE, "utf-8"))
    : {};

async function main() {
    fs.rmSync(RECORDINGS_DIR, { recursive: true, force: true });
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

    for (let attempt = 1; attempt <= MAX_LAUNCH_ATTEMPTS; attempt++) {
        const remaining = recordedSteps.filter((step) => !fs.existsSync(stepFile(step.id)));
        if (remaining.length === 0) break;

        if (attempt > 1) {
            console.log(
                `[demo] relaunching (attempt ${attempt}/${MAX_LAUNCH_ATTEMPTS}) — ${remaining.length} step(s) left: ${remaining.map((s) => s.id).join(", ")}`,
            );
        }

        const { context, page: setupPage } = await launchDemoContext(
            // ponytail: ROOT CAUSE of every clip rendering with a
            // cropped-looking popup plus solid gray padding on the
            // right/bottom (2026-08-01 — found by directly measuring pixel
            // boundaries in extracted frames, not assumed from CSS).
            // `deviceScaleFactor: 2` below is honored correctly by
            // `page.screenshot()` (verified via a standalone diagnostic —
            // returns a true 1600x1200 buffer for an 800x600 viewport) but
            // NOT by Playwright's non-headless `recordVideo` screencast
            // backend on this Windows machine — it actually captures at an
            // effective ~1.25x scale (1000x750 for an 800x600 viewport)
            // regardless of the requested deviceScaleFactor, a known
            // real-window (non-headless) recordVideo quirk distinct from
            // screenshot capture. Requesting a LARGER `size` than that (the
            // old 1200x900) doesn't upscale the real 1000x750 capture to
            // fill it — Playwright's recordVideo only ever scales DOWN an
            // oversized capture to fit `size`, never scales UP an undersized
            // one, so the real 1000x750 frame just sat top-left-anchored
            // inside a bigger gray canvas. Setting `size` to exactly what
            // this backend actually produces removes the mismatch (and the
            // padding) entirely — verified by re-measuring the content
            // boundary in a fresh recording after this fix (see
            // demo-learnings.md).
            { dir: RECORDINGS_DIR, size: { width: 1000, height: 750 } },
            // ponytail: was 1 — native 1x capture of the 800x600 popup is what
            // Playwright's VP8 recorder was encoding soft/blurry, especially
            // small UI text. screenshots.ts already uses 2 for the exact same
            // reason (see launchDemoContext.ts's comment on this param) — apply
            // it here too. `recordVideo.size` now pins final output to
            // 1200x900 (see above), so this still gives the encoder a sharper,
            // supersampled source to downsample from, not a bigger output file
            // than the resolution actually displayed on screen.
            2,
            theme,
        );
        const popupUrl = setupPage.url();
        // ponytail: Playwright names recordVideo output by internal GUID, one
        // file per page — not per demoScript step. Composition.tsx needs
        // `${step.id}.webm`, so give each step its own page (new video) and
        // rename the file on close. The setup page's video is unused/discarded.
        await setupPage.close();

        try {
            for (const step of remaining) {
                console.log(`[demo] step: ${step.id}`);
                const page = await context.newPage();
                // ponytail: ROOT CAUSE of every clip rendering with a
                // cropped/smaller-than-canvas popup plus solid gray padding
                // on the right/bottom edges (found via `remotion still` +
                // direct ffprobe/frame inspection of the raw .webm, not
                // assumed from Composition.tsx's CSS — confirmed present in
                // the SOURCE recording itself, at every step, so no CSS fix
                // in Composition.tsx could ever have addressed it). This
                // page never had its viewport explicitly set — it only
                // inherited whatever `context`'s ambient/default viewport
                // was, which in this environment is NOT reliably the
                // context's configured 800x600 for every fresh
                // `context.newPage()` call (unlike launchDemoContext.ts's
                // own `freshPage`, which already calls this explicitly).
                // Playwright's `recordVideo` pads a captured page that's
                // smaller than the configured `recordVideo.size` with solid
                // gray, anchored top-left — exactly the artifact seen.
                // Setting the viewport explicitly, every time, before goto,
                // guarantees the recorded page really is 800x600 (matching
                // recordVideo.size's 4:3 aspect exactly), so `object-fit:
                // cover` in Composition.tsx has a correctly-sized source to
                // fill from — no CSS trick can compensate for the source
                // video itself being smaller than its own reported canvas.
                await page.setViewportSize({ width: 800, height: 600 });
                await page.goto(popupUrl);
                // ponytail: ROOT CAUSE of a brief blank/loading flash at the start of
                // almost every clip, not just open-popup's — every step gets a fresh
                // page.goto(popupUrl) here, but only the openPopup step's own action
                // handler waited for real content before proceeding. Every other
                // step immediately started clicking/rippling on a page that hadn't
                // finished its first paint (React mount + IndexedDB/TanStack Query
                // resolve for groups). Fixed once here, for every step, instead of
                // duplicating the same wait inside each action handler.
                await page
                    .getByText("Now Open", { exact: true })
                    .first()
                    .waitFor({ state: "visible", timeout: 5000 })
                    .catch(() => null);
                // ponytail: Composition.tsx trims LEADING_TRIM_MS off the start of
                // every clip (see demo-script.ts) — record that much extra so the
                // trimmed clip still has the full durationMs of real content left,
                // instead of silently losing it off the tail of the action.
                const origin = await runStepAction(page, step.action, step.durationMs + LEADING_TRIM_MS);
                if (origin) zoomOrigins[step.id] = origin;
                const video = page.video();
                await page.close();
                if (video) {
                    fs.renameSync(await video.path(), stepFile(step.id));
                }
            }
        } catch (err) {
            console.error(`[demo] attempt ${attempt} crashed: ${(err as Error).message}`);
        } finally {
            await context.close().catch(() => null);
        }

        if (attempt === MAX_LAUNCH_ATTEMPTS) {
            const stillMissing = recordedSteps.filter((step) => !fs.existsSync(stepFile(step.id)));
            if (stillMissing.length > 0) {
                throw new Error(
                    `[demo] gave up after ${MAX_LAUNCH_ATTEMPTS} attempts — still missing: ${stillMissing.map((s) => s.id).join(", ")}`,
                );
            }
        }
    }

    // ponytail: launchDemoContext's own setup pages (Settings navigation,
    // the window closed by enterDemoMode's window reset) also get recorded
    // into this dir since it's the context-wide recordVideo target. Sweep
    // anything that isn't a named step output.
    const wantedFiles = new Set(recordedSteps.map((step) => `${step.id}.webm`));
    for (const file of fs.readdirSync(RECORDINGS_DIR)) {
        if (!wantedFiles.has(file)) fs.rmSync(path.join(RECORDINGS_DIR, file));
    }

    fs.writeFileSync(ZOOM_ORIGINS_FILE, JSON.stringify(zoomOrigins, null, 2) + "\n");

    console.log(`[demo] recordings saved under ${RECORDINGS_DIR}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
