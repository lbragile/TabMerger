import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { THEME_COLORS } from "../Composition";
import footage from "../../lib/tourRestoreGroupFootage.json";
import { Desktop, type TourSceneProps } from "./common";

// Poster image for the feature tour (a still, not part of the video): the frame people see before
// pressing play. Left: logo, name and the site headline. Right: the real popup showing the organised
// result, from the last footage frame of scene 7 (signed out, Q4 Launch selected and pink, "Window" and
// "Assets", the other coloured groups). Text and popup sit either side of the centre, clear of a player's
// play-button overlay, and nothing important is in the bottom ~12% (progress bar).
//
// Wording: the headline is the site hero's h1 (packages/web/components/marketing/Hero.tsx).

// The last footage frame of scene 7 in the requested theme (light falls back to dark if it is not recorded).
const lastFrame = (theme: "light" | "dark") => {
    const frames = footage.frames as Record<string, number>;
    const t = frames[theme] ? theme : "dark";
    return `tour/frames/${t}/restore-group/f-${String(frames[t]).padStart(4, "0")}.jpg`;
};

const NAME = "TabMerger";
const HEADLINE = ["Stop drowning in", "browser tabs."];
const LOGO_SIZE = 128; // the asset is 128x128: shown 1:1 so it stays sharp

// The product side is a cropped, enlarged viewport on the popup (css px of the 800x600 popup): the
// top-left 0..640 x 0..316 region holds the header's logo and name, the whole sidebar group list (Now Open
// to Add Group) and the two window cards. It is shown at 1.8x (the footage is 2x, so it stays sharp), starts
// right of the centre band (x 816 to 1104) and bleeds off the right edge on purpose: only css x 0..~589 is
// inside the canvas, so the cut falls in blank row space off-canvas. The cursor and the empty lower panel
// are outside the crop.
const VIEW = { left: 860, scale: 1.8, cropCssW: 640, cropCssH: 316 };
const VIEW_W = VIEW.cropCssW * VIEW.scale; // 1152, runs 92px past the right edge of the 1920 canvas
const VIEW_H = VIEW.cropCssH * VIEW.scale; // 569
const VIEW_TOP = Math.round((1080 - VIEW_H) / 2); // vertically centred; the text block is centred on the same line
const TEXT_LEFT = 96;

export function TourThumbnail({ theme = "dark" }: TourSceneProps) {
    const colors = THEME_COLORS[theme];
    return (
        <Desktop theme={theme}>
            <AbsoluteFill style={{ fontFamily: "sans-serif", color: colors.text }}>
                <div style={{ position: "absolute", left: TEXT_LEFT, top: 0, bottom: 0, width: 700, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <Img src={staticFile("logo.png")} style={{ width: LOGO_SIZE, height: LOGO_SIZE }} />
                    <div style={{ marginTop: 24, fontWeight: 800, fontSize: 120, lineHeight: 1.02, letterSpacing: "-0.02em" }}>{NAME}</div>
                    <div style={{ marginTop: 36, fontWeight: 700, fontSize: 84, lineHeight: 1.1, letterSpacing: "-0.01em" }}>
                        {HEADLINE.map((line) => (
                            <div key={line}>{line}</div>
                        ))}
                    </div>
                </div>
                <div
                    style={{
                        position: "absolute",
                        left: VIEW.left,
                        top: VIEW_TOP,
                        width: VIEW_W,
                        height: VIEW_H,
                        overflow: "hidden",
                        borderRadius: 14,
                        boxShadow: "0 30px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(128,128,128,0.35)",
                    }}
                >
                    <Img src={staticFile(lastFrame(theme))} style={{ position: "absolute", left: 0, top: 0, width: 800 * VIEW.scale, height: 600 * VIEW.scale, objectFit: "fill" }} />
                </div>
            </AbsoluteFill>
        </Desktop>
    );
}
