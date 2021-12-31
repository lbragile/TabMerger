import { DND_ACTIONS } from "~/store/reducers/dnd";

const updateDragOriginType = (payload: string) => ({ type: DND_ACTIONS.UPDATE_DRAG_ORIGIN_TYPE, payload });

const updateIsDragging = (payload: boolean) => ({ type: DND_ACTIONS.UPDATE_IS_DRAGGING, payload });

const resetDnDInfo = () => ({ type: DND_ACTIONS.RESET_DND_INFO });

export default {
  updateDragOriginType,
  updateIsDragging,
  resetDnDInfo
};
