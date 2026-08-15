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

function MarqueeTile() {
    // "Mess in, order out": a REAL cluttered-Chrome screenshot (actual tab
    // strip + bookmarks bar) side by side with the real organized-group
    // screenshot — two clearly separated panels, no compositing/overlay of
    // one image on top of the other.
    return (
        <AbsoluteFill style={{ backgroundColor: "#0b0f14" }}>
            <div style={{ position: "absolute", left: 0, top: 0, width: "44%", height: "100%", overflow: "hidden" }}>
                {/* "contain" (not "cover") so more of the tab strip + bookmarks
                    bar is visible, not cropped in tight — coordinator correction
                    "zoom out on chrome clutter page" (2026-08-14). */}
                <Img
                    src={staticFile(`screenshots/raw/${CLUTTERED_CHROME_SCREENSHOT_ID}.png`)}
                    style={{ position: "absolute", width: "100%", height: "100%", objectFit: "contain" }}
                />
            </div>
            <div style={{ position: "absolute", right: 0, top: 0, width: "44%", height: "100%" }}>
                <Scene screenshotId={ORGANIZED_SCREENSHOT_ID} />
            </div>

            {/* funnel arrow, dead center, pointing from chaos to order */}
            <div
                style={{
                    position: "absolute",
                    left: "44%",
                    width: "12%",
                    top: 0,
                    height: "100%",
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

            {/* headline banner across the bottom, over both halves */}
            <div
                style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: 110,
                    background: "linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0))",
                }}
            />
            {/* Text + logo over the organized-extension side (right panel) for
                contrast — coordinator correction: "move text and logo to the
                extension side for better contrast" (2026-08-14). */}
            <div style={{ position: "absolute", left: "58%", bottom: 58, display: "flex", alignItems: "center", gap: 10 }}>
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

export function PromoTile({ variant }: { variant: "marquee" | "small" }) {
    return variant === "marquee" ? <MarqueeTile /> : <SmallTile />;
}
