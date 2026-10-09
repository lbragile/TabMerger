import React from "react";
import { AbsoluteFill, Easing, Img, Sequence, staticFile, useCurrentFrame } from "remotion";
import footage from "../../../lib/tourWindowFootage.json";
import { POPUP_CARDS } from "../../../lib/tourPopup";
import { BrowserWindow } from "../BrowserWindow";
import { CaptionCue, Desktop, type TourSceneProps } from "../common";
import { openWindowsAfter } from "../openWindows";
import { MESS_END_ACTIVE, MESS_LAYOUT, SCENE_01_FRAMES } from "./Scene01TheMess";
import {
    BADGE_INSET,
    NumberBadge,
    PAIR_COLORS,
    POPUP,
    SCENE_02_FRAMES,
    SETTLED,
    Scene02OpenTabMerger,
    WINDOWS,
    WINDOW_SCALE,
    driftAt,
    ease,
    ramp,
} from "./Scene02OpenTabMerger";

// Scene 3 — "Drag a window into a new group": the first Now Open window card is
// dragged onto "Drop for a new group" (real drag, recorded sharp by
// record-tour-window.ts). TabMerger lives in the third window (scene 2 opened it
// there), so the dragged first window really closes completely right after the
// drop; the recorder polls the browser for that moment and the drawn window 1
// closes at the same frame. A "Saved and closed" tag marks where it was. The new
// "temp group" is then renamed "Q4 Launch" and coloured pink, and TabMerger stays
// open on that group for the next scene.

export const SCENE_ID = "drag-to-new-group";

/** Frame at which scene 2's last frame has faded out and the camera starts moving; footage starts playing here. */
const START = 12;
/** Footage is played this much faster than recorded; every recorded action still plays in full. */
const FOOTAGE_SPEED = 1.25;
const FRAMES = Math.max(footage.frames.dark, footage.frames.light);
export const SCENE_03_FRAMES = Math.ceil(START + (FRAMES - 1) / FOOTAGE_SPEED);

type Theme = "light" | "dark";
const toScene = (footageFrame: number) => START + (footageFrame - 1) / FOOTAGE_SPEED;
const minOver = (pick: (theme: Theme) => number) => Math.min(pick("dark"), pick("light"));
const ev = (theme: Theme) => footage.events[theme] as Record<string, number>;

// Caption changes use theme-independent frames (the earlier of the two recordings).
export const SCENE_03_CAPTION: CaptionCue[] = [
    { from: 0, text: "Drag a window into a new group." },
    { from: Math.round(toScene(minOver((t) => ev(t).drop))), text: "Saved. The window closes." },
    { from: Math.round(toScene(minOver((t) => ev(t).renameText))) - 8, text: "Name it. Color it." },
];

// Camera on the popup: css point FOCUS stays under canvas point C while the popup scales 1x -> CAMERA_SCALE.
// The source frames are 1600x1200 (2x), so any scale up to 2 is pixel-sharp.
const FOCUS = { x: 120, y: 200 };
const CAMERA_SCALE = 1.5;
const CAMERA_END = { x: 760, y: 340 };
const CAMERA_FRAMES = 32;

// Drawn windows. Window 1 (blue "1", the one that is dragged) is enlarged while it is in play;
// the others sit at the back, dimmed, and come up a little once window 1 is gone.
const DRAGGED = 0;
const LIT_SCALE = 0.48;
const LIT_POS = { x: 46, y: 110 };
const BACK_SEAT = [LIT_POS, { x: 44, y: 300 }, { x: 68, y: 490 }];
const BACK_SEAT_SCALE = 0.34;
const BACK_SEAT_OPACITY = 0.5;
const AFTER_OPACITY = 0.9;
const CLOSE_FRAMES = 7;
const TAG_FRAMES = 45; // the "Saved and closed" tag stays about 1.5s
const TAG_FADE = 10;

const pad = (n: number) => String(n).padStart(4, "0");
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function Scene03DragToNewGroup({ theme = "dark" }: TourSceneProps) {
    const frame = useCurrentFrame();
    const e = ev(theme);
    const frames = footage.frames[theme];
    const open = openWindowsAfter("open-tabmerger"); // windows open when this scene starts
    const stays = openWindowsAfter(SCENE_ID);

    // --- the moments the scene syncs to (scene frames, measured in the real browser) ----------
    const pickupS = toScene(e.pickup);
    const closeS = toScene(e.windowClosed); // the real dragged window is completely gone

    // --- popup camera ---------------------------------------------------------
    const move = ramp(frame, START, CAMERA_FRAMES, ease);
    const scale = mix(1, CAMERA_SCALE, move);
    const anchor = { x: mix(POPUP.x + FOCUS.x, CAMERA_END.x, move), y: mix(POPUP.y + FOCUS.y, CAMERA_END.y, move) };
    const popupLeft = anchor.x - FOCUS.x * scale;
    const popupTop = anchor.y - FOCUS.y * scale;
    const index = Math.min(frames, 1 + Math.max(0, Math.floor((frame - START) * FOOTAGE_SPEED)));

    // --- drawn windows ----------------------------------------------------------
    const drift = (w: number) => driftAt(SCENE_01_FRAMES + SCENE_02_FRAMES + frame, w);
    const closing = ramp(frame, closeS, CLOSE_FRAMES, Easing.in(Easing.cubic));
    const after = ramp(frame, closeS, 20);
    const windows = MESS_LAYOUT.map((layout, w) => {
        const isDragged = w === DRAGGED;
        const rest = { x: SETTLED[w].x, y: SETTLED[w].y + drift(w) * 0.6, scale: WINDOW_SCALE, opacity: 1 };
        const seat = {
            x: BACK_SEAT[w].x,
            y: BACK_SEAT[w].y + drift(w) * 0.4,
            scale: isDragged ? LIT_SCALE : BACK_SEAT_SCALE,
            opacity: isDragged ? 1 : BACK_SEAT_OPACITY,
        };
        const x = mix(rest.x, seat.x, move);
        const y = mix(rest.y, seat.y, move);
        const s = mix(rest.scale, seat.scale, move);
        let opacity = mix(rest.opacity, seat.opacity, move);
        if (!isDragged) opacity = mix(opacity, AFTER_OPACITY, after);
        // The window that closes shrinks about its centre and vanishes, like a real window closing.
        const close = open[w] && !stays[w] ? closing : 0;
        const shrink = 1 - 0.12 * close;
        const w0 = layout.width * s;
        const h0 = layout.height * s;
        return {
            visible: open[w] && !(!stays[w] && closing >= 1),
            x: x + (w0 * (1 - shrink)) / 2,
            y: y + (h0 * (1 - shrink)) / 2,
            scale: s * shrink,
            opacity: opacity * (1 - close),
            close,
            width: layout.width,
            height: layout.height,
        };
    });
    const dragged = windows[DRAGGED];

    // --- blue "1" identity: on the drawn window, and on its card until it is picked up ----------
    const blue = PAIR_COLORS[DRAGGED];
    const cardCss = POPUP_CARDS[0];
    const card = {
        x: popupLeft + cardCss.x * scale,
        y: popupTop + cardCss.y * scale,
        width: cardCss.width * scale,
        height: cardCss.height * scale,
    };
    const marksIn = ramp(frame, 0, START);
    const cardMarks = marksIn * (1 - ramp(frame, pickupS - 5, 4));
    const windowMarks = marksIn * (1 - dragged.close);

    // --- "Saved and closed" tag where window 1 was (video only; clear of the popup and the caption) ----
    const tagIn = ramp(frame, closeS + 2, 8);
    const tagOut = 1 - ramp(frame, closeS + TAG_FRAMES, TAG_FADE);
    const tagOpacity = tagIn * tagOut;
    const tagCentre = { x: LIT_POS.x + (MESS_LAYOUT[DRAGGED].width * LIT_SCALE) / 2, y: LIT_POS.y + 150 };

    return (
        <Desktop theme={theme}>
            {windows.map((g, w) =>
                g.visible ? (
                    <BrowserWindow
                        key={w}
                        tabs={WINDOWS[w]}
                        activeIndex={MESS_END_ACTIVE[w]}
                        theme={theme}
                        width={g.width}
                        height={g.height}
                        scale={g.scale}
                        origin="0 0"
                        toolbarIcon={{ src: "logo.png", pressed: 0 }}
                        style={{ left: g.x, top: g.y, zIndex: w === DRAGGED ? 100 : w * 10, opacity: g.opacity }}
                    />
                ) : null,
            )}

            {dragged.visible && (
                <>
                    <div
                        style={{
                            position: "absolute",
                            left: dragged.x,
                            top: dragged.y,
                            width: dragged.width * dragged.scale,
                            height: dragged.height * dragged.scale,
                            borderRadius: 12 * dragged.scale,
                            boxSizing: "border-box",
                            border: `${5 * windowMarks}px solid ${blue}`,
                            opacity: windowMarks,
                            zIndex: 105,
                        }}
                    />
                    <div style={{ position: "absolute", inset: 0, zIndex: 106, pointerEvents: "none" }}>
                        <NumberBadge n={1} color={blue} x={dragged.x - BADGE_INSET} y={dragged.y - BADGE_INSET} opacity={windowMarks} />
                    </div>
                </>
            )}

            {tagOpacity > 0.01 && (
                <div
                    style={{
                        position: "absolute",
                        left: tagCentre.x,
                        top: tagCentre.y,
                        transform: `translate(-50%, -50%) scale(${0.9 + 0.1 * tagIn})`,
                        opacity: tagOpacity,
                        zIndex: 150,
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        padding: "14px 26px",
                        borderRadius: 40,
                        background: blue,
                        color: "white",
                        fontFamily: "sans-serif",
                        fontWeight: 700,
                        fontSize: 30,
                        boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
                        whiteSpace: "nowrap",
                    }}
                >
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 12.5l5 5L20 6.5" />
                    </svg>
                    Saved and closed
                </div>
            )}

            <div
                style={{
                    position: "absolute",
                    left: popupLeft,
                    top: popupTop,
                    width: 800,
                    height: 600,
                    transform: `scale(${scale})`,
                    transformOrigin: "0 0",
                    boxShadow: "0 30px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(128,128,128,0.35)",
                    zIndex: 200,
                }}
            >
                <Img
                    src={staticFile(`tour/frames/${theme}/window/f-${pad(index)}.jpg`)}
                    style={{ width: 800, height: 600, display: "block", objectFit: "fill" }}
                />
            </div>

            {/* The card's blue outline and badge, gone before the pick-up so they never sit on the drag visuals */}
            {cardMarks > 0.01 && (
                <>
                    <svg width="1920" height="1080" style={{ position: "absolute", left: 0, top: 0, zIndex: 300, pointerEvents: "none" }}>
                        <rect
                            x={card.x - 3}
                            y={card.y - 3}
                            width={card.width + 6}
                            height={card.height + 6}
                            rx={4}
                            fill={blue}
                            fillOpacity={0.12}
                            stroke={blue}
                            strokeWidth={4}
                            opacity={cardMarks}
                        />
                    </svg>
                    <div style={{ position: "absolute", inset: 0, zIndex: 310, pointerEvents: "none" }}>
                        <NumberBadge n={1} color={blue} x={card.x - BADGE_INSET} y={card.y - BADGE_INSET} opacity={cardMarks} />
                    </div>
                </>
            )}

            {/* Scene 2's final frame, fading away: takes the other pairs' outlines and connectors with it. */}
            <Sequence from={-SCENE_02_FRAMES} durationInFrames={SCENE_02_FRAMES + START}>
                <AbsoluteFill style={{ opacity: 1 - ramp(frame, 0, START, Easing.linear), zIndex: 1000 }}>
                    <Scene02OpenTabMerger theme={theme} />
                </AbsoluteFill>
            </Sequence>
        </Desktop>
    );
}
