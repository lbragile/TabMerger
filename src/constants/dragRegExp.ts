const TAB_DRAG_RE = /tab-\d+-window-\d+/i;
const WINDOW_DRAG_RE = /window-\d+-group-\d+/i;
const GROUP_DRAG_RE = /^group-\d+$/i;

export const isTabDrag = (draggableId: string): boolean => TAB_DRAG_RE.test(draggableId);
export const isWindowDrag = (draggableId: string): boolean => WINDOW_DRAG_RE.test(draggableId);
export const isGroupDrag = (draggableId: string): boolean => GROUP_DRAG_RE.test(draggableId);
