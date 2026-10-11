// Single source of truth for the "chaos" browser windows: the exact windows,
// tabs and tab order `chaosHook` (lib/actions.ts) opens in the real browser,
// AND what the drawn browser windows in the feature tour (remotion/tour/)
// show. Imported by both, so the two can never drift.
//
// Only the URL lists live here as code. Each tab's real page title and the
// local favicon/page-screenshot files come from `chaosTabs.json`, which
// `pnpm --filter @tabmerger/demo tour-assets` (capture-tour-assets.ts)
// regenerates by visiting every URL headless. No network at render time.
//
// No node imports on purpose: this module is webpack-bundled into Remotion.
import captured from "./chaosTabs.json";

// ponytail: moved here verbatim from actions.ts (2026-10-08). The notes on
// why specific sites were swapped out still apply: this list navigates to
// REAL live sites, so each tab's title is whatever that site's <title> says
// when capture-tour-assets.ts / record.ts runs. Verify a live title before
// ever reusing an external URL here.
export const CHAOS_WINDOW_URLS: string[][] = [
    [
        // ponytail: 2026-09-26 — swapped out "https://mail.google.com/..."
        // and "https://www.notion.so" here: their real current page titles
        // mention "AI", and this product's AI features aren't launched yet
        // (VITE_AI_ENABLED unset), so no demo frame should show that text
        // for an unrelated reason. Swapped to Yahoo Mail and Dropbox,
        // verified directly against their live <title>s. Re-verify the same
        // way before ever reusing a live external URL here again; real
        // sites' marketing copy drifts without warning.
        "https://mail.yahoo.com",
        "https://calendar.google.com/calendar/u/0/r/week",
        "https://app.slack.com/client",
        "https://github.com",
        "https://www.dropbox.com",
    ],
    [
        "https://arxiv.org",
        "https://react.dev",
        "https://developer.mozilla.org",
        "https://wxt.dev",
        "https://news.ycombinator.com",
    ],
    [
        // ponytail: 2026-09-26 — swapped stackoverflow.com out: it serves a
        // Cloudflare interstitial to this recorder's request pattern, so its
        // real tab title comes back as "Just a moment...". superuser.com
        // (same Stack Exchange family) responds directly with a real title.
        "https://superuser.com",
        // ponytail: 2026-09-26 — swapped Figma's real URL out (its live
        // <title> mentions "AI"). Sketch.com's live title is the same
        // "design tool" category with no AI mention.
        "https://www.sketch.com",
        "https://trello.com",
        // ponytail: 2026-10-08 — swapped LinkedIn and Twitter/X out: the
        // extension recorder gets a Cloudflare bot wall for LinkedIn (its real
        // tab title read "Attention Required! | Cloudflare") and x.com serves
        // an empty-title JS shell, so the popup showed just "x.com". Medium was
        // tried next and also hit a Cloudflare wall in the extension recorder
        // (though not in a plain headless visit). Dribbble and Flickr fit the design/social flavour of this window and, checked
        // live in BOTH the plain headless capture and the extension recorder,
        // load their real pages with no bot or sign-in wall and descriptive
        // titles without "AI": "Dribbble - Discover the World's Top Designers
        // & Creative Professionals" / "Flickr | The best place to be a photographer online."
        // Re-verify the same way before ever swapping again.
        "https://dribbble.com",
        "https://www.flickr.com",
    ],
];

export interface ChaosTab {
    url: string;
    /** Real page title, as captured from the live site. */
    title: string;
    /** Host shown in the address bar (no scheme). */
    host: string;
    /** Path under public/ for staticFile(), e.g. "tour/favicons/github.png". */
    favicon: string;
    /** Path under public/ for staticFile(), e.g. "tour/pages/github.jpg"; "" when no usable capture exists. */
    screenshot: string;
    /** Brand-ish colour used as the favicon fallback and page backdrop. */
    accent: string;
}

type CapturedEntry = Omit<ChaosTab, "url">;
const capturedByUrl = captured as Record<string, CapturedEntry>;

function toTab(url: string): ChaosTab {
    const entry = capturedByUrl[url];
    if (!entry) throw new Error(`chaosTabs.json has no entry for ${url} — run \`pnpm --filter @tabmerger/demo tour-assets\``);
    return { url, ...entry };
}

/**
 * Same windows, same tab order as `CHAOS_WINDOW_URLS`, with the captured data.
 * A function (not a constant) so `actions.ts` can import the URL lists without
 * needing `chaosTabs.json` to be populated yet.
 */
export function getChaosWindows(): ChaosTab[][] {
    return CHAOS_WINDOW_URLS.map((urls) => urls.map(toTab));
}
