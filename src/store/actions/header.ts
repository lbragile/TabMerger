import { HEADER_ACTIONS, IHeaderState, THeaderAction } from "../reducers/header";

type TDispatchType = keyof typeof HEADER_ACTIONS;

export function setTyping(payload: IHeaderState["typing"]): THeaderAction {
  return { type: HEADER_ACTIONS.SET_TYPING as TDispatchType, payload };
}

export function updateInputValue(payload: IHeaderState["inputValue"]): THeaderAction {
  return { type: HEADER_ACTIONS.UPDATE_INPUT_VALUE as TDispatchType, payload };
}
