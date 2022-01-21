import { HEADER_ACTIONS } from "~/store/reducers/header";

export const updateInputValue = (payload: string) => ({ type: HEADER_ACTIONS.UPDATE_INPUT_VALUE, payload });

export const setFilterChoice = (payload: "tab" | "group") => ({ type: HEADER_ACTIONS.SET_FILTER_CHOICE, payload });

export const setFocused = (payload: boolean) => ({ type: HEADER_ACTIONS.SET_FOCUSED, payload });

export const HEADER_CREATORS = {
  updateInputValue,
  setFilterChoice,
  setFocused
};
