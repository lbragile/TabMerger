import React from "react";
import { AbsoluteFill, Audio, Freeze, Sequence, getStaticFiles, staticFile, useCurrentFrame } from "remotion";
import { Fade, THEME_COLORS, TRANSITION_FRAMES } from "../Composition";
import { CAPTION_BAR_FADE_FRAMES, CAPTION_GAP_FRAMES, CaptionBar, captionTextAt, hasNoCaption, type TourSceneProps } from "./common";
import { TOUR_FIRST_CUT_FRAME, TOUR_INTRO_HOLD_FRAMES, TOUR_SCENES } from "./registry";
import { TourThumbnail } from "./TourThumbnail";

// The full feature tour. It opens with the poster image (TourThumbnail, the same component the
// standalone thumbnail PNG renders) fully opaque from frame 0, then every registry scene back to back,
// joined with the same hand-rolled overlapping-Sequence cross-fade as WalkthroughDemo (see the
// TRANSITION_FRAMES comment in Composition.tsx for why not @remotion/transitions). Captions are drawn
// here, once, above all scenes.
//
// The scenes are built frame-matched (a scene's first frame equals the previous scene's last frame), so
// a cross-fade is only invisible if the incoming scene is STILL on its first frame while it fades in and
// the outgoing one stays opaque underneath. Each scene therefore holds its first frame for
// TRANSITION_FRAMES (the fade-in) and its content starts at the cut; the next scene's fade-in begins
// right after this scene's content ends. Total length: see getTourDurationInFrames in registry.ts.
//
// Audio: an optional synthesised background bed (public/tour/audio/tour-<theme>.wav, written by
// generate-tour-audio.ts). The video is complete without it: pass the prop `audio: false` (see the
// render:tour-*-silent scripts) or leave the file out and no <Audio> is rendered.
const audioFile = (theme: string) => `tour/audio/tour-${theme}.wav`;

export function TourVideo({ theme = "dark", audio = true }: TourSceneProps & { audio?: boolean }) {
    const frame = useCurrentFrame();
    let cutFrame = TOUR_FIRST_CUT_FRAME; // where this scene's content starts
    let caption = "";
    // A scene with an empty caption draws no bar: it fades out over its first frames and stays gone.
    let noBarFrom: number | null = null;
    const scenes = TOUR_SCENES.map((scene, i) => {
        const isLast = i === TOUR_SCENES.length - 1;
        const cut = cutFrame;
        const from = cut - TRANSITION_FRAMES; // the Sequence starts with the fade-in
        const paddedDuration = TRANSITION_FRAMES + scene.durationInFrames + (isLast ? 0 : TRANSITION_FRAMES);
        cutFrame += scene.durationInFrames + TRANSITION_FRAMES;
        if (noBarFrom === null && hasNoCaption(scene.caption)) noBarFrom = cut;
        const textFrom = cut + (i === 0 ? 0 : CAPTION_GAP_FRAMES / 2);
        const textTo = cutFrame - (isLast ? 0 : CAPTION_GAP_FRAMES / 2);
        if (frame >= textFrom && frame < textTo) caption = captionTextAt(scene.caption, frame - cut);
        return (
            <Sequence key={scene.id} from={from} durationInFrames={paddedDuration}>
                {/* The outgoing scene stays opaque under the incoming one, so the dissolve never dips toward the background. */}
                <Fade fadeIn fadeOut={false} durationInFrames={paddedDuration}>
                    <Sequence from={0} durationInFrames={TRANSITION_FRAMES}>
                        <Freeze frame={0}>
                            <scene.Component theme={theme} />
                        </Freeze>
                    </Sequence>
                    <Sequence from={TRANSITION_FRAMES}>
                        <scene.Component theme={theme} />
                    </Sequence>
                </Fade>
            </Sequence>
        );
    });
    // Caption bar: absent during the intro, fades in together with scene 1's dissolve, fades out for a no-caption scene.
    const barIn = Math.min(1, Math.max(0, (frame - TOUR_INTRO_HOLD_FRAMES) / TRANSITION_FRAMES));
    const barOut = noBarFrom === null || frame < noBarFrom ? 1 : 1 - Math.min(1, (frame - noBarFrom) / CAPTION_BAR_FADE_FRAMES);
    const barOpacity = barIn * barOut;
    const hasAudio = audio && getStaticFiles().some((f) => f.name === audioFile(theme));
    return (
        <AbsoluteFill style={{ backgroundColor: THEME_COLORS[theme].bg }}>
            {/* The poster image, fully opaque from frame 0; scene 1 dissolves in over it. */}
            <Sequence from={0} durationInFrames={TOUR_FIRST_CUT_FRAME}>
                <TourThumbnail theme={theme} />
            </Sequence>
            {scenes}
            {barOpacity > 0 && <CaptionBar text={caption} {...(barOpacity < 1 ? { opacity: barOpacity } : {})} />}
            {hasAudio && <Audio src={staticFile(audioFile(theme))} />}
        </AbsoluteFill>
    );
}

/** One scene on its own (its caption included), for the per-scene compositions. */
export function TourSceneView({ theme = "dark", sceneId }: TourSceneProps & { sceneId?: string }) {
    const scene = TOUR_SCENES.find((s) => s.id === sceneId) ?? TOUR_SCENES[0];
    const frame = useCurrentFrame();
    return (
        <AbsoluteFill>
            <scene.Component theme={theme} />
            {!hasNoCaption(scene.caption) && <CaptionBar text={captionTextAt(scene.caption, frame)} />}
        </AbsoluteFill>
    );
}
