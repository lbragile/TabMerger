// Which of the three drawn browser windows are open when each tour scene ENDS.
// One place for it, read by every scene that draws the windows, so no later
// scene can show a window an earlier scene closed. Windows that a
// later scene restores from a saved group are tracked separately below (they are new
// windows, not the three originals). Order is the tour order; a scene's "before" is the previous entry's
// "after". Window index 0/1/2 = the first/second/third window of
// CHAOS_WINDOW_URLS (Yahoo Mail, arXiv, Super User) = blue/amber/green in scene 2.
export type OpenWindows = readonly [boolean, boolean, boolean];

export const TOUR_OPEN_WINDOWS_AFTER: readonly { scene: string; open: OpenWindows }[] = [
    { scene: "the-mess", open: [true, true, true] },
    { scene: "open-tabmerger", open: [true, true, true] },
    // Window 1 is dragged into a new group; its last tab closes with the popup, so the window closes.
    { scene: "drag-to-new-group", open: [false, true, true] },
    // Saved-group work only: the browser windows are not drawn, but they are still open.
    { scene: "organise-tabs", open: [false, true, true] },
    { scene: "name-and-note", open: [false, true, true] },
    { scene: "find-a-tab", open: [false, true, true] },
    { scene: "restore-group", open: [false, true, true] },
    { scene: "share-group", open: [false, true, true] },
    { scene: "sync-devices", open: [false, true, true] },
    { scene: "closing-card", open: [false, true, true] }, // nothing is drawn
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

// Windows restored from a saved group, as drawn in the tour (scene 7 opens the two saved windows of
// Q4 Launch: Yahoo Mail + GitHub, and "Assets" with Dropbox). [first, second] = still open at the
// end of each scene. Scenes before the restore have none.
export type RestoredWindows = readonly [boolean, boolean];

export const TOUR_RESTORED_WINDOWS_AFTER: readonly { scene: string; restored: RestoredWindows }[] = [
    { scene: "the-mess", restored: [false, false] },
    { scene: "open-tabmerger", restored: [false, false] },
    { scene: "drag-to-new-group", restored: [false, false] },
    { scene: "organise-tabs", restored: [false, false] },
    { scene: "name-and-note", restored: [false, false] },
    { scene: "find-a-tab", restored: [false, false] },
    // Scene 7 draws them; they are still open in the story from scene 8 on, but scene 8 fades them out
    // and no later scene draws them.
    { scene: "restore-group", restored: [true, true] },
    { scene: "share-group", restored: [true, true] },
    // Still open in the story (real windows of this computer), not drawn.
    { scene: "sync-devices", restored: [true, true] },
    { scene: "closing-card", restored: [true, true] }, // nothing is drawn
];

/** Restored drawn windows open at the end of `scene`. */
export function restoredWindowsAfter(scene: string): RestoredWindows {
    const entry = TOUR_RESTORED_WINDOWS_AFTER.find((e) => e.scene === scene);
    if (!entry) throw new Error(`openWindows.ts has no restored-windows entry for scene "${scene}"`);
    return entry.restored;
}
