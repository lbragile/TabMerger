import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { Fade, THEME_COLORS, TRANSITION_FRAMES } from "../Composition";
import { CAPTION_GAP_FRAMES, CaptionBar, captionTextAt, type TourSceneProps } from "./common";
import { TOUR_SCENES } from "./registry";

// The full feature tour: every registry scene back to back, joined with the
// same hand-rolled overlapping-Sequence cross-fade as WalkthroughDemo (see the
// TRANSITION_FRAMES comment in Composition.tsx for why not
// @remotion/transitions). Captions are drawn here, once, above all scenes.
export function TourVideo({ theme = "dark" }: TourSceneProps) {
    const frame = useCurrentFrame();
    let cutFrame = 0;
    let caption = "";
    const scenes = TOUR_SCENES.map((scene, i) => {
        const isFirst = i === 0;
        const isLast = i === TOUR_SCENES.length - 1;
        const cut = cutFrame;
        const from = cut - (isFirst ? 0 : TRANSITION_FRAMES);
        const paddedDuration =
            scene.durationInFrames + (isFirst ? 0 : TRANSITION_FRAMES) + (isLast ? 0 : TRANSITION_FRAMES);
        cutFrame += scene.durationInFrames;
        const textFrom = cut + (isFirst ? 0 : CAPTION_GAP_FRAMES / 2);
        const textTo = cutFrame - (isLast ? 0 : CAPTION_GAP_FRAMES / 2);
        if (frame >= textFrom && frame < textTo) caption = captionTextAt(scene.caption, frame - from);
        return (
            <Sequence key={scene.id} from={from} durationInFrames={paddedDuration}>
                <Fade fadeIn={!isFirst} fadeOut={!isLast} durationInFrames={paddedDuration}>
                    <scene.Component theme={theme} />
                </Fade>
            </Sequence>
        );
    });
    return (
        <AbsoluteFill style={{ backgroundColor: THEME_COLORS[theme].bg }}>
            {scenes}
            <CaptionBar text={caption} />
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
            <CaptionBar text={captionTextAt(scene.caption, frame)} />
        </AbsoluteFill>
    );
}
