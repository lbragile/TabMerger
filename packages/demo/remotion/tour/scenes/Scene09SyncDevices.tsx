import React from "react";
import { Img, staticFile, useCurrentFrame } from "remotion";
import footage from "../../../lib/tourSyncDevicesFootage.json";
import { THEME_COLORS } from "../../Composition";
import { CaptionCue, Desktop, type TourSceneProps } from "../common";
import { ease, ramp } from "./Scene02OpenTabMerger";
import { END_VIEW } from "./Scene04OrganiseTabs";

// Scene 9: "Sync across devices" (Pro). Real footage from record-tour-sync-devices.ts: device A is
// the demo profile every scene used, device B is a second plain browser profile signed in to the same
// (throwaway, local) account and unlocked with the same passphrase; B started with no groups at all and
// everything it shows came down through sync. Scene 8's last frame is the start (A centred at 1.55x);
// A eases smaller and to the left, B comes in on the right, and a small plain label above each popup says
// which computer it is. Nothing is clicked in this scene: a live change on A only reaches B at A's next
// 30 s sync poll (9 s in a probe), which is not a beat that can be held honestly.

export const SCENE_ID = "sync-devices";

type Theme = "light" | "dark";
type Footage = { frames: Record<string, number>; framesB: Record<string, number>; bOffset: Record<string, number> };
const data = footage as Footage;
/** Light data may not be recorded yet: fall back to dark (numbers and frame images) so the scene never crashes. */
const dataTheme = (theme: Theme): Theme => (data.frames[theme] ? theme : "dark");

export const SCENE_09_FRAMES = 120; // 4.0s: the move and arrival, then a hold on both popups
const MOVE_FRAMES = 26; // A eases smaller and to the left
const ARRIVE_AT = 12; // B starts coming in while A is still moving
const ARRIVE_FRAMES = 16;
const LABEL_AT = 20;
const LABEL_FRAMES = 14;

export const SCENE_09_CAPTION: CaptionCue[] = [{ from: 0, text: "Signed in on another computer? Your groups are already there." }];

// End framing (scene 10 starts from it): both popups at the same scale, a visible gap between them.
export const SYNC_SCALE = 1.08;
export const SYNC_POPUP_A = { left: 60, top: 110 };
export const SYNC_POPUP_B = { left: 996, top: 110 };
const LABELS = [
    { letter: "A", text: "This computer" },
    { letter: "B", text: "Your other computer" },
];
const BADGE_COLOR = "#0ea5e9"; // the sky blue of scenes 5 and 6; NumberBadge (scene 2) only renders numbers and is absolutely positioned, so the letter badge is local

const pad = (n: number) => String(n).padStart(4, "0");
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

const Popup = ({ left, top, scale, src, opacity = 1 }: { left: number; top: number; scale: number; src: string; opacity?: number }) => (
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
            opacity,
            zIndex: 200,
        }}
    >
        <Img src={src} style={{ width: 800, height: 600, display: "block", objectFit: "fill" }} />
    </div>
);

export function Scene09SyncDevices({ theme = "dark" }: TourSceneProps) {
    const frame = useCurrentFrame();
    const dir = dataTheme(theme);
    const framesA = data.frames[dir];
    const framesB = data.framesB[dir];
    const bOffset = data.bOffset[dir] ?? 0;

    const move = ramp(frame, 0, MOVE_FRAMES, ease);
    const aLeft = mix(END_VIEW.left, SYNC_POPUP_A.left, move);
    const aTop = mix(END_VIEW.top, SYNC_POPUP_A.top, move);
    const aScale = mix(END_VIEW.scale, SYNC_SCALE, move);
    const arrive = ramp(frame, ARRIVE_AT, ARRIVE_FRAMES, ease);
    const labels = ramp(frame, LABEL_AT, LABEL_FRAMES);

    const a = Math.min(framesA, 1 + frame);
    const b = Math.max(1, Math.min(framesB, 1 + frame - bOffset));
    const base = `tour/frames/${dir}/sync-devices`;
    const lefts = [SYNC_POPUP_A.left, SYNC_POPUP_B.left];

    return (
        <Desktop theme={theme}>
            <Popup left={aLeft} top={aTop} scale={aScale} src={staticFile(`${base}/a/f-${pad(a)}.jpg`)} />
            {arrive > 0 && (
                <Popup left={SYNC_POPUP_B.left + (1 - arrive) * 70} top={SYNC_POPUP_B.top} scale={SYNC_SCALE} src={staticFile(`${base}/b/f-${pad(b)}.jpg`)} opacity={arrive} />
            )}
            {labels > 0 &&
                LABELS.map(({ letter, text }, i) => (
                    <div
                        key={text}
                        style={{
                            position: "absolute",
                            left: lefts[i],
                            top: SYNC_POPUP_A.top - 64,
                            width: 800 * SYNC_SCALE,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 12,
                            opacity: labels,
                            zIndex: 300,
                        }}
                    >
                        <div
                            style={{
                                width: 40,
                                height: 40,
                                borderRadius: 20,
                                background: BADGE_COLOR,
                                color: "white",
                                fontFamily: "sans-serif",
                                fontWeight: 800,
                                fontSize: 24,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            {letter}
                        </div>
                        <div style={{ color: THEME_COLORS[theme].text, fontFamily: "sans-serif", fontWeight: 600, fontSize: 28, lineHeight: "40px" }}>{text}</div>
                    </div>
                ))}
        </Desktop>
    );
}
