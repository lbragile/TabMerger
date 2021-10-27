import { TActionFunc } from "../../typings/reducers";
import { HEADER_ACTIONS, IHeaderState } from "../reducers/header";
import { createAction } from "../utils/actionCreator";

export const setTyping: TActionFunc<{ typing: IHeaderState["typing"] }> = (payload) => {
  return createAction<{ typing: IHeaderState["typing"] }>(HEADER_ACTIONS.SET_TYPING, payload);
};

export const updateInputValue: TActionFunc<{ inputValue: IHeaderState["inputValue"] }> = (payload) => {
  return createAction<{ inputValue: IHeaderState["inputValue"] }>(HEADER_ACTIONS.UPDATE_INPUT_VALUE, payload);
};

export const setFilterChoice: TActionFunc<{ filterChoice: IHeaderState["filterChoice"] }> = (payload) => {
  return createAction<{ filterChoice: IHeaderState["filterChoice"] }>(HEADER_ACTIONS.SET_FILTER_CHOICE, payload);
};
