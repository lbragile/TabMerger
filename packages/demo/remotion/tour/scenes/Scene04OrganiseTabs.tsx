import React from "react";
import { AbsoluteFill, Easing, Img, Sequence, staticFile, useCurrentFrame } from "remotion";
import footage from "../../../lib/tourOrganiseTabsFootage.json";
import { CaptionCue, Desktop, type TourSceneProps } from "../common";
import { SCENE_03_FRAMES, Scene03DragToNewGroup } from "./Scene03DragToNewGroup";
import { ease, ramp } from "./Scene02OpenTabMerger";

// Scene 4: "Organise by dragging". Real footage from record-tour-organise-tabs.ts: it
// replays scene 3 unrecorded (so the first frame is scene 3's last frame), then
// beat A drags one tab (Dropbox) onto the real "new window" target, and beat B
// Ctrl-clicks two tabs (Google Calendar, Slack) and drags them together onto the
// Work sidebar row. Saved-group work only, so the drawn browser windows fade out
// in the first frames and never come back; the popup eases to a centred, larger
// framing. Open drawn windows are unchanged by this scene (openWindows.ts).

export const SCENE_ID = "organise-tabs";

type Theme = "light" | "dark";
type Footage = { frames: Record<string, number>; events: Record<string, Record<string, number>> };
const data = footage as Footage;
/** Light data may not be recorded yet: fall back to dark (numbers and frame images) so the scene never crashes. */
const dataTheme = (theme: Theme): Theme => (data.frames[theme] ? theme : "dark");
const framesOf = (theme: Theme) => data.frames[dataTheme(theme)];
const evOf = (theme: Theme) => data.events[dataTheme(theme)];

/** Scene frame at which the footage starts playing (the camera is already moving). */
const START = 4;
/** Footage is played this much faster than recorded; every recorded action still plays in full. */
const FOOTAGE_SPEED = 1.5;
// Both themes share the dark (accepted) duration; light footage that runs longer only loses idle end frames.
export const SCENE_04_FRAMES = Math.ceil(START + (framesOf("dark") - 1) / FOOTAGE_SPEED);

const toScene = (footageFrame: number) => START + (footageFrame - 1) / FOOTAGE_SPEED;

// Caption changes use the dark recording's moments (the same story in both themes).
export const SCENE_04_CAPTION: CaptionCue[] = [
    { from: 0, text: "Drag a tab into its own window." },
    { from: Math.round(toScene(evOf("dark").selectCalendar)) - 14, text: "Select several. Move them together." },
];

// The popup: scene 3 ends with it at 1.5x, top-left at (580, 40). It eases to a centred 1.55x
// (1240x930: sharp, the frames are 1600x1200) that stays clear of the caption bar (top at ~958).
const START_VIEW = { left: 580, top: 40, scale: 1.5 };
const END_SCALE = 1.55;
export const END_VIEW = { left: (1920 - 800 * END_SCALE) / 2, top: 16, scale: END_SCALE };
const CAMERA_FRAMES = 26;
/** Frames in which scene 3's drawn windows fade away. */
const WINDOWS_FADE_FRAMES = 12;
/** Scene 3's drawn windows all sit left of this x (the popup starts at 580 and never moves left of it in scene 3). */
const WINDOWS_CLIP_RIGHT = 1920 - 575;

const pad = (n: number) => String(n).padStart(4, "0");
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function Scene04OrganiseTabs({ theme = "dark" }: TourSceneProps) {
    const frame = useCurrentFrame();
    const frames = framesOf(theme);
    const dir = dataTheme(theme);

    const move = ramp(frame, 0, CAMERA_FRAMES, ease);
    const left = mix(START_VIEW.left, END_VIEW.left, move);
    const top = mix(START_VIEW.top, END_VIEW.top, move);
    const scale = mix(START_VIEW.scale, END_VIEW.scale, move);
    const index = Math.min(frames, 1 + Math.max(0, Math.floor((frame - START) * FOOTAGE_SPEED)));

    return (
        <Desktop theme={theme}>
            {/* Scene 3's last frame, left of the popup only (its drawn windows), fading out. Beneath the popup, which moves over it. */}
            <Sequence from={-(SCENE_03_FRAMES - 1)} durationInFrames={SCENE_03_FRAMES - 1 + WINDOWS_FADE_FRAMES}>
                <AbsoluteFill
                    style={{
                        opacity: 1 - ramp(frame, 0, WINDOWS_FADE_FRAMES, Easing.linear),
                        clipPath: `inset(0px ${WINDOWS_CLIP_RIGHT}px 0px 0px)`,
                        zIndex: 150,
                    }}
                >
                    <Scene03DragToNewGroup theme={theme} />
                </AbsoluteFill>
            </Sequence>

            <div
                style={{
                    position: "absolute",
                    left,
                    top,
                    width: 800,
                    height: 600,
                    transform: `scale(${scale})`,
                    transformOrigin: "0 0",
                    boxShadow: "0 30px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(128,128,128,0.35)",
                    zIndex: 200,
                }}
            >
                <Img src={staticFile(`tour/frames/${dir}/organise-tabs/f-${pad(index)}.jpg`)} style={{ width: 800, height: 600, display: "block", objectFit: "fill" }} />
            </div>
        </Desktop>
    );
}
