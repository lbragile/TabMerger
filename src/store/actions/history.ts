import type { IGroupsState } from "../reducers/groups";

import { HISTORY_ACTIONS } from "~/store/reducers/history";

export const setAnchorState = (payload: IGroupsState) => ({ type: HISTORY_ACTIONS.SET_ANCHOR_STATE, payload });

export const addAction = (payload: { type: string; payload?: unknown }) => ({
  type: HISTORY_ACTIONS.ADD_ACTION,
  payload
});

export const updatePosition = (payload: number) => ({ type: HISTORY_ACTIONS.UPDATE_POSITION, payload });
