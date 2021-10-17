import { IAction } from "../../typings/reducers";

export const HEADER_ACTIONS = {
  SET_TYPING: "SET_TYPING",
  UPDATE_INPUT_VALUE: "UPDATE_INPUT_VALUE"
};

export interface IHeaderState {
  typing: boolean;
  inputValue: string;
}

export type THeaderAction = IAction<typeof HEADER_ACTIONS>;

const initState: IHeaderState = { typing: false, inputValue: "" };

const headerReducer = (state = initState, action: THeaderAction): IHeaderState => {
  switch (action.type) {
    case HEADER_ACTIONS.SET_TYPING:
      return { ...state, typing: action.payload as IHeaderState["typing"] };

    case HEADER_ACTIONS.UPDATE_INPUT_VALUE:
      return { ...state, inputValue: action.payload as IHeaderState["inputValue"] };

    default:
      return state;
  }
};

export default headerReducer;
