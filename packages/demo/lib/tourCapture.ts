// Shared pieces of the feature tour's sharp frame-grab recordings
// (record-tour-window.ts). Playwright's recordVideo always records the raw
// 800x600 CSS viewport (it ignores deviceScaleFactor), which would be soft when
// a scene pushes in on the popup. So the tour grabs 1600x1200 JPEG frames
// straight from CDP (Page.captureScreenshot with clip.scale = 2, ~25 fps in
// practice), resamples them to the tour's 30fps and writes one image per
// frame. The cursor, typing and drag visuals are real DOM state in those frames.
import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import { CHAOS_WINDOW_URLS } from "./chaosWindows";
import { openChaosPopup, type ChaosPopup } from "./tourChaosPopup";

export const TOUR_CAPTURE_FPS = 30;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** A real DOM cursor (so it is captured in the frames) that follows every mouse move. */
export async function installCursor(page: Page) {
    await page.evaluate(() => {
        const el = document.createElement("div");
        el.style.cssText =
            "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:none;width:22px;height:22px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.55))";
        el.innerHTML =
            '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M5 3l14 8-6 1.8L9.5 19z" fill="white" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
        document.body.appendChild(el);
        document.addEventListener(
            "mousemove",
            (e) => {
                el.style.display = "block";
                el.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 2}px)`;
                (window as unknown as { __tmLast: { x: number; y: number } }).__tmLast = { x: e.clientX, y: e.clientY };
            },
            true,
        );
        // During a native drag the page gets dragover (not mousemove) events: keep the cursor on the card.
        document.addEventListener(
            "dragover",
            (e) => {
                el.style.display = "block";
                el.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 2}px)`;
                (window as unknown as { __tmLast: { x: number; y: number } }).__tmLast = { x: e.clientX, y: e.clientY };
            },
            true,
        );
        // The colour dot regains focus after Apply, which pops its "Change color" tooltip
        // (Radix opens on focus): drop that focus the moment it happens, picker closed only.
        setInterval(() => {
            const active = document.activeElement as HTMLElement | null;
            if (active?.matches("button.rounded-full") && !document.querySelector('input[value^="#"]')) active.blur();
        }, 40);
    });
}

/** True when some tab row shows only its host as the title (a page that had not set its <title> yet, or flaps back to it). */
async function hasHostOnlyTitle(page: Page) {
    const hosts = CHAOS_WINDOW_URLS.flat().map((u) => new URL(u).host.replace(/^www\./, ""));
    return page.evaluate((hosts) => {
        const texts = Array.from(document.querySelectorAll<HTMLElement>("*"))
            .filter((n) => n.children.length === 0)
            .map((n) => (n.textContent ?? "").trim());
        // The host column shows each host once; a second exact match is a host used as the title.
        return hosts.some((h) => texts.filter((t) => t === h).length >= 2);
    }, hosts);
}

/**
 * The settled three-window popup. Titles can flap back to the bare host just after
 * settling, so re-check twice right before use and re-open from scratch if one shows up.
 */
export async function openCleanChaosPopup(theme: "light" | "dark"): Promise<ChaosPopup> {
    for (let attempt = 1; attempt <= 4; attempt++) {
        const candidate = await openChaosPopup(theme, 2);
        if (!candidate) continue;
        let bad = false;
        for (let i = 0; i < 2 && !bad; i++) {
            await candidate.page.waitForTimeout(1200);
            bad = await hasHostOnlyTitle(candidate.page);
        }
        if (!bad) return candidate;
        console.warn(`[tour] attempt ${attempt}: a tab title is just its host, retrying`);
        await candidate.context.close().catch(() => null);
    }
    throw new Error("[tour] popup never settled on three clean window cards");
}

/** CDP frame grabber: loops as fast as captureScreenshot returns, stamping each frame with performance.now(). */
export async function startGrabber(context: BrowserContext, page: Page) {
    const cdp = await context.newCDPSession(page);
    const caps: { t: number; data: string }[] = [];
    let grabbing = true;
    const loop = (async () => {
        while (grabbing) {
            try {
                const r = await cdp.send("Page.captureScreenshot", {
                    format: "jpeg",
                    quality: 90,
                    clip: { x: 0, y: 0, width: 800, height: 600, scale: 2 },
                    optimizeForSpeed: true,
                });
                caps.push({ t: performance.now(), data: r.data });
            } catch {
                // The page or context went away (the recording failed elsewhere); stop quietly.
                return;
            }
        }
    })();
    return {
        /** Time of the first grab, the origin of the resampled frame numbers. */
        get t0() {
            return caps[0]?.t ?? performance.now();
        },
        async stop() {
            grabbing = false;
            await loop;
            return caps;
        },
    };
}

/** Frame number (1-based, like the written file names) at which `t` falls once resampled to 30fps. */
export const frameAt = (t: number, t0: number) => Math.floor(((t - t0) / 1000) * TOUR_CAPTURE_FPS) + 1;

/** Resamples the irregular grabs to a fixed 30fps and writes one JPEG per frame; returns the frame count. */
export function writeFrames(dir: string, caps: { t: number; data: string }[]) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const t0 = caps[0].t;
    const total = Math.floor(((caps[caps.length - 1].t - t0) / 1000) * TOUR_CAPTURE_FPS);
    let j = 0;
    for (let k = 0; k < total; k++) {
        const at = t0 + (k * 1000) / TOUR_CAPTURE_FPS;
        while (j + 1 < caps.length && caps[j + 1].t <= at) j++;
        fs.writeFileSync(path.join(dir, `f-${String(k + 1).padStart(4, "0")}.jpg`), Buffer.from(caps[j].data, "base64"));
    }
    return total;
}

/** Eased cursor travel: from wherever the mouse is to the target, 190-420ms depending on distance. */
export function makeGlide(start: { x: number; y: number }) {
    let cur = start;
    const glide = async (p: Page, x: number, y: number) => {
        const dist = Math.hypot(x - cur.x, y - cur.y);
        const ms = Math.min(420, Math.max(190, dist * 0.8));
        const steps = Math.round(ms / 16);
        const from = cur;
        for (let i = 1; i <= steps; i++) {
            const e = easeInOut(i / steps);
            await p.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
            await p.waitForTimeout(16);
        }
        cur = { x, y };
    };
    /** Tells the glide where the pointer really is (after something else, e.g. a drag, moved it). */
    glide.setPos = (x: number, y: number) => {
        cur = { x, y };
    };
    return glide;
}
