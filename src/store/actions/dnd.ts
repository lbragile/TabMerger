/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import { DND_ACTIONS } from "../reducers/dnd";

export const updateDragOriginType = (payload: string) => ({ type: DND_ACTIONS.UPDATE_DRAG_ORIGIN_TYPE, payload });
export const updateIsDragging = (payload: boolean) => ({ type: DND_ACTIONS.UPDATE_IS_DRAGGING, payload });
