import { TRootActions } from "~/typings/redux";

export const DND_ACTIONS = {
  UPDATE_DRAG_ORIGIN_TYPE: "UPDATE_DRAG_ORIGIN_TYPE",
  UPDATE_IS_DRAGGING: "UPDATE_IS_DRAGGING",
  RESET_DND_INFO: "RESET_DND_INFO"
} as const;

interface IDnDState {
  dragType: string;
  isDragging: boolean;
}

export const initDnDState: IDnDState = {
  dragType: "tab-0-window-0",
  isDragging: false
};

const dndReducer = (state = initDnDState, action: TRootActions): IDnDState => {
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
