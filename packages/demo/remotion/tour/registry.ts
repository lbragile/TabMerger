import type React from "react";
import { TRANSITION_FRAMES } from "../Composition";
import type { CaptionCue, TourSceneProps } from "./common";
import { Scene01TheMess, SCENE_01_CAPTION, SCENE_01_FRAMES } from "./scenes/Scene01TheMess";
import { Scene03DragToNewGroup, SCENE_03_CAPTION, SCENE_03_FRAMES } from "./scenes/Scene03DragToNewGroup";
import { Scene04OrganiseTabs, SCENE_04_CAPTION, SCENE_04_FRAMES } from "./scenes/Scene04OrganiseTabs";
import { Scene05NameAndNote, SCENE_05_CAPTION, SCENE_05_FRAMES } from "./scenes/Scene05NameAndNote";
import { Scene06FindATab, SCENE_06_CAPTION, SCENE_06_FRAMES } from "./scenes/Scene06FindATab";
import { Scene07RestoreGroup, SCENE_07_CAPTION, SCENE_07_FRAMES } from "./scenes/Scene07RestoreGroup";
import { Scene08ShareGroup, SCENE_08_CAPTION, SCENE_08_FRAMES } from "./scenes/Scene08ShareGroup";
import { Scene09SyncDevices, SCENE_09_CAPTION, SCENE_09_FRAMES } from "./scenes/Scene09SyncDevices";
import { Scene10ClosingCard, SCENE_10_CAPTION, SCENE_10_FRAMES } from "./scenes/Scene10ClosingCard";
import { Scene02OpenTabMerger, SCENE_02_CAPTION, SCENE_02_FRAMES } from "./scenes/Scene02OpenTabMerger";

// One entry per feature-tour scene, in video order. The full tour
// (TourVideo.tsx) is assembled from this list and every scene also gets its
// own composition (Root.tsx), so a fix to one scene re-renders in seconds.
// Add the next scene by importing it and appending an entry here.
export interface TourScene {
    /** Kebab-case slug, used in composition ids and output file names. */
    id: string;
    durationInFrames: number;
    /** Caption text. Scenes do not draw it: the tour layer does, so captions change cleanly between scenes. */
    caption: string | CaptionCue[];
    Component: React.ComponentType<TourSceneProps>;
}

export const TOUR_SCENES: TourScene[] = [
    { id: "the-mess", durationInFrames: SCENE_01_FRAMES, caption: SCENE_01_CAPTION, Component: Scene01TheMess },
    { id: "open-tabmerger", durationInFrames: SCENE_02_FRAMES, caption: SCENE_02_CAPTION, Component: Scene02OpenTabMerger },
    { id: "drag-to-new-group", durationInFrames: SCENE_03_FRAMES, caption: SCENE_03_CAPTION, Component: Scene03DragToNewGroup },
    { id: "organise-tabs", durationInFrames: SCENE_04_FRAMES, caption: SCENE_04_CAPTION, Component: Scene04OrganiseTabs },
    { id: "name-and-note", durationInFrames: SCENE_05_FRAMES, caption: SCENE_05_CAPTION, Component: Scene05NameAndNote },
    { id: "find-a-tab", durationInFrames: SCENE_06_FRAMES, caption: SCENE_06_CAPTION, Component: Scene06FindATab },
    { id: "restore-group", durationInFrames: SCENE_07_FRAMES, caption: SCENE_07_CAPTION, Component: Scene07RestoreGroup },
    { id: "share-group", durationInFrames: SCENE_08_FRAMES, caption: SCENE_08_CAPTION, Component: Scene08ShareGroup },
    { id: "sync-devices", durationInFrames: SCENE_09_FRAMES, caption: SCENE_09_CAPTION, Component: Scene09SyncDevices },
    { id: "closing-card", durationInFrames: SCENE_10_FRAMES, caption: SCENE_10_CAPTION, Component: Scene10ClosingCard },
];

/** Two-digit position in the tour, e.g. "01". */
export const tourSceneNumber = (id: string) => String(TOUR_SCENES.findIndex((s) => s.id === id) + 1).padStart(2, "0");
/** Composition id for one scene in one theme, e.g. `TourScene-the-mess-dark`. */
export const tourSceneCompositionId = (id: string, theme: string) => `TourScene-${id}-${theme}`;
/** The thumbnail intro: how long the poster image is shown fully opaque before it dissolves into scene 1. */
export const TOUR_INTRO_HOLD_FRAMES = 30;
/** Frame at which scene 1 content starts: the intro hold plus the dissolve (scene 1 holds its first frame while it fades in). */
export const TOUR_FIRST_CUT_FRAME = TOUR_INTRO_HOLD_FRAMES + TRANSITION_FRAMES;
/** Where each scene's content starts in the full tour (the intro, then every scene preceded by one TRANSITION_FRAMES dissolve). */
export const getTourCutFrames = () => {
    const cuts: number[] = [];
    let c = TOUR_FIRST_CUT_FRAME;
    for (const s of TOUR_SCENES) {
        cuts.push(c);
        c += s.durationInFrames + TRANSITION_FRAMES;
    }
    return cuts;
};
/**
 * Intro hold + the scenes + one TRANSITION_FRAMES per scene (each scene holds its first frame while it fades in,
 * see TourVideo.tsx). The intro is the poster image from TourThumbnail.tsx.
 */
export const getTourDurationInFrames = () =>
    TOUR_INTRO_HOLD_FRAMES + TOUR_SCENES.reduce((n, s) => n + s.durationInFrames + TRANSITION_FRAMES, 0);
