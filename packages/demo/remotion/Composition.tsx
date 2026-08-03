import React from "react";
import {
    AbsoluteFill,
    Audio,
    Img,
    getStaticFiles,
    OffthreadVideo,
    Sequence,
    interpolate,
    staticFile,
    useCurrentFrame,
} from "remotion";
import { demoScript, LEADING_TRIM_MS, type DemoStep } from "../demo-script";
// ponytail: per-step zoom transform-origin (fraction of the 800x600 viewport,
// centered on whatever element the step's action actually targets), measured
// by actions.ts/record.ts at recording time and committed like every other
// measured constant in this pipeline (durationMs, LEADING_TRIM_MS). A step id
// with no entry (never zoomed, or origin couldn't be resolved) just falls
// back to a centered zoom — same behavior as before this existed.
import zoomOriginsData from "../zoom-origins.json";
const zoomOrigins: Record<string, { x: number; y: number }> = zoomOriginsData;

// ponytail: shared theme colors for every non-recorded/bookend element
// (title cards, the intro logo card, the outer fallback background) — the
// recorded footage itself is already theme-correct (it's a real screen
// recording of the themed popup), but these Remotion-drawn elements don't
// get that for free and were previously hardcoded dark regardless of which
// composition (WalkthroughDemoDark vs WalkthroughDemoLight) was rendering.
const THEME_COLORS = {
    dark: { bg: "#0b0f14", bgGradient: "linear-gradient(135deg, #0b0f14 0%, #131b26 100%)", text: "white" },
    light: { bg: "#f5f6f8", bgGradient: "linear-gradient(135deg, #f5f6f8 0%, #e7eaee 100%)", text: "#111318" },
} as const;

// Styled title card for textCard steps (hook/outro/callouts) — fades and
// scales in so a dedicated text scene doesn't feel like a static slide.
function TextCard({ text, theme }: { text: string; theme: "light" | "dark" }) {
    const frame = useCurrentFrame();
    const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });
    const scale = interpolate(frame, [0, 15], [0.92, 1], { extrapolateRight: "clamp" });
    const colors = THEME_COLORS[theme];
    return (
        <AbsoluteFill
            style={{
                justifyContent: "center",
                alignItems: "center",
                background: colors.bgGradient,
            }}
        >
            <div
                style={{
                    opacity,
                    transform: `scale(${scale})`,
                    color: colors.text,
                    fontFamily: "sans-serif",
                    fontWeight: 800,
                    fontSize: 44,
                    lineHeight: 1.3,
                    textAlign: "center",
                    maxWidth: "80%",
                }}
            >
                {text}
            </div>
        </AbsoluteFill>
    );
}

const FPS = 30;
const msToFrames = (ms: number) => Math.round((ms / 1000) * FPS);

// ponytail: a static title card instead of a real thumbnail-generation step
// — playback used to open on a blank canvas while the first recording's
// video element buffered. This gives it something branded to show
// immediately. Swap for a real designed thumbnail if one shows up later.
const INTRO_DURATION_MS = 1500;

// See demo-script.ts's LEADING_TRIM_MS comment — trims the leading
// spinner/blank-white loading flash off every recorded clip at playback
// time. record.ts records that same amount of EXTRA buffer per step so
// this trim never eats into the tail of the action instead.
const leadingTrimFrames = msToFrames(LEADING_TRIM_MS);

// Drop background music / voiceover at packages/demo/public/audio/track.mp3
// — optional, render skips the <Audio> track entirely if the file is absent.
// ponytail: getStaticFiles() (not node:fs) because this module is webpack-
// bundled into the browser-side Remotion render; node:fs import here broke
// bundling for every composition in Root.tsx, not just WalkthroughDemo.
const AUDIO_FILE = "audio/track.mp3";
const hasAudioTrack = getStaticFiles().some((f) => f.name === AUDIO_FILE);

// ponytail: BUG FIX 2026-07-31 (letterboxing) — Remotion's <OffthreadVideo>/
// <Img> apply a default `object-fit: contain` class (deliberately
// low-specificity so it's overridable via inline `style` — see
// remotion/dist/.../default-css.js's OBJECTFIT_CONTAIN_CLASS_NAME comment).
// We never overrode it, so every clip was fit-inside its box (any tiny
// aspect-ratio slop between the recorded .webm and the 800x600 composition
// canvas shows as empty bars) instead of filling it — and since object-fit
// and the zoom `transform` are independent CSS properties, the letterboxing
// persisted through the zoom in/out too, exactly as reported. `objectFit:
// "cover"` (inline style, wins over the low-specificity default class) fills
// the frame edge-to-edge unconditionally, cropping a sliver of overflow
// instead of ever showing empty space — the correct trade-off here, this
// pipeline never wants black bars. Applied to both the zoomed and unzoomed
// video paths below.
const FILL_FRAME_STYLE: React.CSSProperties = { objectFit: "cover" };

// ponytail: `step.zoom` used to be a STATIC scale held
// for a beat's entire duration (`transform: scale(step.zoom)` applied once,
// unconditionally). Direct feedback: this reads as "awful"/"can't see
// anything" — a whole clip pinned at 1.3-1.5x zoom loses all surrounding
// context, not just an emphasis effect. The actual intent was always
// TEMPORARY emphasis: normal view -> zoom in on the specific action as it
// happens -> brief hold on the result -> zoom back OUT to normal before the
// beat ends. `ZoomVideo` below animates `scale` across 5 keyframes (normal /
// ramp-in / held-zoomed / ramp-out / normal) as fractions of the sequence's
// own padded duration, so it's self-contained per step regardless of that
// step's actual durationMs. Kept as a plain 5-point `interpolate()` (no
// easing curve, no new dependency) — a linear ramp reads as a smooth zoom at
// 30fps over ~15% of a multi-second beat, no need for anything fancier.
function ZoomVideo({
    src,
    startFrom,
    zoom,
    durationInFrames,
    origin,
}: {
    src: string;
    startFrom: number;
    zoom: number;
    durationInFrames: number;
    // Fraction (0-1) of the 800x600 frame to zoom in on — undefined falls
    // back to a centered zoom (the old, only-ever-available behavior).
    origin?: { x: number; y: number };
}) {
    const frame = useCurrentFrame();
    const inStart = Math.round(durationInFrames * 0.15);
    const inEnd = Math.round(durationInFrames * 0.3);
    const outStart = Math.round(durationInFrames * 0.7);
    const outEnd = Math.round(durationInFrames * 0.88);
    const scale = interpolate(
        frame,
        [0, inStart, inEnd, outStart, outEnd, durationInFrames],
        [1, 1, zoom, zoom, 1, 1],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
    const transformOrigin = origin ? `${origin.x * 100}% ${origin.y * 100}%` : "center";
    return (
        <OffthreadVideo
            src={src}
            startFrom={startFrom}
            style={{ ...FILL_FRAME_STYLE, transform: `scale(${scale})`, transformOrigin }}
        />
    );
}

// ponytail: manual crossfade via overlapping Sequences + opacity
// interpolate, instead of pulling in @remotion/transitions — that package
// isn't installed, and a plain dissolve is a few lines this way (Remotion's
// own docs describe this exact overlapping-Sequence pattern for a manual
// transition). Each scene's Sequence starts/ends TRANSITION_FRAMES early/
// late relative to its nominal cut point and fades in/out over that window,
// so two adjacent clips genuinely cross-dissolve rather than one popping in
// after the other's already gone.
const TRANSITION_FRAMES = 8; // ~267ms at 30fps — snappy, not a slow dissolve

function Fade({
    children,
    fadeIn,
    fadeOut,
    durationInFrames,
}: {
    children: React.ReactNode;
    fadeIn: boolean;
    fadeOut: boolean;
    durationInFrames: number;
}) {
    const frame = useCurrentFrame();
    // ponytail: interpolate() requires a STRICTLY increasing inputRange —
    // when fadeIn/fadeOut is false the naive 4-point range collapses to a
    // duplicate (e.g. [0, 0, 45, 53] for a non-fading-in first scene),
    // which throws at render time. Build only the breakpoints that are
    // actually distinct instead of always emitting 4 fixed points.
    const fadeOutStart = durationInFrames - (fadeOut ? TRANSITION_FRAMES : 0);
    const points: [number, number][] = [[0, fadeIn ? 0 : 1]];
    if (fadeIn) points.push([TRANSITION_FRAMES, 1]);
    if (fadeOutStart > points[points.length - 1][0] && fadeOutStart < durationInFrames) {
        points.push([fadeOutStart, 1]);
    }
    if (durationInFrames > points[points.length - 1][0]) {
        points.push([durationInFrames, fadeOut ? 0 : 1]);
    }
    const opacity = interpolate(
        frame,
        points.map((p) => p[0]),
        points.map((p) => p[1]),
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
    return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

// ponytail: `script` prop (defaults to the full demoScript) instead of a
// second near-duplicate component — the promo cut (see promoScript in
// demo-script.ts) needs the exact same intro card/crossfade/caption-bar
// rendering, just over a shorter step list. Reusing this component keeps
// both cuts visually identical by construction instead of two components
// silently drifting apart.
export function WalkthroughDemo({
    theme = "dark",
    script = demoScript,
}: {
    theme?: "light" | "dark";
    script?: DemoStep[];
}) {
    const introDurationInFrames = msToFrames(INTRO_DURATION_MS);
    const colors = THEME_COLORS[theme];
    // Cut points ignore the overlap — this is where each scene "nominally"
    // starts/ends before padding for the crossfade.
    let cutFrame = introDurationInFrames;

    return (
        <AbsoluteFill style={{ backgroundColor: colors.bg }}>
            {hasAudioTrack && <Audio src={staticFile(AUDIO_FILE)} volume={0.5} />}
            <Sequence from={0} durationInFrames={introDurationInFrames + TRANSITION_FRAMES}>
                <Fade fadeIn={false} fadeOut durationInFrames={introDurationInFrames + TRANSITION_FRAMES}>
                    <AbsoluteFill
                        style={{
                            justifyContent: "center",
                            alignItems: "center",
                            flexDirection: "row",
                            gap: 16,
                            background: colors.bgGradient,
                        }}
                    >
                        <Img src={staticFile("logo.png")} style={{ width: 64, height: 64 }} />
                        <div style={{ color: colors.text, fontFamily: "sans-serif", fontWeight: 700, fontSize: 40 }}>
                            TabMerger
                        </div>
                    </AbsoluteFill>
                </Fade>
            </Sequence>
            {script.map((step, i) => {
                const durationInFrames = msToFrames(step.durationMs);
                const isFirst = i === 0;
                const isLast = i === script.length - 1;
                const from = cutFrame - TRANSITION_FRAMES;
                const paddedDuration =
                    durationInFrames + (isFirst ? 0 : TRANSITION_FRAMES) + (isLast ? 0 : TRANSITION_FRAMES);
                const sequence = (
                    <Sequence key={step.id} from={from} durationInFrames={paddedDuration}>
                        <Fade fadeIn={!isFirst} fadeOut={!isLast} durationInFrames={paddedDuration}>
                            {step.textCard ? (
                                <TextCard text={step.caption} theme={theme} />
                            ) : (
                                <>
                                    <AbsoluteFill style={{ overflow: "hidden" }}>
                                        {step.zoom ? (
                                            <ZoomVideo
                                                src={staticFile(`recordings/${theme}/${step.id}.webm`)}
                                                startFrom={leadingTrimFrames}
                                                zoom={step.zoom}
                                                durationInFrames={paddedDuration}
                                                origin={zoomOrigins[step.id]}
                                            />
                                        ) : (
                                            <OffthreadVideo
                                                src={staticFile(`recordings/${theme}/${step.id}.webm`)}
                                                startFrom={leadingTrimFrames}
                                                style={FILL_FRAME_STYLE}
                                            />
                                        )}
                                    </AbsoluteFill>
                                    <div
                                        style={{
                                            position: "absolute",
                                            bottom: 32,
                                            left: 32,
                                            right: 32,
                                            padding: "10px 20px",
                                            borderRadius: 0,
                                            background: "rgba(0,0,0,0.65)",
                                            color: "white",
                                            fontFamily: "sans-serif",
                                            fontSize: 16,
                                            fontWeight: 600,
                                            textAlign: "center",
                                        }}
                                    >
                                        {step.caption}
                                    </div>
                                </>
                            )}
                        </Fade>
                    </Sequence>
                );
                cutFrame += durationInFrames;
                return sequence;
            })}
        </AbsoluteFill>
    );
}

// ponytail: mobile-friendly export (2026-08-01, per coordinator ask — this
// promo may be embedded/shared on pages viewed on a phone, portrait or
// small viewport). `WalkthroughDemo` itself is hard-coded around an 800x600
// canvas (every caption/badge position is a fixed pixel value assuming
// that), so rather than rewrite it to be responsive, wrap an UNMODIFIED
// 800x600 instance in a CSS `transform: scale()` inside a taller 1080x1920
// portrait canvas. This scales EVERYTHING proportionally — video, caption
// bar, text size, key-press badges — so nothing needs a separate "is this
// the mobile composition" branch anywhere else in this file. The scaled
// block fills the full 1080px width (scale = 1080/800 = 1.35) and is
// vertically centered; the leftover top/bottom space (1920 - 600*1.35 =
// ~1110px) is filled with the same brand gradient background used by the
// intro/outro cards, not black bars — reads as an intentional portrait
// composition, not a landscape video shrunk into a phone frame. Keeps the
// existing 800x600 landscape export as-is (not redundant — different
// consumers: Chrome Web Store / desktop-viewed embeds vs. mobile-shared
// social).
export function MobileWalkthroughDemo(props: { theme?: "light" | "dark"; script?: DemoStep[] }) {
    const theme = props.theme ?? "dark";
    const colors = THEME_COLORS[theme];
    const scale = 1080 / 800;
    return (
        <AbsoluteFill style={{ background: colors.bgGradient }}>
            <div
                style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    width: 800,
                    height: 600,
                    transform: `translate(-50%, -50%) scale(${scale})`,
                    transformOrigin: "center center",
                }}
            >
                <WalkthroughDemo {...props} />
            </div>
        </AbsoluteFill>
    );
}

export function getTotalDurationInFrames(script: DemoStep[]) {
    return (
        msToFrames(INTRO_DURATION_MS) +
        script.reduce((sum, step) => sum + msToFrames(step.durationMs), 0)
    );
}

export const totalDurationInFrames = getTotalDurationInFrames(demoScript);
