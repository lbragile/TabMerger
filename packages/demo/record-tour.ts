// Records the feature tour's own popup footage, headless, WITHOUT touching
// the walkthrough/promo clips in public/recordings/ (record.ts wipes that
// whole directory, so the tour never goes through it).
//
// Scene 2 needs the popup on "Now Open" showing exactly the three chaos
// windows and nothing else. The shared walkthrough clips (open-popup,
// chaos-hook) don't: they show a leftover 4th seed window and tab titles from
// an older recording. So this opens the same CHAOS_WINDOW_URLS windows (the
// very action chaosHook uses), clears the setup window's seed tabs, and
// records a fresh clip under a tour-specific id.
//
// Besides the clip it writes, from the REAL popup DOM (the popup is the truth):
//   lib/tourPopupLayout.json  card rects + where the settled list starts in the clip
//   lib/chaosTabs.json        title/host of every tab, as the popup actually shows them
//
// Prereq: pnpm --filter @tabmerger/extension build:extension:demo
// Usage:  pnpm --filter @tabmerger/demo record:tour [dark|light]
import fs from "node:fs";
import path from "node:path";
import { LEADING_TRIM_MS } from "./demo-script";
import { runStepAction } from "./lib/actions";
import { CHAOS_WINDOW_URLS } from "./lib/chaosWindows";
import { launchDemoContext } from "./lib/launchDemoContext";
import { TOUR_POPUP_CLIP_MS, TOUR_POPUP_STEP_ID } from "./lib/tourPopup";

const theme = (process.argv[2] as "light" | "dark" | undefined) ?? "dark";
if (theme !== "light" && theme !== "dark") {
    console.error(`[tour] invalid theme arg "${theme}" — expected "light" or "dark"`);
    process.exit(1);
}

const TMP_DIR = path.resolve(__dirname, `.pw-user-tour-video-${theme}`);
const OUT_FILE = path.resolve(__dirname, `public/tour/recordings/${theme}/${TOUR_POPUP_STEP_ID}.webm`);
const LAYOUT_FILE = path.resolve(__dirname, "lib/tourPopupLayout.json");
const TABS_FILE = path.resolve(__dirname, "lib/chaosTabs.json");

const MAX_ATTEMPTS = 3;
// Bot-wall titles must not reach a frame (same guard as capture-tour-assets.ts).
// These come and go per request, so a bad run is simply re-recorded.
const BAD_TITLE = /just a moment|attention required|access denied|\bAI\b/i;

interface Measured {
    cards: { x: number; y: number; width: number; height: number; texts: string[] }[];
    urls: string[][];
}

/** Address-bar text for a real tab URL: no scheme, no www, no query/hash. */
const hostOf = (url: string) => {
    const u = new URL(url);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`.replace(/^www\./, "");
};

async function attempt(lastChance: boolean): Promise<{ ok: boolean; reason?: string }> {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

    // Same recording size/deviceScaleFactor as record.ts (headless recordVideo
    // captures the raw 800x600 CSS viewport regardless of scale factor).
    const { context, page: setupPage } = await launchDemoContext(
        { dir: TMP_DIR, size: { width: 800, height: 600 } },
        2,
        theme,
    );
    const popupUrl = setupPage.url();
    try {
        // The three real chaos windows (closes stale windows too).
        await runStepAction(setupPage, "chaosHook", 0);
        // The setup window still holds the demo seed tabs (GitHub/MDN/HN) — it
        // would show as a 4th "Now Open" card. Close everything in it but this
        // page's own tab.
        await setupPage.evaluate(
            () =>
                new Promise<void>((resolve) => {
                    chrome.tabs.getCurrent((self) => {
                        chrome.tabs.query({ windowId: self!.windowId }, (tabs) => {
                            const ids = tabs.map((t) => t.id!).filter((id) => id !== self!.id);
                            chrome.tabs.remove(ids, () => resolve());
                        });
                    });
                }),
        );
        const urls = await setupPage.evaluate(
            () =>
                new Promise<string[][]>((resolve) =>
                    chrome.windows.getAll({ populate: true }, (ws) =>
                        resolve(
                            ws
                                .filter((w) => w.tabs?.some((t) => t.url?.startsWith("http")))
                                .map((w) => (w.tabs ?? []).map((t) => t.url ?? "")),
                        ),
                    ),
                ),
        );

        // Slow sites set their <title> late: wait until every chaos tab has finished
        // loading with a real title before the popup first reads the list.
        await setupPage
            .waitForFunction(
                () =>
                    new Promise<boolean>((resolve) =>
                        chrome.tabs.query({}, (tabs) =>
                            resolve(
                                tabs
                                    .filter((t) => t.url?.startsWith("http"))
                                    .every((t) => t.status === "complete" && !!t.title && t.title.replace(/^www\./, "") !== new URL(t.url!).host.replace(/^www\./, "")),
                            ),
                        ),
                    ),
                undefined,
                { timeout: 25000, polling: 500 },
            )
            .catch(() => null);
        const page = await context.newPage();
        const pageCreatedAt = Date.now();
        await page.setViewportSize({ width: 800, height: 600 });
        await page.goto(popupUrl);
        await page.getByText("Now Open", { exact: true }).first().waitFor({ state: "visible", timeout: 8000 });
        // Let the list settle (the loading flash is over by LEADING_TRIM_MS), then measure.
        await page.waitForTimeout(1500);

        const measureCards = () =>
            page.evaluate(() => {
                // A window card = the nearest bordered ancestor of each "N tabs" label.
                const labels = Array.from(document.querySelectorAll<HTMLElement>("*")).filter(
                    (el) => el.children.length === 0 && /^\d+ tabs?$/.test(el.textContent?.trim() ?? ""),
                );
                return labels.map((label) => {
                    let el: HTMLElement | null = label;
                    while (el && !(getComputedStyle(el).borderTopWidth !== "0px" && el.querySelectorAll("img, svg").length > 3)) {
                        el = el.parentElement;
                    }
                    const r = (el ?? label).getBoundingClientRect();
                    const texts = Array.from((el ?? label).querySelectorAll<HTMLElement>("*"))
                        .filter((n) => n.children.length === 0 && (n.textContent ?? "").trim().length > 0)
                        .map((n) => (n.textContent ?? "").trim());
                    return { x: r.x, y: r.y, width: r.width, height: r.height, texts };
                });
            });
        let cards = await measureCards();
        // A stale 4th "Now Open" card (the closed seed window) sometimes lingers
        // for a moment after load; a reload clears it.
        // A title that is only the host means the popup read the tab before the page set
        // its <title>; a reload re-reads the live tabs.
        const hostTitles = (cs: typeof cards) =>
            cs.flatMap((c, w) =>
                c.texts
                    .slice(2)
                    .filter((_, i) => i % 2 === 0)
                    .filter((t, ti) => {
                        const url = urls[w]?.[ti];
                        return !!url && t === new URL(url).host.replace(/^www\./, "");
                    }),
            );
        for (let i = 0; i < 4 && (cards.length !== CHAOS_WINDOW_URLS.length || hostTitles(cards).length > 0); i++) {
            await page.reload();
            await page.getByText("Now Open", { exact: true }).first().waitFor({ state: "visible", timeout: 8000 });
            await page.waitForTimeout(3000);
            cards = await measureCards();
        }
        const measured: Measured = { cards, urls };
        if (process.env.TOUR_DEBUG) console.log(JSON.stringify(cards[2]?.texts));

        if (cards.length !== CHAOS_WINDOW_URLS.length || urls.length !== CHAOS_WINDOW_URLS.length) {
            return { ok: false, reason: `popup shows ${cards.length} card(s), expected ${CHAOS_WINDOW_URLS.length}` };
        }
        // texts per card: "Window", "N tabs", then (title, host) pairs.
        const titles = cards.map((c) => c.texts.slice(2).filter((_, i) => i % 2 === 0));
        // A title that is just the host means the page hadn't set its <title> yet when the popup read it.
        const hostOnly = titles
            .flat()
            .find((t, i) => t === hostOf(measured.urls[Math.floor(i / 5)][i % 5]).replace(/\/.*/, "").replace(/^www\./, ""));
        if (hostOnly) return { ok: false, reason: `popup shows a host as a title: "${hostOnly}"` };
        const bad = titles.flat().find((t) => BAD_TITLE.test(t));
        if (bad && !lastChance) return { ok: false, reason: `bot-wall/unwanted title in popup: "${bad}"` };

        if (bad) console.warn(`[tour] WARNING: keeping a bot-wall title the real popup shows: "${bad}"`);
        // Popup is the truth: write its titles (and the real URL's host) into the
        // shared tab data, keyed by the ORIGINAL chaos URL.
        const tabs = JSON.parse(fs.readFileSync(TABS_FILE, "utf-8")) as Record<string, Record<string, unknown>>;
        CHAOS_WINDOW_URLS.forEach((windowUrls, w) => {
            windowUrls.forEach((url, t) => {
                tabs[url] = { ...tabs[url], title: titles[w][t], host: hostOf(measured.urls[w][t]), fromPopup: true };
            });
        });
        fs.writeFileSync(TABS_FILE, JSON.stringify(tabs, null, 4) + "\n");

        // No cursor travel: sweeping over the rows pops TabPreview tooltips that
        // cover the cards. The scene's own overlays supply the motion.
        const motionStartMs = Date.now() - pageCreatedAt;
        await page.waitForTimeout(TOUR_POPUP_CLIP_MS);
        const layout = JSON.parse(fs.readFileSync(LAYOUT_FILE, "utf-8"));
        layout.cards = cards.map(({ x, y, width, height }) => ({ x, y, width, height }));
        layout.startMs[theme] = Math.max(motionStartMs, LEADING_TRIM_MS);
        fs.writeFileSync(LAYOUT_FILE, JSON.stringify(layout, null, 4) + "\n");

        const video = page.video();
        await page.close();
        if (video) fs.renameSync(await video.path(), OUT_FILE);
        return { ok: true };
    } finally {
        await context.close().catch(() => null);
        fs.rmSync(TMP_DIR, { recursive: true, force: true });
    }
}

async function main() {
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
        const result = await attempt(i === MAX_ATTEMPTS);
        if (result.ok) {
            console.log(`[tour] saved ${OUT_FILE}`);
            return;
        }
        console.warn(`[tour] attempt ${i}/${MAX_ATTEMPTS} rejected: ${result.reason}`);
    }
    throw new Error("[tour] no clean recording after retries");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
