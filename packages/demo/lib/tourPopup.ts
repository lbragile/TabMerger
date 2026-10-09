// What the feature tour needs to know about its popup footage
// (public/tour/recordings/<theme>/tour-open-popup.webm, recorded by
// record-tour.ts). No node imports: bundled into Remotion.
import layout from "./tourPopupLayout.json";

export const TOUR_POPUP_STEP_ID = "tour-open-popup";
/** Length of the footage used, measured from `startMs`. */
export const TOUR_POPUP_CLIP_MS = 6000;
/** The recording's own pixel size (headless recordVideo captures the raw CSS viewport). */
export const TOUR_POPUP_SOURCE = { width: 800, height: 600 } as const;

export interface PopupRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Rects of the three "Now Open" window cards inside the 800x600 footage, in
 * window order (same order as CHAOS_WINDOW_URLS). Measured from the real DOM
 * by record-tour.ts and stored in tourPopupLayout.json, so they stay valid for
 * any re-recording of the same extension build. If the popup's layout changes,
 * re-run `pnpm --filter @tabmerger/demo record:tour dark` and look at the
 * resulting file.
 */
export const POPUP_CARDS: PopupRect[] = layout.cards;

/** Millisecond offset into the .webm where the settled "Now Open" list begins (past the loading flash). */
export const popupClipStartMs = (theme: "light" | "dark") => layout.startMs[theme];
