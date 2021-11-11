import { IAction } from "../../typings/reducers";

export const DND_ACTIONS = {
  UPDATE_DRAG_ORIGIN_TYPE: "UPDATE_DRAG_ORIGIN_TYPE",
  UPDATE_IS_DRAGGING: "UPDATE_IS_DRAGGING"
};

export interface IDnDState {
  type: string;
  isDragging: boolean;
}

const initState: IDnDState = {
  type: "",
  isDragging: false
};

const dndReducer = (state = initState, action: IAction): IDnDState => {
  const { type, payload } = action;

  switch (type) {
    case DND_ACTIONS.UPDATE_DRAG_ORIGIN_TYPE:
      return {
        ...state,
        type: payload as IDnDState["type"]
      };

    case DND_ACTIONS.UPDATE_IS_DRAGGING:
      return {
        ...state,
        isDragging: payload as IDnDState["isDragging"]
      };

    default:
      return state;
  }
};

export default dndReducer;
