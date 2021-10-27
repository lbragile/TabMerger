import { IAction } from "../../typings/reducers";

export const HEADER_ACTIONS = {
  SET_TYPING: "SET_TYPING",
  UPDATE_INPUT_VALUE: "UPDATE_INPUT_VALUE",
  SET_FILTER_CHOICE: "SET_FILTER_CHOICE"
};

export interface IHeaderState {
  typing: boolean;
  inputValue: string;
  filterChoice: {
    search: string;
    include: string;
  };
}

const initState: IHeaderState = {
  typing: false,
  inputValue: "",
  filterChoice: {
    search: "current",
    include: "tab"
  }
};

const headerReducer = (state = initState, action: IAction<IHeaderState>): IHeaderState => {
  const { type, payload } = action;

  switch (type) {
    case HEADER_ACTIONS.SET_TYPING:
      return { ...state, typing: payload.typing };

    case HEADER_ACTIONS.UPDATE_INPUT_VALUE: {
      return { ...state, inputValue: payload.inputValue };
    }

    case HEADER_ACTIONS.SET_FILTER_CHOICE: {
      return { ...state, filterChoice: payload.filterChoice };
    }

    default:
      return state;
  }
};

export default headerReducer;
