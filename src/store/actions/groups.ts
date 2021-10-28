/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import { GROUPS_ACTIONS } from "../reducers/groups";

export const updateActive = (payload: { id: string; index: number } | undefined) => ({
  type: GROUPS_ACTIONS.UPDATE_ACTIVE,
  payload
});

export const updateIndex = (payload: number | undefined) => ({ type: GROUPS_ACTIONS.UPDATE_INDEX, payload });

export const updateIsActive = (payload: boolean | undefined) => ({ type: GROUPS_ACTIONS.UPDATE_IS_ACTIVE, payload });

export const updateName = (payload: { index: number; name: string } | undefined) => ({
  type: GROUPS_ACTIONS.UPDATE_NAME,
  payload
});

export const updateColor = (payload: string | undefined) => ({ type: GROUPS_ACTIONS.UPDATE_COLOR, payload });

export const updateTimestamp = (payload: number | undefined) => ({ type: GROUPS_ACTIONS.UPDATE_TIMESTAMP, payload });

export const updateWindows = (payload: { index: number; windows: chrome.windows.Window[] } | undefined) => ({
  type: GROUPS_ACTIONS.UPDATE_WINDOWS,
  payload
});

export const updateInfo = (payload: { index: number; info: string | undefined } | undefined) => ({
  type: GROUPS_ACTIONS.UPDATE_INFO,
  payload
});

export const updatePermanent = (payload: boolean | undefined) => ({ type: GROUPS_ACTIONS.UPDATE_PERMANENT, payload });

export const addGroup = () => ({ type: GROUPS_ACTIONS.ADD_GROUP });

export const deleteGroup = (payload: { id: string; index: number } | undefined) => ({
  type: GROUPS_ACTIONS.DELETE_GROUP,
  payload
});
