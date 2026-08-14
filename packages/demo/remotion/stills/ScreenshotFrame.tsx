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

export function ScreenshotFrame({ screenshotId }: { screenshotId: string }) {
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
