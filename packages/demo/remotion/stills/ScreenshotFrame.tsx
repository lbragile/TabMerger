// Composites a raw 780x600 popup screenshot (from screenshots/raw/*.png,
// captured by ../../screenshots.ts) onto a branded 1280x800 canvas — Chrome
// Web Store screenshots must be full-canvas, not a bare popup crop.
import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";

export function ScreenshotFrame({ screenshotId }: { screenshotId: string }) {
    return (
        <AbsoluteFill
            style={{
                backgroundColor: "#0b0f14",
                backgroundImage:
                    "radial-gradient(circle at 30% 20%, #1c2a3a 0%, #0b0f14 70%)",
                justifyContent: "center",
                alignItems: "center",
            }}
        >
            <Img
                src={staticFile(`screenshots/raw/${screenshotId}.png`)}
                style={{
                    width: 780,
                    height: 600,
                    borderRadius: 12,
                    boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
                }}
            />
        </AbsoluteFill>
    );
}
