import type * as HEADER_CREATORS from "~/store/actions/header";
import type { TAction } from "~/typings/redux";

export const HEADER_ACTIONS = {
  UPDATE_INPUT_VALUE: "UPDATE_INPUT_VALUE",
  SET_FILTER_CHOICE: "SET_FILTER_CHOICE",
  SET_FOCUSED: "SET_FOCUSED",
  SET_SHOW_UNDO: "SET_SHOW_UNDO",
  UPDATE_UNDO_TIMER: "UPDATE_UNDO_TIMER"
} as const;

interface IHeaderState {
  inputValue: string;
  filterChoice: "tab" | "group";
  focused: boolean;
  showUndo: boolean;
  undoTimer: number;
}

export const initHeaderState: IHeaderState = {
  inputValue: "",
  filterChoice: "tab",
  focused: false,
  showUndo: false,
  undoTimer: 10
};

const headerReducer = (state = initHeaderState, action: TAction<typeof HEADER_CREATORS>): IHeaderState => {
  switch (action.type) {
    case HEADER_ACTIONS.UPDATE_INPUT_VALUE:
      return {
        ...state,
        inputValue: action.payload
      };

    case HEADER_ACTIONS.SET_FILTER_CHOICE:
      return {
        ...state,
        filterChoice: action.payload
      };

    case HEADER_ACTIONS.SET_FOCUSED:
      return {
        ...state,
        focused: action.payload
      };

    case HEADER_ACTIONS.SET_SHOW_UNDO:
      return {
        ...state,
        showUndo: action.payload,
        undoTimer: action.payload ? 10 : 0
      };

    case HEADER_ACTIONS.UPDATE_UNDO_TIMER:
      return {
        ...state,
        undoTimer: action.payload
      };

    default:
      return state;
  }
};

export default headerReducer;
