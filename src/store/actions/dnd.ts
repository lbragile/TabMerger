/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import { DND_ACTIONS } from "../reducers/dnd";

const updateDragOriginType = (payload: string) => ({ type: DND_ACTIONS.UPDATE_DRAG_ORIGIN_TYPE, payload });

const updateIsDragging = (payload: boolean) => ({ type: DND_ACTIONS.UPDATE_IS_DRAGGING, payload });

const updateDragOverGroup = (payload: number) => ({ type: DND_ACTIONS.UPDATE_DRAG_OVER_GROUP, payload });

const resetDnDInfo = () => ({ type: DND_ACTIONS.RESET_DND_INFO });

export default {
  updateDragOriginType,
  updateIsDragging,
  updateDragOverGroup,
  resetDnDInfo
};
