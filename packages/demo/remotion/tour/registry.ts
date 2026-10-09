import type React from "react";
import type { CaptionCue, TourSceneProps } from "./common";
import { Scene01TheMess, SCENE_01_CAPTION, SCENE_01_FRAMES } from "./scenes/Scene01TheMess";
import { Scene03DragToNewGroup, SCENE_03_CAPTION, SCENE_03_FRAMES } from "./scenes/Scene03DragToNewGroup";
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
];

/** Two-digit position in the tour, e.g. "01". */
export const tourSceneNumber = (id: string) => String(TOUR_SCENES.findIndex((s) => s.id === id) + 1).padStart(2, "0");
/** Composition id for one scene in one theme, e.g. `TourScene-the-mess-dark`. */
export const tourSceneCompositionId = (id: string, theme: string) => `TourScene-${id}-${theme}`;
export const getTourDurationInFrames = () => TOUR_SCENES.reduce((n, s) => n + s.durationInFrames, 0);
