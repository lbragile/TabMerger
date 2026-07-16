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
import { demoScript } from "./demo-script";
import { runStepAction } from "./lib/actions";
import { launchDemoContext } from "./lib/launchDemoContext";

// ponytail: must live under public/ — Remotion's staticFile() (used by
// Composition.tsx to play these back) rejects "../" traversal, so the
// recordings can't stay as a sibling of remotion/.
const RECORDINGS_DIR = path.resolve(__dirname, "public/recordings");

async function main() {
    fs.rmSync(RECORDINGS_DIR, { recursive: true, force: true });
    const { context, page: setupPage } = await launchDemoContext({
        dir: RECORDINGS_DIR,
        size: { width: 780, height: 600 },
    });
    const popupUrl = setupPage.url();
    // ponytail: Playwright names recordVideo output by internal GUID, one
    // file per page — not per demoScript step. Composition.tsx needs
    // `${step.id}.webm`, so give each step its own page (new video) and
    // rename the file on close. The setup page's video is unused/discarded.
    await setupPage.close();

    for (const step of demoScript) {
        if (step.textCard) continue; // rendered as a static title card, nothing to record
        console.log(`[demo] step: ${step.id}`);
        const page = await context.newPage();
        await page.goto(popupUrl);
        await runStepAction(page, step.action, step.durationMs);
        const video = page.video();
        await page.close();
        if (video) {
            fs.renameSync(await video.path(), path.join(RECORDINGS_DIR, `${step.id}.webm`));
        }
    }

    await context.close();

    // ponytail: launchDemoContext's own setup pages (Settings navigation,
    // the window closed by enterDemoMode's window reset) also get recorded
    // into this dir since it's the context-wide recordVideo target. Sweep
    // anything that isn't a named step output.
    const wantedFiles = new Set(demoScript.map((step) => `${step.id}.webm`));
    for (const file of fs.readdirSync(RECORDINGS_DIR)) {
        if (!wantedFiles.has(file)) fs.rmSync(path.join(RECORDINGS_DIR, file));
    }

    console.log(`[demo] recordings saved under ${RECORDINGS_DIR}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
