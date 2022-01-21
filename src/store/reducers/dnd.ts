import { TRootActions } from "~/typings/reducers";

export const DND_ACTIONS = {
  UPDATE_DRAG_ORIGIN_TYPE: "updateDragOriginType",
  UPDATE_IS_DRAGGING: "updateIsDragging",
  RESET_DND_INFO: "resetDnDInfo"
} as const;

interface IDnDState {
  dragType: string;
  isDragging: boolean;
}

export const initDnDState: IDnDState = {
  dragType: "tab-0-window-0",
  isDragging: false
};

const dndReducer = (state: IDnDState, action: TRootActions): IDnDState => {
  switch (action.type) {
    case DND_ACTIONS.UPDATE_DRAG_ORIGIN_TYPE:
      return {
        ...state,
        dragType: action.payload
      };

    case DND_ACTIONS.UPDATE_IS_DRAGGING:
      return {
        ...state,
        isDragging: action.payload
      };

    case DND_ACTIONS.RESET_DND_INFO:
      return initDnDState;

    default:
      return state;
  }
};

export default dndReducer;
