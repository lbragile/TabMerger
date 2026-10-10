import React from "react";
import { AbsoluteFill } from "remotion";
import { THEME_COLORS } from "../Composition";
import type { TourTheme } from "./BrowserWindow";

export const TOUR_WIDTH = 1920;
export const TOUR_HEIGHT = 1080;
export const TOUR_FPS = 30;

export interface TourSceneProps {
    /** Defaults to dark, like WalkthroughDemo (Remotion compositions need all-optional props). */
    theme?: TourTheme;
}

/** The "desktop" every tour scene sits on — same brand gradient as the other videos' title cards. */
export function Desktop({ theme = "dark", children }: TourSceneProps & { children?: React.ReactNode }) {
    return <AbsoluteFill style={{ background: THEME_COLORS[theme].bgGradient }}>{children}</AbsoluteFill>;
}

// Same look as the caption bar in Composition.tsx (sharp corners, translucent
// black, white semibold sans), sized up for the 1920x1080 canvas.
export function CaptionBar({ text, opacity }: { text: string; opacity?: number }) {
    return (
        <div
            style={{
                position: "absolute",
                zIndex: 2000,
                bottom: 48,
                left: 64,
                right: 64,
                padding: "18px 40px",
                borderRadius: 0,
                background: "rgba(0,0,0,0.65)",
                color: "white",
                fontFamily: "sans-serif",
                fontSize: 32,
                fontWeight: 600,
                textAlign: "center",
                ...(opacity === undefined ? {} : { opacity }),
            }}
        >
            {/* nbsp keeps the bar its full height while the text is blank between scenes */}
            {text || " "}
        </div>
    );
}

/** A caption that changes mid-scene: `text` is shown from scene-local frame `from` until the next cue. */
export interface CaptionCue {
    from: number;
    text: string;
}

/** Frames around every caption change (cuts between scenes and cues within one) in which the text is blank, so two captions never overlap. */
export const CAPTION_GAP_FRAMES = 6;

/** The caption text at scene-local frame `local`: blank for CAPTION_GAP_FRAMES centred on each cue after the first. */
export function captionTextAt(caption: string | CaptionCue[], local: number): string {
    if (typeof caption === "string") return caption;
    const half = CAPTION_GAP_FRAMES / 2;
    if (caption.some((cue, i) => i > 0 && local >= cue.from - half && local < cue.from + half)) return "";
    let text = "";
    for (const cue of caption) if (local >= cue.from) text = cue.text;
    return text;
}

/** True when a scene's registry caption is empty, i.e. the scene wants no caption bar at all. */
export const hasNoCaption = (caption: string | CaptionCue[]) => (typeof caption === "string" ? caption === "" : caption.length === 0);

/** Frames over which the caption bar fades out at the start of a scene that opts out of it (full tour only). */
export const CAPTION_BAR_FADE_FRAMES = 10;
