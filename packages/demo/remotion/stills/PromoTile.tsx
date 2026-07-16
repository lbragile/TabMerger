// Static branded promo tile for the small (440x280) and marquee (1400x560)
// Chrome Web Store canvases. Two distinct treatments (see `variant`):
//   - marquee: dark-mode scene vs light-mode scene, split by a gentle ~45deg
//     curve — the two "tones" ARE the two theme screenshots.
//   - small: single large, sharp, full-bleed screenshot (dark mode), no
//     logo/branding badge, just the product — plus a small multi-window
//     inset since no single screenshot shows that on its own.
// Both include a corner inset proving multi-window support (Research group,
// captured post-"Split windows" — a group whose tabs span multiple windows).
import React from "react";
import { AbsoluteFill, Img, staticFile, useVideoConfig } from "remotion";

// ponytail: "open-popup" (not "view-groups") for the light side — both
// screenshots show the same Research group/tabs, so pairing them made the
// seam look like it was cutting one duplicated window in half rather than
// showing two distinct scenes. "open-popup" (the Now Open group) reads as
// a clearly different scene from the dark side's Research view.
const LIGHT_SCREENSHOT_ID = "open-popup";
const DARK_SCREENSHOT_ID = "dark-mode";
// Dedicated promo-only capture (screenshots.ts, not a demo-script step) —
// Research group after "Split windows": one group whose tabs are spread
// across multiple windows, proving multi-window support.
const MULTI_WINDOW_SCREENSHOT_ID = "multi-window";

// objectFit "contain" so the full 780x600 popup is visible, uncropped.
function Scene({ screenshotId, style }: { screenshotId: string; style?: React.CSSProperties }) {
    return (
        <Img
            src={staticFile(`screenshots/raw/${screenshotId}.png`)}
            style={{ position: "absolute", width: "100%", height: "100%", objectFit: "contain", ...style }}
        />
    );
}

function MultiWindowInset({ style }: { style?: React.CSSProperties }) {
    return (
        <div
            style={{
                position: "absolute",
                borderRadius: 8,
                overflow: "hidden",
                border: "2px solid rgba(255,255,255,0.85)",
                boxShadow: "0 12px 28px rgba(0,0,0,0.5)",
                transform: "rotate(-2deg)",
                ...style,
            }}
        >
            <Img
                src={staticFile(`screenshots/raw/${MULTI_WINDOW_SCREENSHOT_ID}.png`)}
                style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
            />
        </div>
    );
}

function MarqueeTile() {
    const { width, height } = useVideoConfig();

    // Curvy seam at roughly 45 degrees: over the full canvas height, shift x
    // by (height/width)*100 percent — a true 45deg slope in pixel space
    // regardless of the canvas's own aspect ratio — plus a small sine wobble
    // for a gentle curve. Centered at 50% so it crosses the screenshots' own
    // horizontal midpoint (each screenshot is itself centered on the canvas).
    const slope = (height / width) * 100;
    const amplitude = 4;
    const seamXAt = (t: number) => 50 + slope * (t - 0.5) + amplitude * Math.sin(t * Math.PI * 2 - Math.PI / 2);
    const steps = 40;
    const seamPoints = Array.from({ length: steps + 1 }, (_, i) => {
        const t = i / steps;
        return { x: seamXAt(t), y: t * 100 };
    });
    const leftPolygon = ["0% 0%", ...seamPoints.map((p) => `${p.x}% ${p.y}%`), "0% 100%"].join(", ");
    const rightPolygon = ["100% 0%", ...seamPoints.map((p) => `${p.x}% ${p.y}%`), "100% 100%"].join(", ");

    return (
        <AbsoluteFill style={{ backgroundColor: "#0b0f14" }}>
            {/* Left: dark-mode scene. Right: light-mode scene. */}
            <Scene screenshotId={DARK_SCREENSHOT_ID} style={{ clipPath: `polygon(${leftPolygon})` }} />
            <Scene screenshotId={LIGHT_SCREENSHOT_ID} style={{ clipPath: `polygon(${rightPolygon})` }} />

            {/* seam highlight along the curvy cut */}
            <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
            >
                <polyline
                    points={seamPoints.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke="rgba(255,255,255,0.85)"
                    strokeWidth={0.6}
                    vectorEffect="non-scaling-stroke"
                />
            </svg>

            {/* Logo + tagline in the top-left corner, away from the seam */}
            <div style={{ position: "absolute", left: 24, top: 20, display: "flex", alignItems: "center", gap: 10 }}>
                <Img src={staticFile("logo.png")} style={{ width: 36, height: 36 }} />
                <div style={{ color: "white", fontFamily: "sans-serif", fontWeight: 800, fontSize: 22 }}>
                    TabMerger
                </div>
            </div>
            <div
                style={{
                    position: "absolute",
                    left: 24,
                    top: 68,
                    color: "rgba(255,255,255,0.9)",
                    fontFamily: "sans-serif",
                    fontWeight: 700,
                    fontSize: 20,
                }}
            >
                Light or dark. Always organized.
            </div>

            {/* Multi-window proof, tucked in the bottom-left corner */}
            <MultiWindowInset style={{ left: 24, bottom: 20, width: 260, aspectRatio: "780 / 600" }} />
        </AbsoluteFill>
    );
}

function SmallTile() {
    return (
        <AbsoluteFill style={{ backgroundColor: "#0b0f14" }}>
            {/* Full-bleed dark-mode hero — cropped (not letterboxed) and
                left-anchored so the sidebar/group list (the most legible,
                recognizable part of the UI) fills the frame instead of
                floating in empty space. */}
            <Img
                src={staticFile(`screenshots/raw/${DARK_SCREENSHOT_ID}.png`)}
                style={{
                    position: "absolute",
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    objectPosition: "left center",
                }}
            />
            <MultiWindowInset style={{ right: 12, bottom: 12, width: 130, aspectRatio: "780 / 600" }} />
        </AbsoluteFill>
    );
}

export function PromoTile({ variant }: { variant: "marquee" | "small" }) {
    return variant === "marquee" ? <MarqueeTile /> : <SmallTile />;
}
