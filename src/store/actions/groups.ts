/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import { DraggableLocation } from "react-beautiful-dnd";
import { GROUPS_ACTIONS, IGroupsState } from "../reducers/groups";

const updateAvailable = (payload?: IGroupsState["available"]) => ({
  type: GROUPS_ACTIONS.UPDATE_AVAILABLE,
  payload
});

const updateActive = (payload?: IGroupsState["active"]) => ({
  type: GROUPS_ACTIONS.UPDATE_ACTIVE,
  payload
});

const updateName = (payload?: { index: number; name: string }) => ({
  type: GROUPS_ACTIONS.UPDATE_NAME,
  payload
});

const updateColor = (payload?: { index: number; color: string }) => ({ type: GROUPS_ACTIONS.UPDATE_COLOR, payload });

const updateTimestamp = (payload?: { index: number; updatedAt: number }) => ({
  type: GROUPS_ACTIONS.UPDATE_TIMESTAMP,
  payload
});

const updateWindows = (payload?: { index: number; windows: chrome.windows.Window[] }) => ({
  type: GROUPS_ACTIONS.UPDATE_WINDOWS,
  payload
});

const updateWindowsFromDnd = (payload?: {
  index: number;
  dnd: { source: DraggableLocation; destination?: DraggableLocation };
  dragOverGroup: number;
}) => ({
  type: GROUPS_ACTIONS.UPDATE_WINDOWS_FROM_DND,
  payload
});

const updateTabs = (payload?: {
  index: number;
  source: DraggableLocation;
  destination?: DraggableLocation;
  dragOverGroup: number;
}) => ({
  type: GROUPS_ACTIONS.UPDATE_TABS,
  payload
});

const updateInfo = (payload?: { index: number; info?: string }) => ({
  type: GROUPS_ACTIONS.UPDATE_INFO,
  payload
});

const updatePermanent = (payload?: boolean) => ({ type: GROUPS_ACTIONS.UPDATE_PERMANENT, payload });

const addGroup = () => ({ type: GROUPS_ACTIONS.ADD_GROUP });

const deleteGroup = (payload?: { id: string; index: number }) => ({
  type: GROUPS_ACTIONS.DELETE_GROUP,
  payload
});

const clearEmptyGroups = () => ({ type: GROUPS_ACTIONS.CLEAR_EMPTY_GROUPS });

const addWindow = (payload?: { index: number }) => ({ type: GROUPS_ACTIONS.ADD_WINDOW, payload });

const clearEmptyWindows = (payload?: { index: number }) => ({
  type: GROUPS_ACTIONS.CLEAR_EMPTY_WINDOWS,
  payload
});

const updateGroupOrder = (payload?: { source: DraggableLocation; destination: DraggableLocation }) => ({
  type: GROUPS_ACTIONS.UPDATE_GROUP_ORDER,
  payload
});

export default {
  updateAvailable,
  updateActive,
  updateName,
  updateColor,
  updateTimestamp,
  updateWindows,
  updateWindowsFromDnd,
  updateTabs,
  updateInfo,
  updatePermanent,
  addGroup,
  deleteGroup,
  clearEmptyGroups,
  addWindow,
  clearEmptyWindows,
  updateGroupOrder
};
