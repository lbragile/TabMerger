import React from "react";
import { Easing, Img, staticFile, useCurrentFrame } from "remotion";
import footage from "../../../lib/tourAiSortFootage.json";
import syncFootage from "../../../lib/tourSyncDevicesFootage.json";
import { THEME_COLORS } from "../../Composition";
import { CaptionCue, Desktop, type TourSceneProps } from "../common";
import { ease, ramp } from "./Scene02OpenTabMerger";
import { END_VIEW } from "./Scene04OrganiseTabs";
import { SCENE_09_FRAMES, SYNC_POPUP_A, SYNC_POPUP_B, SYNC_SCALE } from "./Scene09SyncDevices";

// Scene 10: "Pro AI auto-group" (Pro AI). Real footage from record-tour-ai-sort.ts, recorded against
// the local Supabase stack with a throwaway Pro AI user and the web app's local AI mock (one group per
// site; see the README). It starts on scene 9's last frame (two popups): device B fades out and A eases
// back to the centred 1.55x framing of scenes 4 to 8. Then the footage plays: the header's AI menu opens,
// Auto-group is clicked, the groups appear with the extension's own "AI created N groups" toast, and the
// first new group is opened. The closing card (Scene11ClosingCard) follows it.

export const SCENE_ID = "ai-sort";

type Theme = "light" | "dark";
type Footage = { frames: Record<string, number>; events: Record<string, Record<string, number>> };
const data = footage as Footage;
/** Light data may not be recorded yet: fall back to dark (numbers and frame images) so the scene never crashes. */
const dataTheme = (theme: Theme): Theme => (data.frames[theme] ? theme : "dark");
const framesOf = (theme: Theme) => data.frames[dataTheme(theme)];
const evOf = (theme: Theme) => data.events[dataTheme(theme)];

const MOVE_FRAMES = 26; // B fades out and A eases back to the centred framing
const B_FADE_FRAMES = 14;
/** The footage holds its first frame until the move is done, then plays at this speed (every action still plays in full). */
const HEAD_FRAMES = MOVE_FRAMES;
const FOOTAGE_SPEED = 1.15;
export const SCENE_AI_FRAMES = HEAD_FRAMES + Math.ceil((framesOf("dark") - 1) / FOOTAGE_SPEED) + 1;
const toScene = (footageFrame: number) => HEAD_FRAMES + (footageFrame - 1) / FOOTAGE_SPEED;

export const SCENE_AI_CAPTION: CaptionCue[] = [
    { from: 0, text: "Pro AI: one click, sorted." },
    { from: Math.round(toScene(evOf("dark").groupsShown)) + 2, text: "Your open tabs, grouped and named." },
];

const LABELS = [
    { letter: "A", text: "This computer", left: SYNC_POPUP_A.left },
    { letter: "B", text: "Your other computer", left: SYNC_POPUP_B.left },
];

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const pad = (n: number) => String(n).padStart(4, "0");

const popupBox = (left: number, top: number, scale: number, opacity = 1): React.CSSProperties => ({
    position: "absolute",
    left,
    top,
    width: 800,
    height: 600,
    transform: `scale(${scale})`,
    transformOrigin: "0 0",
    boxShadow: "0 30px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(128,128,128,0.35)",
    opacity,
    zIndex: 200,
});

export function Scene10AiSort({ theme = "dark" }: TourSceneProps) {
    const frame = useCurrentFrame();
    const dir = dataTheme(theme);
    const frames = framesOf(theme);

    const move = ramp(frame, 0, MOVE_FRAMES, ease);
    const left = mix(SYNC_POPUP_A.left, END_VIEW.left, move);
    const top = mix(SYNC_POPUP_A.top, END_VIEW.top, move);
    const scale = mix(SYNC_SCALE, END_VIEW.scale, move);
    const bOpacity = 1 - ramp(frame, 0, B_FADE_FRAMES, Easing.linear);
    const index = Math.min(frames, 1 + Math.max(0, Math.floor((frame - HEAD_FRAMES) * FOOTAGE_SPEED)));

    // Device B as scene 9 ended (its last drawn frame), fading out.
    const sync = syncFootage as { frames: Record<string, number>; framesB: Record<string, number>; bOffset: Record<string, number> };
    const sDir: Theme = sync.frames[theme] ? theme : "dark";
    const bFrame = Math.max(1, Math.min(sync.framesB[sDir], 1 + (SCENE_09_FRAMES - 1) - (sync.bOffset[sDir] ?? 0)));

    return (
        <Desktop theme={theme}>
            {bOpacity > 0.001 && (
                <div style={popupBox(SYNC_POPUP_B.left, SYNC_POPUP_B.top, SYNC_SCALE, bOpacity)}>
                    <Img src={staticFile(`tour/frames/${sDir}/sync-devices/b/f-${pad(bFrame)}.jpg`)} style={{ width: 800, height: 600, display: "block", objectFit: "fill" }} />
                </div>
            )}
            {bOpacity > 0.001 &&
                LABELS.map(({ letter, text, left: x }) => (
                    <div key={text} style={{ position: "absolute", left: x, top: SYNC_POPUP_A.top - 64, width: 800 * SYNC_SCALE, display: "flex", alignItems: "center", justifyContent: "center", gap: 12, opacity: bOpacity, zIndex: 300 }}>
                        <div style={{ width: 40, height: 40, borderRadius: 20, background: "#0ea5e9", color: "white", fontFamily: "sans-serif", fontWeight: 800, fontSize: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>{letter}</div>
                        <div style={{ color: THEME_COLORS[theme].text, fontFamily: "sans-serif", fontWeight: 600, fontSize: 28, lineHeight: "40px" }}>{text}</div>
                    </div>
                ))}
            <div style={popupBox(left, top, scale)}>
                <Img src={staticFile(`tour/frames/${dir}/ai-sort/f-${pad(index)}.jpg`)} style={{ width: 800, height: 600, display: "block", objectFit: "fill" }} />
            </div>
        </Desktop>
    );
}
