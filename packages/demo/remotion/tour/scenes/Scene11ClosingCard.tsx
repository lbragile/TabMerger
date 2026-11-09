import React from "react";
import { AbsoluteFill, Easing, Img, Sequence, staticFile, useCurrentFrame } from "remotion";
import { THEME_COLORS } from "../../Composition";
import { Desktop, type TourSceneProps } from "../common";
import { SCENE_AI_FRAMES, Scene10AiSort } from "./Scene10AiSort";
import { ease, ramp } from "./Scene02OpenTabMerger";

// Closing card, the tour's last scene (11). Pure Remotion, no footage. It starts on scene 10 (Pro AI) last frame
// (the popup with the new AI groups), which fades and eases away over FADE_FRAMES, then the product
// logo, name, tagline and call to action ease in with a short stagger and hold. No caption bar
// (its registry caption is empty, so the tour layer draws none).
//
// Wording is reused from what the project already ships:
//   name     "TabMerger"                       the extension name (CHROMEWEBSTORE.md, manifest)
//   tagline  "Tab chaos, tamed."               the walkthrough outro in demo-script.ts ("TabMerger — tab chaos, tamed. Free to start.")
//   CTA      "Free to start" + the site address  "Free to start" is from the same outro; the site address is the
//                                                production site (https://tabmerger.com, PROD_WEB_APP_URL in publish.yml)

export const SCENE_ID = "closing-card";
export const SCENE_11_FRAMES = 120; // 4.0s
export const SCENE_11_CAPTION = ""; // empty: no caption bar for this scene

const NAME = "TabMerger";
const TAGLINE = "Tab chaos, tamed.";
const CTA = "Free to start";
const SITE = "tabmerger.com";

const FADE_FRAMES = 15; // scene 9's last frame fades and eases away
const IN_FRAMES = 18;
const STAGGER = [8, 18, 28, 38]; // logo, name, tagline, call to action
const LOGO_SIZE = 128; // the asset is 128x128: shown 1:1 so it stays sharp

export function Scene11ClosingCard({ theme = "dark" }: TourSceneProps) {
    const frame = useCurrentFrame();
    const colors = THEME_COLORS[theme];
    const out = ramp(frame, 0, FADE_FRAMES, Easing.linear);
    const item = (i: number) => {
        const p = ramp(frame, STAGGER[i], IN_FRAMES, ease);
        return { opacity: p, transform: `translateY(${(1 - p) * 18}px)` };
    };

    return (
        <Desktop theme={theme}>
            {/* The AI scene's final frame, fading and gently scaling away (same Sequence trick as scene 3 over scene 2). */}
            <Sequence from={-(SCENE_AI_FRAMES - 1)} durationInFrames={SCENE_AI_FRAMES - 1 + FADE_FRAMES}>
                <AbsoluteFill style={{ opacity: 1 - out, transform: `scale(${1 + 0.03 * out})`, transformOrigin: "50% 50%", zIndex: 10 }}>
                    <Scene10AiSort theme={theme} />
                </AbsoluteFill>
            </Sequence>

            <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", fontFamily: "sans-serif", color: colors.text, zIndex: 20 }}>
                <Img src={staticFile("logo.png")} style={{ width: LOGO_SIZE, height: LOGO_SIZE, ...item(0) }} />
                <div style={{ marginTop: 28, fontWeight: 800, fontSize: 96, lineHeight: 1.05, letterSpacing: "-0.02em", ...item(1) }}>{NAME}</div>
                <div style={{ marginTop: 18, fontWeight: 600, fontSize: 48, lineHeight: 1.2, ...item(2) }}>{TAGLINE}</div>
                <div style={{ marginTop: 44, fontWeight: 600, fontSize: 34, lineHeight: 1.2, ...item(3), opacity: item(3).opacity * 0.8 }}>
                    {CTA} <span style={{ opacity: 0.6 }}>{"·"}</span> {SITE}
                </div>
            </AbsoluteFill>
        </Desktop>
    );
}
