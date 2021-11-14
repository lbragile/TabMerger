import { IAction } from "../../typings/reducers";

export const DND_ACTIONS = {
  UPDATE_DRAG_ORIGIN_TYPE: "UPDATE_DRAG_ORIGIN_TYPE",
  UPDATE_IS_DRAGGING: "UPDATE_IS_DRAGGING",
  UPDATE_DRAG_OVER_GROUP: "UPDATE_DRAG_OVER_GROUP",
  RESET_DND_INFO: "RESET_DND_INFO",
  UPDATE_CAN_DROP_GROUP: "UPDATE_CAN_DROP_GROUP"
};

export interface IDnDState {
  dragType: string;
  isDragging: boolean;
  dragOverGroup: number;
  canDrop: boolean;
}

const initState: IDnDState = {
  dragType: "tab-0-window-0",
  isDragging: false,
  dragOverGroup: 0,
  canDrop: true
};

const dndReducer = (state = initState, action: IAction): IDnDState => {
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

    case DND_ACTIONS.UPDATE_DRAG_OVER_GROUP:
      return {
        ...state,
        dragOverGroup: payload as IDnDState["dragOverGroup"]
      };

    case DND_ACTIONS.RESET_DND_INFO:
      return initState;

    case DND_ACTIONS.UPDATE_CAN_DROP_GROUP:
      return {
        ...state,
        canDrop: payload as IDnDState["canDrop"]
      };

    default:
      return state;
  }
};

export default dndReducer;
