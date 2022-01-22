import { TRootActions } from "~/typings/reducers";

export const HEADER_ACTIONS = {
  UPDATE_INPUT_VALUE: "UPDATE_INPUT_VALUE",
  SET_FILTER_CHOICE: "SET_FILTER_CHOICE",
  SET_FOCUSED: "SET_FOCUSED"
} as const;

interface IHeaderState {
  inputValue: string;
  filterChoice: "tab" | "group";
  focused: boolean;
}

export const initHeaderState: IHeaderState = {
  inputValue: "",
  filterChoice: "tab",
  focused: false
};

const headerReducer = (state: IHeaderState, action: TRootActions): IHeaderState => {
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

    default:
      return state;
  }
};

export default headerReducer;
