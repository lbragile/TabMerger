import { IAction } from "~/typings/reducers";

export const DND_ACTIONS = {
  UPDATE_DRAG_ORIGIN_TYPE: "UPDATE_DRAG_ORIGIN_TYPE",
  UPDATE_IS_DRAGGING: "UPDATE_IS_DRAGGING",
  RESET_DND_INFO: "RESET_DND_INFO"
};

export interface IDnDState {
  dragType: string;
  isDragging: boolean;
}

export const initDnDState: IDnDState = {
  dragType: "tab-0-window-0",
  isDragging: false
};

const dndReducer = (state: IDnDState, action: IAction): IDnDState => {
  const { type, payload } = action;

  switch (type) {
    case DND_ACTIONS.UPDATE_DRAG_ORIGIN_TYPE:
      return {
        ...state,
        dragType: payload as IDnDState["dragType"]
      };

    case DND_ACTIONS.UPDATE_IS_DRAGGING:
      return {
        ...state,
        isDragging: payload as IDnDState["isDragging"]
      };

    case DND_ACTIONS.RESET_DND_INFO:
      return initDnDState;

    default:
      return state;
  }
};

export default dndReducer;
