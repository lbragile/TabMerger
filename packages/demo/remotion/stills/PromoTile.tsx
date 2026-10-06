// Static branded promo tile for the small (440x280) and marquee (1400x560)
// Chrome Web Store canvases. Two distinct treatments (see `variant`):
//   - marquee: "mess in, order out" — a REAL cluttered-Chrome screenshot
//     (actual tab strip + bookmarks bar, captured via screenshots.ts's
//     captureClutteredChrome(), an OS-level window capture since
//     page.screenshot() can't see native browser chrome) side by side with
//     the real organized-group screenshot. Two separate panels, not
//     composited/overlaid — coordinator explicitly rejected both the
//     earlier CSS-drawn tab-strip illustration AND any stacking of images
//     on top of the extension shot (2026-08-13 correction). The chaos panel
//     uses objectFit "contain" (not "cover") so more of the cluttered tab
//     strip/bookmarks bar is visible rather than zoomed in tight, and the
//     headline/logo sit over the organized-extension (right) panel for
//     contrast (2026-08-14 corrections). No multi-window inset — removed
//     per coordinator request (2026-08-14).
//   - small: the SAME popup state (open-popup, the "Now Open" main view),
//     shown twice — light mode vs dark mode — split along a corner-to-corner
//     DIAGONAL (not a straight vertical/horizontal cut) via a clip-path
//     triangle, running top-left -> bottom-right specifically (light =
//     top-right triangle, dark = bottom-left triangle, per 2026-08-14
//     correction; originally ran the other diagonal).
import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";

// Small tile: same popup state (the unified "Now Open" view — the single
// clearest "this is the product" screenshot) in both themes, so the split
// reads as "one view, light or dark" rather than two different features.
const MAIN_VIEW_LIGHT_ID = "open-popup-light";
const MAIN_VIEW_DARK_ID = "open-popup-dark";
// Marquee "order" side: the organized-group payoff shot (post color/copy/
// organize) — the clearest single frame of "chaos, tamed".
const ORGANIZED_SCREENSHOT_ID = "view-new-group-dark";
// Marquee "chaos" side: a REAL Chrome browser screenshot (native tab strip +
// cluttered bookmarks bar), captured by screenshots.ts's
// captureClutteredChrome() — not extension UI, not an illustration.
const CLUTTERED_CHROME_SCREENSHOT_ID = "cluttered-chrome";

// objectFit "contain" so the full 800x600 popup is visible, uncropped.
function Scene({ screenshotId, style }: { screenshotId: string; style?: React.CSSProperties }) {
    return (
        <Img
            src={staticFile(`screenshots/raw/${screenshotId}.png`)}
            style={{ position: "absolute", width: "100%", height: "100%", objectFit: "contain", ...style }}
        />
    );
}

// ponytail: 2026-09-26 fix — two separate real bugs the coordinator caught by
// actually viewing the rendered tile (both stemmed from treating the full
// tile height as one flat image area):
//
// 1. `CLUTTERED_CHROME_SCREENSHOT_ID` is captureClutteredChrome()'s cropped
//    chrome-band-only capture (screenshots.ts, `chromeBandHeight = 155` out of
//    a 1400-wide window) — a ~9:1 WIDE, SHORT strip. Stretched into a
//    tall(-ish) 44%-width/100%-height box with `objectFit:"contain"`, the
//    browser sizes it by the WIDTH-limited scale (the only way to keep the
//    whole 9:1 image inside a ~1.1:1 box without cropping), so it renders as
//    a ~68px-tall sliver dead-centered in a 560px-tall box — a "squashed
//    strip with empty black above/below" is exactly what `contain` produces
//    for an image this wide relative to its box, not a rendering glitch.
//    Fixed by switching this ONE image to `objectFit:"cover"` (crops the
//    strip's left/right edges instead of leaving vertical dead space — the
//    tab strip + bookmarks bar are dense enough that a center crop still
//    reads as "cluttered", unlike the near-empty box `contain` produced).
// 2. Both panels' image boxes were `height:"100%"`, i.e. the SAME vertical
//    span as the bottom text banner sitting on top of them — for the
//    right/organized panel specifically, `view-new-group-dark`'s real popup
//    screenshot (4:3) `contain`-fit into the panel scales by WIDTH, leaving
//    it taller than the space actually free above the banner, so the
//    image's own bottom edge (the popup's live stats footer row) sat
//    directly under the "Tab chaos in. Order out." text — not a fixed
//    z-index/overlay issue, the image and the text band genuinely occupied
//    the same pixels. Fixed by giving the image boxes
//    `height:"calc(100% - {BANNER_HEIGHT}px)"` so they structurally stop
//    above the banner and can never reach into it, instead of relying on
//    the banner's gradient to visually hide an overlap that was still
//    there pixel-for-pixel.
const MARQUEE_BANNER_HEIGHT = 116;

function MarqueeTile() {
    // "Mess in, order out": a REAL cluttered-Chrome screenshot (actual tab
    // strip + bookmarks bar) side by side with the real organized-group
    // screenshot — two clearly separated panels, no compositing/overlay of
    // one image on top of the other.
    return (
        <AbsoluteFill style={{ backgroundColor: "#0b0f14" }}>
            <div
                style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: "44%",
                    height: `calc(100% - ${MARQUEE_BANNER_HEIGHT}px)`,
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "#14181f",
                }}
            >
                {/* ponytail: 2026-09-26 — REDESIGNED, don't tweak objectFit
                    again (2nd coordinator round asked for a rethink, not
                    another fit-mode tweak). This screenshot
                    (`chromeBandHeight = 155` out of a 1400-wide window,
                    screenshots.ts) is NATIVELY a ~9:1 wide/short strip — that
                    shape is real, not a bug. Two previous attempts got this
                    wrong in opposite directions:
                    - `contain` at the panel's full height stretched the fit
                      calculation to the WIDTH-limited scale (~0.44x), which
                      technically showed every tab uncropped but at a
                      near-illegible size, dead-centered in a ton of empty
                      black space (round 1 bug).
                    - `cover` at the panel's full height did the opposite:
                      scaled by the HEIGHT-limited factor (~3.5-4x) to fill
                      the tall box, which cropped away all but ~1-2 tabs'
                      worth of width — a "5x blow-up of 3 tab fragments"
                      (round 2 bug), the literal opposite failure mode.
                    Root cause of BOTH: forcing this 9:1 image to fill a
                    ~1.1:1 box's HEIGHT was never going to work — either the
                    fit calc is width-limited (empty space) or height-limited
                    (crop to a sliver of width), there's no third option once
                    you require full-height fill. The actual fix is to stop
                    requiring that: size the image to fill the panel's WIDTH
                    at a natural, undistorted, un-cropped aspect ratio
                    (`width:100%`, no forced height, `objectFit` irrelevant
                    since nothing needs cropping), so ALL tabs stay visible
                    at a legible, moderately-upscaled size (~1.5x the raw
                    capture's native pixels for this panel width, versus
                    `contain`'s ~0.44x), and let the flexbox `center` above
                    place the resulting short strip in the middle of the
                    panel — the plain dark space above/below it now reads as
                    a deliberate "browser mockup on a dark card" frame (a
                    normal, common promo-tile treatment) rather than the
                    "half the panel is dead black" bug from round 1, because
                    the panel itself is already correctly bounded (see the
                    `calc(100% - banner)` fix from the previous pass) and the
                    image only occupies a modest fraction of it, not most of
                    it. */}
                {/* 2026-10-06: the 1400px strip was being downscaled to the
                    616px panel (0.44x) which made the glyphs mush. Show it
                    at NATIVE 1:1 pixels instead, left-aligned and cropped to
                    the panel width (first tabs + start of the bookmarks bar),
                    and drop the page-body sliver below the bookmarks bar. */}
                <div style={{ width: "100%", height: 118, overflow: "hidden" }}>
                    <Img
                        src={staticFile(`screenshots/raw/${CLUTTERED_CHROME_SCREENSHOT_ID}.png`)}
                        style={{ width: 1400, height: 155, maxWidth: "none", display: "block" }}
                    />
                </div>
            </div>
            <div
                style={{
                    position: "absolute",
                    right: 0,
                    top: 0,
                    width: "44%",
                    height: `calc(100% - ${MARQUEE_BANNER_HEIGHT}px)`,
                }}
            >
                <Scene screenshotId={ORGANIZED_SCREENSHOT_ID} />
            </div>

            {/* funnel arrow, centered over the image area (excludes the text
                banner so it never overlaps the headline either) */}
            <div
                style={{
                    position: "absolute",
                    left: "44%",
                    width: "12%",
                    top: 0,
                    height: `calc(100% - ${MARQUEE_BANNER_HEIGHT}px)`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                <svg width="90" height="60" viewBox="0 0 90 60">
                    <path d="M0 30 H60" stroke="white" strokeWidth={6} strokeLinecap="round" />
                    <path d="M52 12 L78 30 L52 48" fill="none" stroke="white" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </div>

            {/* headline banner across the bottom, over both halves — its own
                dedicated, opaque strip now that neither image box extends
                into it, not just a gradient hoping to visually hide an
                overlap. */}
            <div
                style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: MARQUEE_BANNER_HEIGHT,
                    background: "#0b0f14",
                }}
            />
            {/* Text + logo over the organized-extension side (right panel) for
                contrast — coordinator correction: "move text and logo to the
                extension side for better contrast" (2026-08-14). Positioned
                relative to the banner's own height, not the whole tile, so it
                can never drift back onto the image above it. */}
            <div
                style={{
                    position: "absolute",
                    left: "58%",
                    bottom: MARQUEE_BANNER_HEIGHT - 52,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                }}
            >
                <Img src={staticFile("logo.png")} style={{ width: 36, height: 36 }} />
                <div style={{ color: "white", fontFamily: "sans-serif", fontWeight: 800, fontSize: 22 }}>
                    TabMerger
                </div>
            </div>
            <div
                style={{
                    position: "absolute",
                    left: "58%",
                    right: 24,
                    bottom: 16,
                    color: "white",
                    fontFamily: "sans-serif",
                    fontWeight: 800,
                    fontSize: 34,
                    lineHeight: 1.2,
                    textShadow: "0 2px 10px rgba(0,0,0,0.7)",
                }}
            >
                Tab chaos in. Order out.
            </div>
        </AbsoluteFill>
    );
}

// Small-tile canvas size (matches Root.tsx's PromoSmall composition) — used
// to draw the diagonal divider line at the exact same corner-to-corner
// coordinates as the clip-path triangle below.
const SMALL_TILE_WIDTH = 440;
const SMALL_TILE_HEIGHT = 280;

function SmallTile() {
    // Same popup state, light vs dark, split along a DIAGONAL corner-to-
    // corner line (not a straight vertical/horizontal cut) — coordinator
    // correction: "split it in the same extension view down the middle,
    // diagonally". Dark fills the frame as the base layer; light is clipped
    // to the top-right/bottom-left triangle on top of it.
    return (
        <AbsoluteFill style={{ backgroundColor: "#0b0f14" }}>
            <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#0b0f14" }}>
                <Scene screenshotId={MAIN_VIEW_DARK_ID} />
            </div>
            <div
                style={{
                    position: "absolute",
                    inset: 0,
                    overflow: "hidden",
                    background: "#f5f5f5",
                    // Light occupies the top-right triangle so the dividing
                    // edge runs top-left -> bottom-right — coordinator
                    // correction: "make the diagonal from top left to bottom
                    // right" (2026-08-14).
                    clipPath: "polygon(0 0, 100% 0, 100% 100%)",
                }}
            >
                <Scene screenshotId={MAIN_VIEW_LIGHT_ID} />
            </div>
            {/* diagonal dividing line, drawn along the same clip-path edge */}
            <svg
                style={{ position: "absolute", inset: 0 }}
                width="100%"
                height="100%"
                viewBox={`0 0 ${SMALL_TILE_WIDTH} ${SMALL_TILE_HEIGHT}`}
                preserveAspectRatio="none"
            >
                <line
                    x1={0}
                    y1={0}
                    x2={SMALL_TILE_WIDTH}
                    y2={SMALL_TILE_HEIGHT}
                    stroke="rgba(255,255,255,0.85)"
                    strokeWidth={3}
                    vectorEffect="non-scaling-stroke"
                />
            </svg>

            {/* Scrim + headline banner along the bottom, over both halves. */}
            <div
                style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 74,
                    background: "linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0))",
                }}
            />
            <div
                style={{
                    position: "absolute",
                    bottom: 8,
                    left: 12,
                    right: 12,
                    color: "white",
                    fontFamily: "sans-serif",
                    fontWeight: 800,
                    fontSize: 20,
                    lineHeight: 1.15,
                    textAlign: "center",
                    textShadow: "0 2px 8px rgba(0,0,0,0.9)",
                }}
            >
                Light or dark. Always organized.
            </div>
        </AbsoluteFill>
    );
}

// Social preview (1280x640, 2:1 — GitHub repo social preview / og:image).
// The marquee is too wide (2.5:1) and its left half reads as empty space at
// thumbnail size, so this is a dedicated layout: brand + big tagline left,
// the SAME dark popup capture the marquee uses (ORGANIZED_SCREENSHOT_ID) on
// the right, as large as it fits. Content stays inside a safe zone larger
// than 5% top/bottom (32px of 640) because some sites crop to 1.91:1.
// Sizes in rem (root 16px) per the project's rem preference.
const SOCIAL_SAFE_REM = 2.5; // 40px > 5% of 640 (32px)
const SOCIAL_POPUP_WIDTH_REM = 42.5; // 680px wide -> 510px tall at 4:3

function SocialTile() {
    return (
        <AbsoluteFill style={{ backgroundColor: "#0b0f14", fontFamily: "sans-serif" }}>
            <div
                style={{
                    position: "absolute",
                    left: "3.5rem",
                    top: `${SOCIAL_SAFE_REM}rem`,
                    bottom: `${SOCIAL_SAFE_REM}rem`,
                    width: "28rem",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    gap: "1.75rem",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "0.875rem" }}>
                    <Img src={staticFile("logo.png")} style={{ width: "3.5rem", height: "3.5rem" }} />
                    <div style={{ color: "white", fontWeight: 800, fontSize: "2.25rem" }}>TabMerger</div>
                </div>
                <div style={{ color: "white", fontWeight: 800, fontSize: "4.25rem", lineHeight: 1.05 }}>
                    Tab chaos in. Order out.
                </div>
                <div style={{ color: "rgba(255,255,255,0.72)", fontWeight: 600, fontSize: "1.375rem", lineHeight: 1.35 }}>
                    Chrome, Brave, Edge, Firefox · encrypted&nbsp;sync
                </div>
            </div>
            <div
                style={{
                    position: "absolute",
                    right: "2.5rem",
                    top: "50%",
                    width: `${SOCIAL_POPUP_WIDTH_REM}rem`,
                    transform: "translateY(-50%)",
                    borderRadius: "0.75rem",
                    overflow: "hidden",
                    boxShadow: "0 0.5rem 2rem rgba(0,0,0,0.6)",
                    border: "1px solid rgba(255,255,255,0.12)",
                }}
            >
                <Img
                    src={staticFile(`screenshots/raw/${ORGANIZED_SCREENSHOT_ID}.png`)}
                    style={{ width: "100%", height: "auto", display: "block" }}
                />
            </div>
        </AbsoluteFill>
    );
}

export function PromoTile({ variant }: { variant: "marquee" | "small" | "social" }) {
    if (variant === "social") return <SocialTile />;
    return variant === "marquee" ? <MarqueeTile /> : <SmallTile />;
}
