// Which of the three drawn browser windows are open when each tour scene ENDS.
// One place for it, read by every scene that draws the windows, so no later
// scene can show a window an earlier scene closed. Scene 8 (restore) is where
// a saved group's windows come back: flip the matching entry back to true
// there. Order is the tour order; a scene's "before" is the previous entry's
// "after". Window index 0/1/2 = the first/second/third window of
// CHAOS_WINDOW_URLS (Yahoo Mail, arXiv, Super User) = blue/amber/green in scene 2.
export type OpenWindows = readonly [boolean, boolean, boolean];

export const TOUR_OPEN_WINDOWS_AFTER: readonly { scene: string; open: OpenWindows }[] = [
    { scene: "the-mess", open: [true, true, true] },
    { scene: "open-tabmerger", open: [true, true, true] },
    // Window 1 is dragged into a new group; its last tab closes with the popup, so the window closes.
    { scene: "drag-to-new-group", open: [false, true, true] },
];

/** Open drawn windows at the end of `scene`. */
export function openWindowsAfter(scene: string): OpenWindows {
    const entry = TOUR_OPEN_WINDOWS_AFTER.find((e) => e.scene === scene);
    if (!entry) throw new Error(`openWindows.ts has no entry for scene "${scene}"`);
    return entry.open;
}

/** Open drawn windows at the start of `scene` (nothing is open before the first scene). */
export function openWindowsBefore(scene: string): OpenWindows {
    const i = TOUR_OPEN_WINDOWS_AFTER.findIndex((e) => e.scene === scene);
    if (i < 0) throw new Error(`openWindows.ts has no entry for scene "${scene}"`);
    return i === 0 ? [false, false, false] : TOUR_OPEN_WINDOWS_AFTER[i - 1].open;
}
