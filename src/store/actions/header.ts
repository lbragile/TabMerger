import { TActionFunc } from "../../typings/reducers";
import { HEADER_ACTIONS, IHeaderState } from "../reducers/header";
import { createAction } from "../utils/actionCreator";

export const setTyping: TActionFunc<IHeaderState["typing"]> = (payload) => {
  return createAction<IHeaderState["typing"]>(HEADER_ACTIONS.SET_TYPING, payload);
};

export const updateInputValue: TActionFunc<IHeaderState["inputValue"]> = (payload) => {
  return createAction<IHeaderState["inputValue"]>(HEADER_ACTIONS.UPDATE_INPUT_VALUE, payload);
};
