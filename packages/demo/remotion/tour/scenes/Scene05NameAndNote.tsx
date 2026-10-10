import React from "react";
import { Easing, Img, staticFile, useCurrentFrame } from "remotion";
import footage from "../../../lib/tourNameAndNoteFootage.json";
import { CaptionCue, Desktop, type TourSceneProps } from "../common";
import { END_VIEW } from "./Scene04OrganiseTabs";

// Scene 5: "Rename and annotate". Real footage from record-tour-name-and-note.ts. It
// starts on scene 4's last frame (same popup framing, no drawn windows). Beat A
// renames the second window of Q4 Launch to "Assets"; beat B adds a note to the
// GitHub tab, which then shows as a small note icon on its row. No drawn browser
// windows and no camera move: the popup stays where scene 4 left it.

export const SCENE_ID = "name-and-note";

type Theme = "light" | "dark";
type Footage = { frames: Record<string, number>; events: Record<string, Record<string, number>> };
const data = footage as Footage;
/** Light data may not be recorded yet: fall back to dark (numbers and frame images) so the scene never crashes. */
const dataTheme = (theme: Theme): Theme => (data.frames[theme] ? theme : "dark");
const framesOf = (theme: Theme) => data.frames[dataTheme(theme)];
const evOf = (theme: Theme) => data.events[dataTheme(theme)];

/** Footage is played this much faster than recorded; every recorded action still plays in full. */
const FOOTAGE_SPEED = 1.3;
const toScene = (footageFrame: number) => (footageFrame - 1) / FOOTAGE_SPEED;


export const SCENE_05_CAPTION: CaptionCue[] = [
    { from: 0, text: "Name your windows." },
    { from: Math.round(toScene(evOf("dark").noteMenuOpen)) - 14, text: "Leave a note for later." },
];

// The note icon's tooltip only says "Edit note" (not the text), so a pulsing ring around the saved
// icon draws the eye to it instead. Synced to the measured frame the icon appeared (`noteSaved`).
// Icon centre in popup CSS px: measured from the pixels of the last footage frame (1600x1200 = 2x,
// icon bbox x 1472-1491, y 330-349 -> centre 1481.5, 339.5 -> 740.75, 169.75 css), mapped through END_VIEW.
const NOTE_ICON_CSS = { x: 740.75, y: 169.75 };
const RING_COLOR = "#0ea5e9";
const RING_R = 17; // canvas px, a little larger than the icon (about 16px across)
const RING_STROKE = 3;
const PULSE_FRAMES = 15;
const PULSES = 3;
const RING_FRAMES = PULSE_FRAMES * PULSES; // 1.5s
const RING_FADE = 8;
const ringStart = (theme: Theme) => toScene(evOf(theme).noteSaved) + 1;
/** The footage's last frame is held if the ring would otherwise be cut off. */
export const SCENE_05_FRAMES = Math.ceil(
    Math.max(...(["dark"] as Theme[]).flatMap((t) => [(framesOf(t) - 1) / FOOTAGE_SPEED, ringStart(t) + RING_FRAMES])),
) + 1;

const pad = (n: number) => String(n).padStart(4, "0");

export function Scene05NameAndNote({ theme = "dark" }: TourSceneProps) {
    const frame = useCurrentFrame();
    const index = Math.min(framesOf(theme), 1 + Math.floor(frame * FOOTAGE_SPEED));
    const t = frame - ringStart(theme);
    const ringOn = t >= 0 && t < RING_FRAMES;
    const base = ringOn ? Math.min(1, t / 4) * (1 - Math.min(1, Math.max(0, (t - (RING_FRAMES - RING_FADE)) / RING_FADE))) : 0;
    const phase = ringOn ? (t % PULSE_FRAMES) / PULSE_FRAMES : 0;
    const ping = ringOn ? (1 - phase) * base : 0;
    const centre = { x: END_VIEW.left + NOTE_ICON_CSS.x * END_VIEW.scale, y: END_VIEW.top + NOTE_ICON_CSS.y * END_VIEW.scale };
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
                <Img src={staticFile(`tour/frames/${dataTheme(theme)}/name-and-note/f-${pad(index)}.jpg`)} style={{ width: 800, height: 600, display: "block", objectFit: "fill" }} />
            </div>
            {ringOn && (
                <svg width="1920" height="1080" style={{ position: "absolute", left: 0, top: 0, zIndex: 300, pointerEvents: "none" }}>
                    <circle cx={centre.x} cy={centre.y} r={RING_R} fill="none" stroke={RING_COLOR} strokeWidth={RING_STROKE} opacity={0.9 * base} />
                    <circle cx={centre.x} cy={centre.y} r={RING_R + RING_R * Easing.out(Easing.cubic)(phase)} fill="none" stroke={RING_COLOR} strokeWidth={RING_STROKE} opacity={0.85 * ping} />
                </svg>
            )}
        </Desktop>
    );
}
