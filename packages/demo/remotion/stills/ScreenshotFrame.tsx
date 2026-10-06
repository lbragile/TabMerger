// Composites a raw 800x600 popup screenshot (from screenshots/raw/*.png,
// captured by ../../screenshots.ts) onto a branded 1280x800 canvas — Chrome
// Web Store screenshots must be full-canvas, not a bare popup crop.
import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { demoScript, promoOnlySteps } from "../../demo-script";

// screenshots.ts names raw files "<demoScript step id>-<theme>.png" (plus
// the theme-less "multi-window.png" promo-only capture, which has no
// demo-script step at all). Strip the theme suffix and look the caption up
// from the single source of truth so store captions can never drift from
// the video's own captions.
const CAPTIONS: Record<string, string> = Object.fromEntries(
    [...demoScript, ...promoOnlySteps].map((step) => [step.id, step.caption]),
);
CAPTIONS["multi-window"] = "One group, split across windows. Still one click away.";

function captionFor(screenshotId: string): string {
    const stepId = screenshotId.replace(/-(light|dark)$/, "");
    return CAPTIONS[stepId] ?? "";
}

// cluttered-chrome.png is a native 1400x155 strip of real browser chrome, not an
// 800x600 popup. Forcing it into the popup box (760x570) stretched it ~7x
// vertically and blurred every glyph. Instead draw it UNSTRETCHED: width 1180
// (a 0.84x downscale, which stays sharp) with its natural aspect ratio, and
// crop the sliver of page body below the bookmarks bar.
const CLUTTER_ID = "cluttered-chrome";
const CLUTTER_SRC_WIDTH = 1400;
const CLUTTER_SRC_HEIGHT = 155;
const CLUTTER_BAR_BOTTOM = 118; // native y where the bookmarks bar ends
const CLUTTER_SHOWN_WIDTH = 1180;

function ClutteredChromeFrame() {
    const scale = CLUTTER_SHOWN_WIDTH / CLUTTER_SRC_WIDTH;
    return (
        <AbsoluteFill
            style={{
                backgroundColor: "#0b0f14",
                backgroundImage: "radial-gradient(circle at 30% 20%, #1c2a3a 0%, #0b0f14 70%)",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
            }}
        >
            <div
                style={{
                    color: "white",
                    fontFamily: "sans-serif",
                    fontWeight: 800,
                    fontSize: 40,
                    lineHeight: 1.25,
                    textAlign: "center",
                    maxWidth: 1100,
                    marginBottom: 48,
                    textShadow: "0 2px 12px rgba(0,0,0,0.6)",
                }}
            >
                Too many tabs. Too many windows.
            </div>
            <div
                style={{
                    width: CLUTTER_SHOWN_WIDTH,
                    height: Math.round(CLUTTER_BAR_BOTTOM * scale),
                    overflow: "hidden",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.12)",
                    boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
                }}
            >
                <Img
                    src={staticFile(`screenshots/raw/${CLUTTER_ID}.png`)}
                    style={{ width: CLUTTER_SHOWN_WIDTH, height: Math.round(CLUTTER_SRC_HEIGHT * scale), display: "block" }}
                />
            </div>
        </AbsoluteFill>
    );
}

export function ScreenshotFrame({ screenshotId }: { screenshotId: string }) {
    if (screenshotId === CLUTTER_ID) return <ClutteredChromeFrame />;
    const caption = captionFor(screenshotId);
    return (
        <AbsoluteFill
            style={{
                backgroundColor: "#0b0f14",
                backgroundImage:
                    "radial-gradient(circle at 30% 20%, #1c2a3a 0%, #0b0f14 70%)",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
            }}
        >
            {caption && (
                <div
                    style={{
                        color: "white",
                        fontFamily: "sans-serif",
                        fontWeight: 800,
                        fontSize: 40,
                        lineHeight: 1.25,
                        textAlign: "center",
                        maxWidth: 1100,
                        marginBottom: 36,
                        textShadow: "0 2px 12px rgba(0,0,0,0.6)",
                    }}
                >
                    {caption}
                </div>
            )}
            <Img
                src={staticFile(`screenshots/raw/${screenshotId}.png`)}
                style={{
                    width: 760,
                    height: 570,
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.12)",
                    boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
                }}
            />
        </AbsoluteFill>
    );
}
