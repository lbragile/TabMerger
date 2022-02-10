import type { Combine, DraggableLocation } from "react-beautiful-dnd";
import type { IGroupsState } from "~/store/reducers/groups";

import { GROUPS_ACTIONS } from "~/store/reducers/groups";

interface ICommonDnd {
  index: number;
  source: DraggableLocation;
}

interface IWithinGroupDnd extends ICommonDnd {
  destination?: DraggableLocation;
}

interface ISidePanelDnd extends ICommonDnd {
  combine?: Combine;
}

export const updateAvailable = (payload: IGroupsState["available"]) => ({
  type: GROUPS_ACTIONS.UPDATE_AVAILABLE,
  payload
});

export const updateActive = (payload: IGroupsState["active"]) => ({ type: GROUPS_ACTIONS.UPDATE_ACTIVE, payload });

export const updateColor = (payload: { index: number; color: string }) => ({
  type: GROUPS_ACTIONS.UPDATE_COLOR,
  payload
});

export const updateTimestamp = (payload: { index: number; updatedAt: number }) => ({
  type: GROUPS_ACTIONS.UPDATE_TIMESTAMP,
  payload
});

export const updateWindows = (payload: { index: number; windows: chrome.windows.Window[] }) => ({
  type: GROUPS_ACTIONS.UPDATE_WINDOWS,
  payload
});

export const updateWindowsFromGroupDnd = (payload: IWithinGroupDnd) => ({
  type: GROUPS_ACTIONS.UPDATE_WINDOWS_FROM_GROUP_DND,
  payload
});

export const updateWindowsFromSidePanelDnd = (payload: ISidePanelDnd) => ({
  type: GROUPS_ACTIONS.UPDATE_WINDOWS_FROM_SIDEPANEL_DND,
  payload
});

export const updateTabsFromGroupDnd = (payload: IWithinGroupDnd) => ({
  type: GROUPS_ACTIONS.UPDATE_TABS_FROM_GROUP_DND,
  payload
});

export const updateTabsFromSidePanelDnd = (payload: ISidePanelDnd & { name: string }) => ({
  type: GROUPS_ACTIONS.UPDATE_TABS_FROM_SIDEPANEL_DND,
  payload
});

export const updateInfo = (payload: { index: number; info?: string }) => ({
  type: GROUPS_ACTIONS.UPDATE_INFO,
  payload
});

export const addGroup = (payload: { color: string; title: string }) => ({ type: GROUPS_ACTIONS.ADD_GROUP, payload });

export const deleteGroup = (payload: { index: number }) => ({ type: GROUPS_ACTIONS.DELETE_GROUP, payload });

export const deleteWindow = (payload: { groupIndex: number; windowIndex: number }) => ({
  type: GROUPS_ACTIONS.DELETE_WINDOW,
  payload
});

export const deleteTab = (payload: { tabIndex: number; windowIndex: number; groupIndex: number }) => ({
  type: GROUPS_ACTIONS.DELETE_TAB,
  payload
});

export const clearEmptyGroups = (payload: { index: number; id: string }) => ({
  type: GROUPS_ACTIONS.CLEAR_EMPTY_GROUPS,
  payload
});

export const addWindow = (payload: { index: number; name: string }) => ({ type: GROUPS_ACTIONS.ADD_WINDOW, payload });

export const clearEmptyWindows = (payload: { index: number }) => ({
  type: GROUPS_ACTIONS.CLEAR_EMPTY_WINDOWS,
  payload
});

export const updateGroupOrder = (payload: { source: DraggableLocation; destination?: DraggableLocation }) => ({
  type: GROUPS_ACTIONS.UPDATE_GROUP_ORDER,
  payload
});

export const toggleWindowIncognito = (payload: { windowIndex: number; groupIndex: number }) => ({
  type: GROUPS_ACTIONS.TOGGLE_WINDOW_INCOGNITO,
  payload
});

export const toggleWindowStarred = (payload: { windowIndex: number; groupIndex: number }) => ({
  type: GROUPS_ACTIONS.TOGGLE_WINDOW_STARRED,
  payload
});

export const duplicateGroup = (payload: number) => ({ type: GROUPS_ACTIONS.DUPLICATE_GROUP, payload });

export const replaceWithCurrent = (payload: number) => ({ type: GROUPS_ACTIONS.REPLACE_WITH_CURRENT, payload });

export const mergeWithCurrent = (payload: number) => ({ type: GROUPS_ACTIONS.MERGE_WITH_CURRENT, payload });

export const uniteWindows = (payload: number) => ({ type: GROUPS_ACTIONS.UNITE_WINDOWS, payload });

export const splitWindows = (payload: number) => ({ type: GROUPS_ACTIONS.SPLIT_WINDOWS, payload });

export const sortByTabTitle = (payload: number) => ({ type: GROUPS_ACTIONS.SORT_BY_TAB_TITLE, payload });

export const sortByTabUrl = (payload: number) => ({ type: GROUPS_ACTIONS.SORT_BY_TAB_URL, payload });

export const updateGroupName = (payload: { groupIndex: number; name: string }) => ({
  type: GROUPS_ACTIONS.UPDATE_GROUP_NAME,
  payload
});

export const updateWindowName = (payload: { groupIndex: number; windowIndex: number; name: string }) => ({
  type: GROUPS_ACTIONS.UPDATE_WINDOW_NAME,
  payload
});
