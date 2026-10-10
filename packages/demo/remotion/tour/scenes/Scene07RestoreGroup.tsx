import React from "react";
import { Img, staticFile, useCurrentFrame } from "remotion";
import footage from "../../../lib/tourRestoreGroupFootage.json";
import { getChaosWindows } from "../../../lib/chaosWindows";
import { BrowserWindow } from "../BrowserWindow";
import { CaptionCue, Desktop, type TourSceneProps } from "../common";
import { restoredWindowsAfter } from "../openWindows";
import { ease, ramp } from "./Scene02OpenTabMerger";
import { END_VIEW } from "./Scene04OrganiseTabs";

// Scene 7: "Restore". Real footage from record-tour-restore-group.ts. It starts on the last
// frame of scene 6 (centred 1.55x popup). The popup eases to the left to make room, the Q4 Launch
// row is clicked, and each of its two saved windows is opened with its menu item "Open in browser".
// Each real window the extension creates is polled from the browser (chrome.windows) on the
// grabber clock, and the matching drawn window pops in at exactly that frame. Only the two
// restored windows are drawn (Yahoo Mail + GitHub, and "Assets" with Dropbox); the older chaos
// windows are still open in the story but are not shown.

export const SCENE_ID = "restore-group";

type Theme = "light" | "dark";
type Footage = { frames: Record<string, number>; events: Record<string, Record<string, number>> };
const data = footage as Footage;
/** Light data may not be recorded yet: fall back to dark (numbers and frame images) so the scene never crashes. */
const dataTheme = (theme: Theme): Theme => (data.frames[theme] ? theme : "dark");
const framesOf = (theme: Theme) => data.frames[dataTheme(theme)];
const evOf = (theme: Theme) => data.events[dataTheme(theme)];

/** Footage is played this much faster than recorded; every recorded action still plays in full. */
const FOOTAGE_SPEED = 1.4;
export const SCENE_07_FRAMES = Math.ceil((framesOf("dark") - 1) / FOOTAGE_SPEED) + 1;
const toScene = (footageFrame: number) => (footageFrame - 1) / FOOTAGE_SPEED;

export const SCENE_07_CAPTION: CaptionCue[] = [
    { from: 0, text: "Need it again? Open your windows." },
    { from: Math.round(toScene(evOf("dark").windowCreated0)) - 4, text: "Your windows are back." },
];

// End framing (scene 8 starts from it). Popup: top-left and scale on the 1920x1080 canvas.
export const RESTORE_POPUP = { left: 40, top: 70, scale: 1.2 };
/** The two restored drawn windows share this native size; each has its top-left and scale. */
export const RESTORED_WINDOW_SIZE = { width: 1000, height: 580 };
export const RESTORED_WINDOWS = [
    { x: 1090, y: 50, scale: 0.74 },
    { x: 1130, y: 500, scale: 0.74 },
];
const MOVE_FRAMES = 22; // the popup eases out of the centre while the pointer travels to Q4 Launch
const APPEAR_FRAMES = 10;

const pad = (n: number) => String(n).padStart(4, "0");
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function Scene07RestoreGroup({ theme = "dark" }: TourSceneProps) {
    const frame = useCurrentFrame();
    const e = evOf(theme);
    const frames = framesOf(theme);
    const restored = restoredWindowsAfter(SCENE_ID);
    const chaos = getChaosWindows()[0]; // Yahoo Mail, Calendar, Slack, GitHub, Dropbox (the group tabs came from here)
    const tabs = [
        [chaos[0], chaos[3]], // Yahoo Mail, GitHub (active: the real window shows github.com)
        [chaos[4]], // "Assets": Dropbox
    ];
    const created = [e.windowCreated0, e.windowCreated1].map(toScene);

    const move = ramp(frame, 0, MOVE_FRAMES, ease);
    const left = mix(END_VIEW.left, RESTORE_POPUP.left, move);
    const top = mix(END_VIEW.top, RESTORE_POPUP.top, move);
    const scale = mix(END_VIEW.scale, RESTORE_POPUP.scale, move);
    const index = Math.min(frames, 1 + Math.floor(frame * FOOTAGE_SPEED));

    return (
        <Desktop theme={theme}>
            {RESTORED_WINDOWS.map((w, i) => {
                const appear = ramp(frame, created[i], APPEAR_FRAMES);
                if (!restored[i] || appear <= 0) return null;
                return (
                    <BrowserWindow
                        key={i}
                        tabs={tabs[i]}
                        activeIndex={tabs[i].length - 1}
                        theme={theme}
                        width={RESTORED_WINDOW_SIZE.width}
                        height={RESTORED_WINDOW_SIZE.height}
                        appear={appear}
                        scale={w.scale}
                        origin="0 0"
                        toolbarIcon={{ src: "logo.png", pressed: 0 }}
                        style={{ left: w.x, top: w.y, zIndex: 100 + i * 10 }}
                    />
                );
            })}
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
                <Img src={staticFile(`tour/frames/${dataTheme(theme)}/restore-group/f-${pad(index)}.jpg`)} style={{ width: 800, height: 600, display: "block", objectFit: "fill" }} />
            </div>
        </Desktop>
    );
}
