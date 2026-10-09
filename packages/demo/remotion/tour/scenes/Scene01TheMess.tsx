import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { getChaosWindows } from "../../../lib/chaosWindows";
import { BrowserWindow } from "../BrowserWindow";
import { Desktop, TOUR_FPS, type TourSceneProps } from "../common";

// Scene 1 — "The mess": the three windows chaosHook opens, drawn as browser
// windows that arrive one after another and fill up with their tabs, piled on
// a desktop like a real cluttered screen.

export const SCENE_01_FRAMES = Math.round(4.5 * TOUR_FPS);

const WINDOWS = getChaosWindows();
const TAB_COUNT = WINDOWS.reduce((n, w) => n + w.length, 0);
// Computed from the real data so the caption can't claim more than is on screen.
export const SCENE_01_CAPTION = `${WINDOWS.length} windows. ${TAB_COUNT} tabs. Zero order.`;

// Back-to-front stacking order; the last one is the front window.
// Active tabs are ones with a usable page capture (see chaosWindows.ts).
export const MESS_LAYOUT = [
    { x: 50, y: 50, width: 1060, height: 640, activeIndex: 3, arriveAt: 0 },
    { x: 790, y: 130, width: 1090, height: 660, activeIndex: 1, arriveAt: 26 },
    { x: 300, y: 250, width: 1200, height: 650, activeIndex: 1, arriveAt: 52 },
] as const;

const ARRIVE_FRAMES = 22;
const TAB_STAGGER = 6; // frames between one tab popping in and the next
const TAB_FRAMES = 12;
// The front window flips through its tabs (only ones with a page capture) near the end so the scene keeps moving after the pile-up.
const FRONT_TAB_SWITCHES: [frame: number, activeIndex: number][] = [
    [100, 2],
    [118, 3],
];

// Active tab of each window when the scene ends (scene 2 starts from it). The
// front window ends on a tab with a usable page picture.
export const MESS_END_ACTIVE: number[] = MESS_LAYOUT.map((layout, w) =>
    w === MESS_LAYOUT.length - 1 ? FRONT_TAB_SWITCHES[FRONT_TAB_SWITCHES.length - 1][1] : layout.activeIndex,
);

const easeOut = Easing.out(Easing.cubic);
const ramp = (frame: number, start: number, length: number) =>
    interpolate(frame, [start, start + length], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: easeOut,
    });

export function Scene01TheMess({ theme = "dark" }: TourSceneProps) {
    const frame = useCurrentFrame();
    // Slow push-in across the whole scene so there is never a still moment.
    const push = interpolate(frame, [0, SCENE_01_FRAMES], [1, 1.05]);

    return (
        <Desktop theme={theme}>
            <AbsoluteFill style={{ transform: `scale(${push})`, transformOrigin: "50% 45%" }}>
                {MESS_LAYOUT.map((layout, w) => {
                    const tabs = WINDOWS[w];
                    const isFront = w === MESS_LAYOUT.length - 1;
                    const activeIndex = isFront
                        ? FRONT_TAB_SWITCHES.reduce<number>((a, [at, idx]) => (frame >= at ? idx : a), layout.activeIndex)
                        : layout.activeIndex;
                    // Gentle drift so windows breathe even while waiting for the next one to land.
                    const drift = Math.sin((frame + w * 20) / 22) * 5;
                    return (
                        <BrowserWindow
                            key={w}
                            tabs={tabs}
                            activeIndex={activeIndex}
                            theme={theme}
                            width={layout.width}
                            height={layout.height}
                            appear={ramp(frame, layout.arriveAt, ARRIVE_FRAMES)}
                            tabProgress={tabs.map((_, t) => ramp(frame, layout.arriveAt + 10 + t * TAB_STAGGER, TAB_FRAMES))}
                            toolbarIcon={{ src: "logo.png", pressed: 0 }}
                            style={{ left: layout.x, top: layout.y + drift }}
                        />
                    );
                })}
            </AbsoluteFill>
        </Desktop>
    );
}
