import { IAction } from "../../typings/reducers";

export const HEADER_ACTIONS = {
  SET_TYPING: "SET_TYPING",
  UPDATE_INPUT_VALUE: "UPDATE_INPUT_VALUE"
};

export interface IHeaderState {
  typing: boolean;
  inputValue: string;
}

const initState: IHeaderState = { typing: false, inputValue: "" };

const headerReducer = (state = initState, action: IAction<IHeaderState>): IHeaderState => {
  switch (action.type) {
    case HEADER_ACTIONS.SET_TYPING:
      return { ...state, typing: action.payload };

    case HEADER_ACTIONS.UPDATE_INPUT_VALUE:
      return { ...state, inputValue: action.payload };

    default:
      return state;
  }
};

export default headerReducer;
