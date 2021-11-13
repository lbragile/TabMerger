import { Combine } from "react-beautiful-dnd";
import { IAction } from "../../typings/reducers";

export const DND_ACTIONS = {
  UPDATE_DRAG_ORIGIN_TYPE: "UPDATE_DRAG_ORIGIN_TYPE",
  UPDATE_IS_DRAGGING: "UPDATE_IS_DRAGGING",
  UPDATE_COMBINE_INFO: "UPDATE_COMBINE_INFO",
  RESET_DND_INFO: "RESET_DND_INFO"
};

export interface IDnDState {
  dragType: string;
  isDragging: boolean;
  combine: Combine;
}

const initState: IDnDState = {
  dragType: "tab-0-window-0",
  isDragging: false,
  combine: { draggableId: "", droppableId: "" }
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

    case DND_ACTIONS.UPDATE_COMBINE_INFO:
      return {
        ...state,
        combine: payload as IDnDState["combine"]
      };

    case DND_ACTIONS.RESET_DND_INFO:
      return initState;

    default:
      return state;
  }
};

export default dndReducer;
