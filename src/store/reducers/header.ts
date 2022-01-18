import { IAction } from "~/typings/reducers";

export const HEADER_ACTIONS = {
  UPDATE_INPUT_VALUE: "UPDATE_INPUT_VALUE",
  SET_FILTER_CHOICE: "SET_FILTER_CHOICE",
  SET_FOCUSED: "SET_FOCUSED"
};

export interface IHeaderState {
  inputValue: string;
  filterChoice: "tab" | "group";
  focused: boolean;
}

export const initHeaderState: IHeaderState = {
  inputValue: "",
  filterChoice: "tab",
  focused: false
};

const headerReducer = (state: IHeaderState, action: IAction): IHeaderState => {
  const { type, payload } = action;

  switch (type) {
    case HEADER_ACTIONS.UPDATE_INPUT_VALUE:
      return {
        ...state,
        inputValue: payload as IHeaderState["inputValue"]
      };

    case HEADER_ACTIONS.SET_FILTER_CHOICE:
      return {
        ...state,
        filterChoice: payload as IHeaderState["filterChoice"]
      };

    case HEADER_ACTIONS.SET_FOCUSED:
      return {
        ...state,
        focused: payload as boolean
      };

    default:
      return state;
  }
};

export default headerReducer;
