import { HEADER_ACTIONS } from "~/store/reducers/header";

const setTyping = (payload: boolean) => ({ type: HEADER_ACTIONS.SET_TYPING, payload });

const updateInputValue = (payload: string) => ({ type: HEADER_ACTIONS.UPDATE_INPUT_VALUE, payload });

const setFilterChoice = (payload: string) => ({ type: HEADER_ACTIONS.SET_FILTER_CHOICE, payload });

export default {
  setTyping,
  updateInputValue,
  setFilterChoice
};
