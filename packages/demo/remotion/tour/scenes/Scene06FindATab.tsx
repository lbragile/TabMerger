import React from "react";
import { Easing, Img, staticFile, useCurrentFrame } from "remotion";
import footage from "../../../lib/tourFindATabFootage.json";
import { CaptionCue, Desktop, type TourSceneProps } from "../common";
import { END_VIEW } from "./Scene04OrganiseTabs";

// Scene 6: "Find a tab". Real footage from record-tour-find-a-tab.ts. It starts on scene 5's
// last frame (same centred 1.55x popup, no drawn windows, no camera move). The search field is
// clicked, "slack" is typed, the results show the matching tabs with the group they live in
// (Work, where scene 4 moved the Slack tab), and the Slack result is clicked: the popup switches
// to Work and the query clears. The scene ends on Work at scene 5's framing.

export const SCENE_ID = "find-a-tab";

type Theme = "light" | "dark";
type Footage = { frames: Record<string, number>; events: Record<string, Record<string, number>> };
const data = footage as Footage;
/** Light data may not be recorded yet: fall back to dark (numbers and frame images) so the scene never crashes. */
const dataTheme = (theme: Theme): Theme => (data.frames[theme] ? theme : "dark");
const framesOf = (theme: Theme) => data.frames[dataTheme(theme)];

/** Footage plays at its recorded speed (typing at scene 3's pace); every action plays in full. */
const FOOTAGE_SPEED = 1;

const toScene = (footageFrame: number) => (footageFrame - 1) / FOOTAGE_SPEED;
const evOf = (theme: Theme) => data.events[dataTheme(theme)];

// Highlight on the found row ("Find your workspace | Slack" in Work, second window), drawn once the
// Work view has settled. Row rect in popup CSS px, measured from the pixels of the last footage frame
// (f-0167.jpg, 1600x1200 = 2x): ink bounding box of favicon-to-URL x 576-1301, y 670-697 raw, so
// css x 288-650.5, y 335-348.5, plus 5px padding on each side (still inside the 24px row pitch).
const ROW_CSS = { x: 283, y: 330, w: 372.5, h: 23.5 };
const RING_COLOR = "#0ea5e9";
const RING_STROKE = 3;
const PULSE_FRAMES = 15;
const PULSES = 3;
const RING_FRAMES = PULSE_FRAMES * PULSES; // 1.5s
const RING_FADE = 8;
const SETTLE_FRAMES = 6; // after the overlay has closed, so the row is on screen
const ringStart = (theme: Theme) => toScene(evOf(theme).overlayClosed) + SETTLE_FRAMES;
/** The last footage frame is held until the highlight has finished. */
export const SCENE_06_FRAMES =
    Math.ceil(Math.max(...(["dark"] as Theme[]).flatMap((t) => [(framesOf(t) - 1) / FOOTAGE_SPEED, ringStart(t) + RING_FRAMES]))) + 1;

export const SCENE_06_CAPTION: CaptionCue[] = [{ from: 0, text: "Find any tab, in any group." }];

const pad = (n: number) => String(n).padStart(4, "0");

export function Scene06FindATab({ theme = "dark" }: TourSceneProps) {
    const frame = useCurrentFrame();
    const index = Math.min(framesOf(theme), 1 + Math.floor(frame * FOOTAGE_SPEED));
    const t = frame - ringStart(theme);
    const on = t >= 0 && t < RING_FRAMES;
    const base = on ? Math.min(1, t / 4) * (1 - Math.min(1, Math.max(0, (t - (RING_FRAMES - RING_FADE)) / RING_FADE))) : 0;
    const phase = on ? (t % PULSE_FRAMES) / PULSE_FRAMES : 0;
    const grow = Easing.out(Easing.cubic)(phase) * 10; // canvas px
    const ping = on ? (1 - phase) * base : 0;
    const box = {
        x: END_VIEW.left + ROW_CSS.x * END_VIEW.scale,
        y: END_VIEW.top + ROW_CSS.y * END_VIEW.scale,
        w: ROW_CSS.w * END_VIEW.scale,
        h: ROW_CSS.h * END_VIEW.scale,
    };
    return (
        <Desktop theme={theme}>
            <div
                style={{
                    position: "absolute",
                    left: END_VIEW.left,
                    top: END_VIEW.top,
                    width: 800,
                    height: 600,
                    transform: `scale(${END_VIEW.scale})`,
                    transformOrigin: "0 0",
                    boxShadow: "0 30px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(128,128,128,0.35)",
                    zIndex: 200,
                }}
            >
                <Img src={staticFile(`tour/frames/${dataTheme(theme)}/find-a-tab/f-${pad(index)}.jpg`)} style={{ width: 800, height: 600, display: "block", objectFit: "fill" }} />
            </div>
            {on && (
                <svg width="1920" height="1080" style={{ position: "absolute", left: 0, top: 0, zIndex: 300, pointerEvents: "none" }}>
                    <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={8} fill={RING_COLOR} fillOpacity={0.1 * base} stroke={RING_COLOR} strokeWidth={RING_STROKE} opacity={0.9 * base} />
                    <rect x={box.x - grow} y={box.y - grow} width={box.w + 2 * grow} height={box.h + 2 * grow} rx={8 + grow} fill="none" stroke={RING_COLOR} strokeWidth={RING_STROKE} opacity={0.85 * ping} />
                </svg>
            )}
        </Desktop>
    );
}
