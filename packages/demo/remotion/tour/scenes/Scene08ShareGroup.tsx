import React from "react";
import { Easing, Img, staticFile, useCurrentFrame } from "remotion";
import footage from "../../../lib/tourShareGroupFootage.json";
import { getChaosWindows } from "../../../lib/chaosWindows";
import { BrowserWindow } from "../BrowserWindow";
import { CaptionCue, Desktop, type TourSceneProps } from "../common";
import { ease, ramp } from "./Scene02OpenTabMerger";
import { END_VIEW } from "./Scene04OrganiseTabs";
import { RESTORED_WINDOWS, RESTORED_WINDOW_SIZE, RESTORE_POPUP } from "./Scene07RestoreGroup";

// Scene 8: "Share a group" (Pro). Real footage from record-tour-share-group.ts, recorded against
// the local Supabase stack with a throwaway Pro user. It starts on the last frame of scene 7 (popup
// at RESTORE_POPUP, the two restored windows drawn on the right); the windows fade out in the first
// frames and the popup eases back to the centred 1.55x framing of scenes 4 to 6. The flow is the
// product's own: selection mode, tick Q4 Launch, the selection bar's Share, and its "Link copied to
// clipboard" toast. The restored windows are still open in the story but are not drawn from here on.
// The footage's header shows the signed-in avatar (the one visible difference at the cut).

export const SCENE_ID = "share-group";

type Theme = "light" | "dark";
type Footage = { frames: Record<string, number>; events: Record<string, Record<string, number>> };
const data = footage as Footage;
/** Light data may not be recorded yet: fall back to dark (numbers and frame images) so the scene never crashes. */
const dataTheme = (theme: Theme): Theme => (data.frames[theme] ? theme : "dark");
const framesOf = (theme: Theme) => data.frames[dataTheme(theme)];
const evOf = (theme: Theme) => data.events[dataTheme(theme)];

/** Footage is played this much faster than recorded; every recorded action still plays in full. */
const FOOTAGE_SPEED = 1.5;
export const SCENE_08_FRAMES = Math.ceil((framesOf("dark") - 1) / FOOTAGE_SPEED) + 1;
const toScene = (footageFrame: number) => (footageFrame - 1) / FOOTAGE_SPEED;

export const SCENE_08_CAPTION: CaptionCue[] = [
    { from: 0, text: "Share a group with a link." },
    { from: Math.round(toScene(evOf("dark").toastShown)) - 4, text: "Link copied. Send it to anyone." },
];

const FADE_FRAMES = 12; // the restored drawn windows fade out
const MOVE_FRAMES = 24; // the popup eases back to the centred framing
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const pad = (n: number) => String(n).padStart(4, "0");

export function Scene08ShareGroup({ theme = "dark" }: TourSceneProps) {
    const frame = useCurrentFrame();
    const frames = framesOf(theme);
    const chaos = getChaosWindows()[0];
    const tabs = [[chaos[0], chaos[3]], [chaos[4]]];

    const move = ramp(frame, 0, MOVE_FRAMES, ease);
    const left = mix(RESTORE_POPUP.left, END_VIEW.left, move);
    const top = mix(RESTORE_POPUP.top, END_VIEW.top, move);
    const scale = mix(RESTORE_POPUP.scale, END_VIEW.scale, move);
    const windowsOpacity = 1 - ramp(frame, 0, FADE_FRAMES, Easing.linear);
    const index = Math.min(frames, 1 + Math.floor(frame * FOOTAGE_SPEED));

    return (
        <Desktop theme={theme}>
            {windowsOpacity > 0.001 &&
                RESTORED_WINDOWS.map((w, i) => (
                    <BrowserWindow
                        key={i}
                        tabs={tabs[i]}
                        activeIndex={tabs[i].length - 1}
                        theme={theme}
                        width={RESTORED_WINDOW_SIZE.width}
                        height={RESTORED_WINDOW_SIZE.height}
                        scale={w.scale}
                        origin="0 0"
                        toolbarIcon={{ src: "logo.png", pressed: 0 }}
                        style={{ left: w.x, top: w.y, zIndex: 100 + i * 10, opacity: windowsOpacity }}
                    />
                ))}
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
                <Img src={staticFile(`tour/frames/${dataTheme(theme)}/share-group/f-${pad(index)}.jpg`)} style={{ width: 800, height: 600, display: "block", objectFit: "fill" }} />
            </div>
        </Desktop>
    );
}
