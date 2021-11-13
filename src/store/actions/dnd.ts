/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import { Combine } from "react-beautiful-dnd";
import { DND_ACTIONS } from "../reducers/dnd";

const updateDragOriginType = (payload: string) => ({ type: DND_ACTIONS.UPDATE_DRAG_ORIGIN_TYPE, payload });

const updateIsDragging = (payload: boolean) => ({ type: DND_ACTIONS.UPDATE_IS_DRAGGING, payload });

const updateCombineInfo = (payload?: Combine) => ({
  type: DND_ACTIONS.UPDATE_COMBINE_INFO,
  payload
});

const resetDnDInfo = () => ({ type: DND_ACTIONS.RESET_DND_INFO });

export default {
  updateDragOriginType,
  updateIsDragging,
  updateCombineInfo,
  resetDnDInfo
};
