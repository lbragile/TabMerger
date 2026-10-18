/**
 * Static attribute on every drag handle ("grip") of a tab, window or group row. The DnD sensor,
 * focus and visuals, the selection focus fallback and the guided tour find grips through it
 * instead of their accessible name, which is translated (`tab.dragToReorder` and friends).
 */
export const DND_GRIP_ATTR = 'data-dnd-grip';

export type DndGripKind = 'tab' | 'window' | 'group';

/** Any grip, or only the grips of one kind of row. */
export function dndGripSelector(kind?: DndGripKind): string {
    return kind ? `[${DND_GRIP_ATTR}="${kind}"]` : `[${DND_GRIP_ATTR}]`;
}
