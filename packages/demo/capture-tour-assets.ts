// Captures what the feature tour's drawn browser windows show for every tab
// `chaosHook` opens (lib/chaosWindows.ts): the real page title, the favicon
// and a page screenshot, written to public/tour/ plus lib/chaosTabs.json.
// Headless, extension-free Chromium. Needs network ONCE; the Remotion render
// itself never touches the network. Re-run after editing CHAOS_WINDOW_URLS.
//
// Usage: pnpm --filter @tabmerger/demo tour-assets
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { CHAOS_WINDOW_URLS } from "./lib/chaosWindows";

const PUBLIC_DIR = path.resolve(__dirname, "public");
const FAVICON_DIR = path.join(PUBLIC_DIR, "tour/favicons");
const PAGE_DIR = path.join(PUBLIC_DIR, "tour/pages");
const OUT_JSON = path.resolve(__dirname, "lib/chaosTabs.json");

// Same as the drawn window's content area aspect (see BrowserWindow.tsx).
const VIEWPORT = { width: 1280, height: 800 };
// A plain desktop UA: some sites serve a bot wall to "HeadlessChrome".
const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
// Same guard as chaosWindows.ts's comments: a title that reads like a bot
// wall, or that mentions the unlaunched AI features, must not reach a frame.
const BAD_TITLE = /just a moment|attention required|access denied|\bAI\b/i;

// Pages that never expose a <link rel=icon> to this capture (bot wall in front).
const FAVICON_OVERRIDES: Record<string, string> = {
    "https://superuser.com": "https://cdn.sstatic.net/Sites/superuser/Img/favicon.ico",
};

// Pages whose headless capture is unusable (unstyled bot-wall HTML), so no screenshot is kept and the drawn window never shows them as the
// active tab; BrowserWindow falls back to a plain blank page for them.
const NO_PAGE_SHOT = new Set(["https://superuser.com"]);

const slugOf = (url: string) =>
    new URL(url).hostname.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();

async function main() {
    fs.mkdirSync(FAVICON_DIR, { recursive: true });
    fs.mkdirSync(PAGE_DIR, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: VIEWPORT, userAgent: USER_AGENT, locale: "en-US" });
    const previous: Record<string, { fromPopup?: boolean; title?: string; host?: string }> = fs.existsSync(OUT_JSON)
        ? JSON.parse(fs.readFileSync(OUT_JSON, "utf-8"))
        : {};
    const result: Record<string, unknown> = {};
    const problems: string[] = [];

    for (const url of CHAOS_WINDOW_URLS.flat()) {
        const slug = slugOf(url);
        const page = await context.newPage();
        try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
            await page.waitForLoadState("load", { timeout: 15000 }).catch(() => null);
            await page.waitForTimeout(2500);
            // Cloudflare interstitials (Super User) clear on a retry; give a
            // late-set title (client-rendered sites) a few seconds as well.
            for (let attempt = 0; attempt < 4; attempt++) {
                const t = (await page.title()).trim();
                if (t && !/just a moment/i.test(t)) break;
                await page.waitForTimeout(3000);
                if (attempt === 1) await page.reload({ waitUntil: "domcontentloaded" }).catch(() => null);
            }
            const title = (await page.title()).trim() || "";
            const info = await page.evaluate(() => {
                const icon = Array.from(document.querySelectorAll<HTMLLinkElement>("link[rel~='icon']"))
                    // Prefer a raster icon; SVG favicons are fine too but ICO/PNG are the common case.
                    .sort((a, b) => Number(/\.svg/.test(a.href)) - Number(/\.svg/.test(b.href)))[0];
                const theme = document.querySelector<HTMLMetaElement>("meta[name='theme-color']")?.content;
                return { icon: icon?.href ?? null, theme: theme ?? null, finalUrl: location.href };
            });
            const finalUrl = new URL(info.finalUrl);
            let faviconRel = "";
            for (const candidate of [FAVICON_OVERRIDES[url] ?? info.icon, `${finalUrl.origin}/favicon.ico`]) {
                if (!candidate) continue;
                const res = await context.request.get(candidate).catch(() => null);
                if (!res?.ok()) continue;
                const type = res.headers()["content-type"] ?? "";
                const ext = type.includes("svg") ? "svg" : type.includes("png") ? "png" : type.includes("jpeg") ? "jpg" : "ico";
                fs.writeFileSync(path.join(FAVICON_DIR, `${slug}.${ext}`), await res.body());
                faviconRel = `tour/favicons/${slug}.${ext}`;
                break;
            }
            if (!faviconRel) problems.push(`${url}: no favicon found`);
            const shotFile = path.join(PAGE_DIR, `${slug}.jpg`);
            if (NO_PAGE_SHOT.has(url)) fs.rmSync(shotFile, { force: true });
            else await page.screenshot({ path: shotFile, type: "jpeg", quality: 82 });
            if (BAD_TITLE.test(title)) problems.push(`${url}: suspicious title "${title}"`);
            // record-tour.ts overwrites title/host with what the real popup shows
            // (the popup is the truth); don't undo that when re-capturing images.
            const fromPopup = previous[url]?.fromPopup ? previous[url] : null;
            result[url] = {
                ...(fromPopup ? { fromPopup: true } : {}),
                title: fromPopup ? fromPopup.title : title,
                // Address bar text: the site as Chrome shows it after redirects, minus scheme.
                host: fromPopup
                    ? fromPopup.host
                    : `${finalUrl.host}${finalUrl.pathname === "/" ? "" : finalUrl.pathname}`.replace(/^www\./, ""),
                favicon: faviconRel,
                screenshot: NO_PAGE_SHOT.has(url) ? "" : `tour/pages/${slug}.jpg`,
                accent: info.theme && /^#|^rgb/.test(info.theme) ? info.theme : "#6b7280",
            };
            console.log(`ok   ${url} -> "${title}"`);
        } catch (err) {
            problems.push(`${url}: ${(err as Error).message.split("\n")[0]}`);
        } finally {
            await page.close();
        }
    }
    await browser.close();
    fs.writeFileSync(OUT_JSON, JSON.stringify(result, null, 4) + "\n");
    if (problems.length) {
        console.error("Problems:\n" + problems.map((p) => `  ${p}`).join("\n"));
        process.exitCode = 1;
    }
}

main();
