import { DND_ACTIONS } from "~/store/reducers/dnd";

export const updateDragOriginType = (payload: string) => ({ type: DND_ACTIONS.UPDATE_DRAG_ORIGIN_TYPE, payload });

export const updateIsDragging = (payload: boolean) => ({ type: DND_ACTIONS.UPDATE_IS_DRAGGING, payload });

export const resetDnDInfo = () => ({ type: DND_ACTIONS.RESET_DND_INFO });
