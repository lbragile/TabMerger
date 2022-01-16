import { DraggableLocation } from "react-beautiful-dnd";

import { GROUPS_ACTIONS, IGroupsState, ISidePanelDnd } from "~/store/reducers/groups";

export const updateAvailable = (payload?: IGroupsState["available"]) => ({
  type: GROUPS_ACTIONS.UPDATE_AVAILABLE,
  payload
});

export const updateActive = (payload?: IGroupsState["active"]) => ({ type: GROUPS_ACTIONS.UPDATE_ACTIVE, payload });

export const updateName = (payload?: { index: number; name: string }) => ({
  type: GROUPS_ACTIONS.UPDATE_NAME,
  payload
});

export const updateColor = (payload?: { index: number; color: string }) => ({
  type: GROUPS_ACTIONS.UPDATE_COLOR,
  payload
});

export const updateTimestamp = (payload?: { index: number; updatedAt: number }) => ({
  type: GROUPS_ACTIONS.UPDATE_TIMESTAMP,
  payload
});

export const updateWindows = (payload?: { index: number; windows: chrome.windows.Window[] }) => ({
  type: GROUPS_ACTIONS.UPDATE_WINDOWS,
  payload
});

export const updateWindowsFromGroupDnd = (payload?: ISidePanelDnd) => ({
  type: GROUPS_ACTIONS.UPDATE_WINDOWS_FROM_GROUP_DND,
  payload
});

export const updateWindowsFromSidePanelDnd = (payload?: ISidePanelDnd) => ({
  type: GROUPS_ACTIONS.UPDATE_WINDOWS_FROM_SIDEPANEL_DND,
  payload
});

export const updateTabs = (payload?: { groupIdx: number; windowIdx: number; tabs: chrome.tabs.Tab[] }) => ({
  type: GROUPS_ACTIONS.UPDATE_TABS,
  payload
});

export const updateTabsFromGroupDnd = (payload?: ISidePanelDnd) => ({
  type: GROUPS_ACTIONS.UPDATE_TABS_FROM_GROUP_DND,
  payload
});

export const updateTabsFromSidePanelDnd = (payload?: ISidePanelDnd) => ({
  type: GROUPS_ACTIONS.UPDATE_TABS_FROM_SIDEPANEL_DND,
  payload
});

export const updateInfo = (payload?: { index: number; info?: string }) => ({
  type: GROUPS_ACTIONS.UPDATE_INFO,
  payload
});

export const addGroup = () => ({ type: GROUPS_ACTIONS.ADD_GROUP });

export const deleteGroup = (payload?: number) => ({ type: GROUPS_ACTIONS.DELETE_GROUP, payload });

export const deleteWindow = (payload?: { groupIndex: number; windowIndex: number }) => ({
  type: GROUPS_ACTIONS.DELETE_WINDOW,
  payload
});

export const deleteTab = (payload?: { tabIndex: number; windowIndex: number; groupIndex: number }) => ({
  type: GROUPS_ACTIONS.DELETE_TAB,
  payload
});

export const clearEmptyGroups = () => ({ type: GROUPS_ACTIONS.CLEAR_EMPTY_GROUPS });

export const addWindow = (payload?: { index: number }) => ({ type: GROUPS_ACTIONS.ADD_WINDOW, payload });

export const clearEmptyWindows = (payload?: { index: number }) => ({
  type: GROUPS_ACTIONS.CLEAR_EMPTY_WINDOWS,
  payload
});

export const updateGroupOrder = (payload?: { source: DraggableLocation; destination?: DraggableLocation }) => ({
  type: GROUPS_ACTIONS.UPDATE_GROUP_ORDER,
  payload
});

export const toggleWindowIncognito = (payload?: { windowIndex: number; groupIndex: number }) => ({
  type: GROUPS_ACTIONS.TOGGLE_WINDOW_INCOGNITO,
  payload
});

export const toggleWindowStarred = (payload?: { windowIndex: number; groupIndex: number }) => ({
  type: GROUPS_ACTIONS.TOGGLE_WINDOW_STARRED,
  payload
});

export const duplicateGroup = (payload?: number) => ({ type: GROUPS_ACTIONS.DUPLICATE_GROUP, payload });

export const replaceWithCurrent = (payload?: number) => ({ type: GROUPS_ACTIONS.REPLACE_WITH_CURRENT, payload });

export const mergeWithCurrent = (payload?: number) => ({ type: GROUPS_ACTIONS.MERGE_WITH_CURRENT, payload });

export const uniteWindows = (payload?: number) => ({ type: GROUPS_ACTIONS.UNITE_WINDOWS, payload });

export const splitWindows = (payload?: number) => ({ type: GROUPS_ACTIONS.SPLIT_WINDOWS, payload });

export const sortByTabTitle = (payload?: number) => ({ type: GROUPS_ACTIONS.SORT_BY_TAB_TITLE, payload });

export const sortByTabUrl = (payload?: number) => ({ type: GROUPS_ACTIONS.SORT_BY_TAB_URL, payload });
