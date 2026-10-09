import React from "react";
import { AbsoluteFill, Easing, Img, OffthreadVideo, interpolate, staticFile, useCurrentFrame } from "remotion";
import { getChaosWindows } from "../../../lib/chaosWindows";
import {
    POPUP_CARDS,
    TOUR_POPUP_SOURCE,
    TOUR_POPUP_STEP_ID,
    popupClipStartMs,
} from "../../../lib/tourPopup";
import { BrowserWindow, toolbarIconCenter } from "../BrowserWindow";
import { Desktop, TOUR_FPS, type TourSceneProps } from "../common";
import { MESS_END_ACTIVE, MESS_LAYOUT, SCENE_01_FRAMES } from "./Scene01TheMess";

// Scene 2 — "Open TabMerger": starts exactly where scene 1 ends, the three
// windows shrink aside, the front window's toolbar button is clicked, and the
// REAL popup footage (Now Open) opens next to them. Each drawn window is then
// paired with its card in turn (matching colour, number and a connector line)
// so "these three windows are these three cards" reads at a glance.

export const SCENE_02_FRAMES = Math.round(6.5 * TOUR_FPS);
export const SCENE_02_CAPTION = "Switch to TabMerger. Every tab, already here.";

export const WINDOWS = getChaosWindows();

// Scene 1's end state (see Scene01TheMess): active tabs, push-in scale/origin, drift.
const START_ACTIVE = MESS_END_ACTIVE;
const PUSH_END = 1.05;
const PUSH_ORIGIN = { x: 960, y: 1080 * 0.45 };
export const driftAt = (frame: number, w: number) => Math.sin((frame + w * 20) / 22) * 5;

// Windows after they make room, in canvas px (top-left origin). `scale` is the
// resting size, `focusScale` what a window grows to while paired with its card.
// The popup is shown at the footage's own 800x600 so it stays pixel-sharp.
// How far the two windows/cards that are NOT paired right now are dimmed (0..1).
const DIM_AMOUNT = 0.6;
export const WINDOW_SCALE = 0.6;
const FOCUS_SCALE = 0.74;
export const SETTLED = [
    { x: 30, y: 60 },
    { x: 110, y: 270 },
    { x: 180, y: 480 },
];
export const POPUP = { x: 1090, y: 170 };

// Badges hang off the top-left corner (centre this far outside it) so they never cover a tab icon.
export const BADGE_INSET = 14;

// One colour per window/card pair (not brand teal, so the pairs are told apart).
export const PAIR_COLORS = ["#3b82f6", "#f59e0b", "#10b981"];

// Timeline, in scene frames.
const GLIDE = [0, 36] as const;
const CURSOR_ARRIVES = 34;
const CLICK_AT = 40;
const POPUP_OPEN = [CLICK_AT, CLICK_AT + 20] as const;
const PAIR_FRAMES = 34;
const PAIRS_START = 64;
const ALL_AT = PAIRS_START + 3 * PAIR_FRAMES;

// z-index must be an integer: a window, then its own outline/badge just above it (+5).
const windowZ = (focus: number, w: number) => (focus > 0.05 ? 100 : w * 10);

export const ease = Easing.inOut(Easing.cubic);
const easeOut = Easing.out(Easing.cubic);
export const ramp = (frame: number, start: number, length: number, easing = easeOut) =>
    interpolate(frame, [start, start + length], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing,
    });

function Cursor({ x, y, opacity }: { x: number; y: number; opacity: number }) {
    return (
        <svg
            width="34"
            height="34"
            viewBox="0 0 24 24"
            style={{ position: "absolute", left: x - 4, top: y - 2, opacity, filter: "drop-shadow(0 3px 4px rgba(0,0,0,0.5))" }}
        >
            <path d="M5 3l14 8-6 1.8L9.5 19z" fill="white" stroke="#111" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
    );
}

export function NumberBadge({ n, color, x, y, opacity }: { n: number; color: string; x: number; y: number; opacity: number }) {
    return (
        <div
            style={{
                position: "absolute",
                left: x - 22,
                top: y - 22,
                width: 44,
                height: 44,
                borderRadius: 22,
                background: color,
                color: "white",
                fontFamily: "sans-serif",
                fontWeight: 800,
                fontSize: 26,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
                opacity,
            }}
        >
            {n}
        </div>
    );
}

export function Scene02OpenTabMerger({ theme = "dark" }: TourSceneProps) {
    const frame = useCurrentFrame();

    // --- window geometry -------------------------------------------------
    const glide = ramp(frame, GLIDE[0], GLIDE[1] - GLIDE[0], ease);
    // Continue scene 1's slow push-in shrinking back to 1x while the windows glide.
    const base = MESS_LAYOUT.map((layout, w) => {
        const drift = driftAt(SCENE_01_FRAMES + frame, w);
        const start = {
            x: PUSH_ORIGIN.x + (layout.x - PUSH_ORIGIN.x) * PUSH_END,
            y: PUSH_ORIGIN.y + (layout.y + drift - PUSH_ORIGIN.y) * PUSH_END,
            scale: PUSH_END,
        };
        // Pair focus (0..1): window grows toward FOCUS_SCALE while it is the selected one.
        const t0 = PAIRS_START + w * PAIR_FRAMES;
        const focus = ramp(frame, t0, 8) - ramp(frame, t0 + PAIR_FRAMES - 4, 8);
        const rest = {
            x: SETTLED[w].x,
            y: SETTLED[w].y + drift * 0.6,
            scale: WINDOW_SCALE + (FOCUS_SCALE - WINDOW_SCALE) * focus,
        };
        const g = (a: number, b: number) => a + (b - a) * glide;
        const geo = { x: g(start.x, rest.x), y: g(start.y, rest.y), scale: g(start.scale, rest.scale) };
        const all = ramp(frame, ALL_AT, 10);
        // Connector: drawn only once this pair's window has finished growing, faded out as the pair ends.
        const drawIn = ramp(frame, t0 + 7, 12);
        const drawOut = ramp(frame, t0 + PAIR_FRAMES - 6, 6);
        return {
            connector: Math.max(drawIn, all),
            connectorOpacity: Math.max(drawIn * (1 - drawOut), all * 0.85),
            ...geo,
            width: layout.width,
            height: layout.height,
            focus,
            // How strongly the pair outline/connector is drawn: selected pair, then all three at the end.
            link: Math.max(focus, all * 0.85),
        };
    });
    // How much a window/card is dimmed: the strongest OTHER pair currently lit (0 when none, or in the all-lit state).
    const geometry = base.map((g, w) => ({
        ...g,
        dim: Math.max(0, ...base.filter((_, j) => j !== w).map((o) => o.focus)),
    }));
    const front = 2;
    const iconLocal = toolbarIconCenter(MESS_LAYOUT[front].width);
    const iconPos = {
        x: geometry[front].x + iconLocal.x * geometry[front].scale,
        y: geometry[front].y + iconLocal.y * geometry[front].scale,
    };

    // --- cursor + click --------------------------------------------------
    const cursorIn = ramp(frame, 4, CURSOR_ARRIVES - 4, ease);
    const cursorStart = { x: 1500, y: 900 };
    const cursorX = cursorStart.x + (iconPos.x - cursorStart.x) * cursorIn;
    const cursorY = cursorStart.y + (iconPos.y - cursorStart.y) * cursorIn;
    const cursorOut = 1 - ramp(frame, CLICK_AT + 14, 12);
    const pressed = ramp(frame, CLICK_AT - 2, 4) * (1 - ramp(frame, CLICK_AT + 6, 18));
    const rippleT = ramp(frame, CLICK_AT, 18);

    // --- popup -------------------------------------------------------------
    const open = ramp(frame, POPUP_OPEN[0], POPUP_OPEN[1] - POPUP_OPEN[0]);
    const popupScale = 0.35 + 0.65 * open;
    const popupOrigin = { x: iconPos.x - POPUP.x, y: iconPos.y - POPUP.y };
    const startFrame = Math.round((popupClipStartMs(theme) / 1000) * TOUR_FPS);

    return (
        <Desktop theme={theme}>
            {geometry.map((g, w) => (
                <BrowserWindow
                    key={w}
                    tabs={WINDOWS[w]}
                    activeIndex={START_ACTIVE[w]}
                    theme={theme}
                    width={g.width}
                    height={g.height}
                    scale={g.scale}
                    origin="0 0"
                    toolbarIcon={{ src: "logo.png", pressed: w === front ? pressed : 0 }}
                    style={{ left: g.x, top: g.y, zIndex: windowZ(g.focus, w), opacity: 1 - DIM_AMOUNT * g.dim }}
                />
            ))}

            {/* Window outlines + badges: stacked just above their own window, so a
                window in front of another also covers that one's outline. */}
            {geometry.map((g, w) => {
                const z = windowZ(g.focus, w) + 5;
                return (
                    <React.Fragment key={`mark-${w}`}>
                        <div
                            style={{
                                position: "absolute",
                                left: g.x,
                                top: g.y,
                                width: g.width * g.scale,
                                height: g.height * g.scale,
                                borderRadius: 12 * g.scale,
                                boxSizing: "border-box",
                                border: `${5 * g.link}px solid ${PAIR_COLORS[w]}`,
                                opacity: g.link,
                                zIndex: z,
                            }}
                        />
                        <div style={{ position: "absolute", inset: 0, zIndex: z, pointerEvents: "none" }}>
                            <NumberBadge n={w + 1} color={PAIR_COLORS[w]} x={g.x - BADGE_INSET} y={g.y - BADGE_INSET} opacity={g.link * open} />
                        </div>
                    </React.Fragment>
                );
            })}

            {/* Real popup footage at 1:1 — never displayed larger than recorded */}
            <div
                style={{
                    position: "absolute",
                    left: POPUP.x,
                    top: POPUP.y,
                    width: TOUR_POPUP_SOURCE.width,
                    height: TOUR_POPUP_SOURCE.height,
                    opacity: open,
                    transform: `scale(${popupScale})`,
                    transformOrigin: `${popupOrigin.x}px ${popupOrigin.y}px`,
                    boxShadow: "0 30px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(128,128,128,0.35)",
                    overflow: "hidden",
                    zIndex: 200,
                }}
            >
                <OffthreadVideo
                    src={staticFile(`tour/recordings/${theme}/${TOUR_POPUP_STEP_ID}.webm`)}
                    startFrom={startFrame}
                    muted
                    style={{ width: TOUR_POPUP_SOURCE.width, height: TOUR_POPUP_SOURCE.height, objectFit: "fill" }}
                />
            </div>

            {/* Card outlines, numbers and connector lines (above the popup) */}
            <svg
                width="1920"
                height="1080"
                style={{ position: "absolute", left: 0, top: 0, zIndex: 300, pointerEvents: "none" }}
            >
                {geometry.map((g, w) => {
                    const card = POPUP_CARDS[w];
                    const cx = POPUP.x + card.x;
                    const cy = POPUP.y + card.y;
                    const x1 = g.x + g.width * g.scale;
                    const y1 = g.y + (g.height * g.scale) / 2;
                    const x2 = cx - 2;
                    const y2 = cy + 28;
                    const a = g.link * open;
                    return (
                        <g key={w}>
                            {/* Dim the cards that are not part of the lit pair. */}
                            <rect
                                x={cx}
                                y={cy}
                                width={card.width}
                                height={card.height}
                                fill={theme === "dark" ? "#000" : "#fff"}
                                opacity={DIM_AMOUNT * g.dim * open}
                            />
                            <g opacity={a}>
                            <rect
                                x={cx - 3}
                                y={cy - 3}
                                width={card.width + 6}
                                height={card.height + 6}
                                rx={4}
                                fill={PAIR_COLORS[w]}
                                fillOpacity={0.14}
                                stroke={PAIR_COLORS[w]}
                                strokeWidth={4}
                            />
                            </g>
                            <g opacity={g.connectorOpacity * open}>
                            <path
                                d={`M ${x1} ${y1} C ${x1 + 160} ${y1}, ${x2 - 160} ${y2}, ${x2} ${y2}`}
                                fill="none"
                                stroke={PAIR_COLORS[w]}
                                strokeWidth={5}
                                strokeLinecap="round"
                                pathLength={1}
                                strokeDasharray={1}
                                strokeDashoffset={1 - g.connector}
                            />
                            <circle cx={x1} cy={y1} r={8} fill={PAIR_COLORS[w]} />
                            <circle cx={x2} cy={y2} r={8} fill={PAIR_COLORS[w]} />
                            </g>
                        </g>
                    );
                })}
            </svg>
            <div style={{ position: "absolute", inset: 0, zIndex: 310, pointerEvents: "none" }}>
                {geometry.map((g, w) => (
                    <NumberBadge
                        key={w}
                        n={w + 1}
                        color={PAIR_COLORS[w]}
                        x={POPUP.x + POPUP_CARDS[w].x - BADGE_INSET}
                        y={POPUP.y + POPUP_CARDS[w].y - BADGE_INSET}
                        opacity={g.link * open}
                    />
                ))}
            </div>

            {/* Click ripple + cursor */}
            <AbsoluteFill style={{ zIndex: 400, pointerEvents: "none" }}>
                {rippleT > 0 && rippleT < 1 && (
                    <div
                        style={{
                            position: "absolute",
                            left: iconPos.x - 30,
                            top: iconPos.y - 30,
                            width: 60,
                            height: 60,
                            borderRadius: 30,
                            border: "3px solid rgba(0,180,204,0.95)",
                            background: "rgba(0,180,204,0.4)",
                            transform: `scale(${0.4 + 1.8 * rippleT})`,
                            opacity: 1 - rippleT,
                        }}
                    />
                )}
                {frame >= 4 && <Cursor x={cursorX} y={cursorY} opacity={cursorOut} />}
            </AbsoluteFill>
        </Desktop>
    );
}
