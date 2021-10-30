/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import { HEADER_ACTIONS } from "../reducers/header";

export const setTyping = (payload: boolean) => ({ type: HEADER_ACTIONS.SET_TYPING, payload });

export const updateInputValue = (payload: string) => ({ type: HEADER_ACTIONS.UPDATE_INPUT_VALUE, payload });

export const setFilterChoice = (payload: string) => ({ type: HEADER_ACTIONS.SET_FILTER_CHOICE, payload });
