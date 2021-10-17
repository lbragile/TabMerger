import { IAction } from "../../typings/reducers";
import { HEADER_ACTIONS, IHeaderState } from "../reducers/header";

type THeaderAction = IAction<IHeaderState>;
type TPayload = THeaderAction["payload"];

export function setTyping(payload: TPayload): THeaderAction {
  return { type: HEADER_ACTIONS.SET_TYPING, payload };
}

export function updateInputValue(payload: TPayload): THeaderAction {
  return { type: HEADER_ACTIONS.UPDATE_INPUT_VALUE, payload };
}
