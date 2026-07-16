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
import { demoScript } from "../demo-script";

// Styled title card for textCard steps (hook/outro/callouts) — fades and
// scales in so a dedicated text scene doesn't feel like a static slide.
function TextCard({ text }: { text: string }) {
    const frame = useCurrentFrame();
    const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });
    const scale = interpolate(frame, [0, 15], [0.92, 1], { extrapolateRight: "clamp" });
    return (
        <AbsoluteFill
            style={{
                justifyContent: "center",
                alignItems: "center",
                background: "linear-gradient(135deg, #0b0f14 0%, #131b26 100%)",
            }}
        >
            <div
                style={{
                    opacity,
                    transform: `scale(${scale})`,
                    color: "white",
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

// Drop background music / voiceover at packages/demo/public/audio/track.mp3
// — optional, render skips the <Audio> track entirely if the file is absent.
// ponytail: getStaticFiles() (not node:fs) because this module is webpack-
// bundled into the browser-side Remotion render; node:fs import here broke
// bundling for every composition in Root.tsx, not just WalkthroughDemo.
const AUDIO_FILE = "audio/track.mp3";
const hasAudioTrack = getStaticFiles().some((f) => f.name === AUDIO_FILE);

export function WalkthroughDemo() {
    const introDurationInFrames = msToFrames(INTRO_DURATION_MS);
    let startFrame = introDurationInFrames;

    return (
        <AbsoluteFill style={{ backgroundColor: "#0b0f14" }}>
            {hasAudioTrack && <Audio src={staticFile(AUDIO_FILE)} volume={0.5} />}
            <Sequence from={0} durationInFrames={introDurationInFrames}>
                <AbsoluteFill
                    style={{
                        justifyContent: "center",
                        alignItems: "center",
                        flexDirection: "row",
                        gap: 16,
                    }}
                >
                    <Img src={staticFile("logo.png")} style={{ width: 64, height: 64 }} />
                    <div style={{ color: "white", fontFamily: "sans-serif", fontWeight: 700, fontSize: 40 }}>
                        TabMerger
                    </div>
                </AbsoluteFill>
            </Sequence>
            {demoScript.map((step) => {
                const durationInFrames = msToFrames(step.durationMs);
                const sequence = (
                    <Sequence
                        key={step.id}
                        from={startFrame}
                        durationInFrames={durationInFrames}
                    >
                        {step.textCard ? (
                            <TextCard text={step.caption} />
                        ) : (
                            <>
                                <OffthreadVideo
                                    src={staticFile(`recordings/${step.id}.webm`)}
                                />
                                <div
                                    style={{
                                        position: "absolute",
                                        bottom: 32,
                                        left: 32,
                                        right: 32,
                                        padding: "12px 20px",
                                        borderRadius: 8,
                                        background: "rgba(0,0,0,0.65)",
                                        color: "white",
                                        fontFamily: "sans-serif",
                                        fontSize: 22,
                                    }}
                                >
                                    {step.caption}
                                </div>
                            </>
                        )}
                    </Sequence>
                );
                startFrame += durationInFrames;
                return sequence;
            })}
        </AbsoluteFill>
    );
}

export const totalDurationInFrames =
    msToFrames(INTRO_DURATION_MS) +
    demoScript.reduce((sum, step) => sum + msToFrames(step.durationMs), 0);
