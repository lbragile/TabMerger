import { nanoid } from "nanoid";

import type { Combine, DraggableLocation } from "react-beautiful-dnd";
import type * as GROUPS_CREATORS from "~/store/actions/groups";
import type { TAction } from "~/typings/redux";

import { DEFAULT_GROUP_COLOR, FIRST_GROUP_TITLE } from "~/constants/defaults";
import { createGroup, createWindowWithTabs } from "~/utils/helper";

export const GROUPS_ACTIONS = {
  UPDATE_AVAILABLE: "UPDATE_AVAILABLE",
  UPDATE_ACTIVE: "UPDATE_ACTIVE",
  UPDATE_COLOR: "UPDATE_COLOR",
  UPDATE_INFO: "UPDATE_INFO",
  UPDATE_TIMESTAMP: "UPDATE_TIMESTAMP",
  UPDATE_WINDOWS: "UPDATE_WINDOWS",
  UPDATE_WINDOWS_FROM_GROUP_DND: "UPDATE_WINDOWS_FROM_GROUP_DND",
  UPDATE_WINDOWS_FROM_SIDEPANEL_DND: "UPDATE_WINDOWS_FROM_SIDEPANEL_DND",
  UPDATE_TABS: "UPDATE_TABS",
  UPDATE_TABS_FROM_GROUP_DND: "UPDATE_TABS_FROM_GROUP_DND",
  UPDATE_TABS_FROM_SIDEPANEL_DND: "UPDATE_TABS_FROM_SIDEPANEL_DND",
  ADD_GROUP: "ADD_GROUP",
  ADD_WINDOW: "ADD_WINDOW",
  DELETE_GROUP: "DELETE_GROUP",
  DELETE_WINDOW: "DELETE_WINDOW",
  DELETE_TAB: "DELETE_TAB",
  CLEAR_EMPTY_GROUPS: "CLEAR_EMPTY_GROUPS",
  CLEAR_EMPTY_WINDOWS: "CLEAR_EMPTY_WINDOWS",
  UPDATE_GROUP_ORDER: "UPDATE_GROUP_ORDER",
  TOGGLE_WINDOW_INCOGNITO: "TOGGLE_WINDOW_INCOGNITO",
  TOGGLE_WINDOW_STARRED: "TOGGLE_WINDOW_STARRED",
  DUPLICATE_GROUP: "DUPLICATE_GROUP",
  REPLACE_WITH_CURRENT: "REPLACE_WITH_CURRENT",
  MERGE_WITH_CURRENT: "MERGE_WITH_CURRENT",
  UNITE_WINDOWS: "UNITE_WINDOWS",
  SPLIT_WINDOWS: "SPLIT_WINDOWS",
  SORT_BY_TAB_TITLE: "SORT_BY_TAB_TITLE",
  SORT_BY_TAB_URL: "SORT_BY_TAB_URL",
  UPDATE_GROUP_NAME: "UPDATE_GROUP_NAME",
  UPDATE_WINDOW_NAME: "UPDATE_WINDOW_NAME"
} as const;

interface ICommonDnd {
  index: number;
  source: DraggableLocation;
}

export interface ISidePanelDnd extends ICommonDnd {
  combine?: Combine;
}

export interface IGroupItemState {
  name: string;
  id: string;
  color: string;
  updatedAt: number;
  windows: (chrome.windows.Window & { starred?: boolean; name?: string })[];
  permanent?: boolean;
  info?: string;
}

export interface IGroupsState {
  active: { id: string; index: number };
  available: IGroupItemState[];
}

const activeId = nanoid(10);

export const initGroupsState: IGroupsState = {
  active: { id: activeId, index: 0 },
  available: [
    {
      name: FIRST_GROUP_TITLE,
      id: activeId,
      color: DEFAULT_GROUP_COLOR,
      updatedAt: Date.now(),
      windows: [],
      permanent: true
    }
  ]
};

const groupsReducer = (state = initGroupsState, action: TAction<typeof GROUPS_CREATORS>): IGroupsState => {
  const available = JSON.parse(JSON.stringify(state.available)) as IGroupItemState[];

  switch (action.type) {
    case GROUPS_ACTIONS.UPDATE_AVAILABLE:
      return {
        ...state,
        available: action.payload
      };

    case GROUPS_ACTIONS.UPDATE_ACTIVE:
      return {
        ...state,
        active: action.payload
      };

    case GROUPS_ACTIONS.UPDATE_COLOR: {
      const { index, color } = action.payload;
      available[index].color = color;
      available[index].updatedAt = Date.now();

      return { ...state, available };
    }

    case GROUPS_ACTIONS.UPDATE_TIMESTAMP: {
      const { index, updatedAt } = action.payload;
      available[index].updatedAt = updatedAt;

      return { ...state, available };
    }

    case GROUPS_ACTIONS.UPDATE_WINDOWS: {
      const { index, windows } = action.payload;

      available[index].windows = windows;
      available[index].updatedAt = Date.now();

      return { ...state, available };
    }

    case GROUPS_ACTIONS.UPDATE_WINDOWS_FROM_GROUP_DND: {
      const { index, source, destination } = action.payload;

      if (destination) {
        const removedWindows = available[index].windows.splice(source.index, 1);
        available[index].windows.splice(destination.index, 0, ...removedWindows);
        available[index].updatedAt = Date.now();

        // Need to toggle starred state depending on direction of drag
        const compareIdx = destination.index + Math.sign(source.index - destination.index);
        available[index].windows[destination.index].starred = !!available[index].windows[compareIdx]?.starred;
      }

      return { ...state, available };
    }

    case GROUPS_ACTIONS.UPDATE_WINDOWS_FROM_SIDEPANEL_DND: {
      const { index, source, combine } = action.payload;

      if (combine) {
        const groupIdx = Number(combine.draggableId.split("-")[1]);
        const removedWindows = available[index].windows.splice(source.index, 1);
        removedWindows.forEach((w) => {
          w.focused = false;
          w.starred = false;
        });
        available[groupIdx].windows.unshift(...removedWindows);

        // Sort windows so that favorites are on top
        available[groupIdx].windows = available[groupIdx].windows
          .filter((w) => w.starred)
          .concat(available[groupIdx].windows.filter((w) => !w.starred));

        available[index].updatedAt = Date.now();
        available[groupIdx].updatedAt = Date.now();
      }

      return { ...state, available };
    }

    case GROUPS_ACTIONS.UPDATE_TABS: {
      const { groupIdx, windowIdx, tabs } = action.payload;

      available[groupIdx].windows[windowIdx].tabs = tabs;
      available[groupIdx].updatedAt = Date.now();

      return { ...state, available };
    }

    case GROUPS_ACTIONS.UPDATE_TABS_FROM_GROUP_DND: {
      const { index, source, destination } = action.payload;

      if (destination) {
        const [srcWindowIdx, destWindowIdx] = [source, destination].map((item) =>
          Number(item.droppableId.split("-")[1])
        );

        const removedTabs = available[index].windows[srcWindowIdx].tabs?.splice(source.index, 1);
        available[index].windows[destWindowIdx].tabs?.splice(destination.index, 0, ...(removedTabs ?? []));

        available[index].updatedAt = Date.now();
      }

      return { ...state, available };
    }

    case GROUPS_ACTIONS.UPDATE_TABS_FROM_SIDEPANEL_DND: {
      const { index, source, combine, name } = action.payload;

      if (combine) {
        const srcWindowIdx = Number(source.droppableId.split("-")[1]);
        const groupIdx = Number(combine.draggableId.split("-")[1]);

        const removedTabs = available[index].windows[srcWindowIdx].tabs?.splice(source.index, 1);
        const newWindow = createWindowWithTabs(removedTabs ?? [], name);
        available[groupIdx].windows.unshift(newWindow);

        // Sort windows so that favorites are on top
        available[groupIdx].windows = available[groupIdx].windows
          .filter((w) => w.starred)
          .concat(available[groupIdx].windows.filter((w) => !w.starred));

        available[index].updatedAt = Date.now();
        available[groupIdx].updatedAt = Date.now();
      }

      return { ...state, available };
    }

    case GROUPS_ACTIONS.UPDATE_INFO: {
      const { index, info } = action.payload;
      available[index].info = info;

      return { ...state, available };
    }

    case GROUPS_ACTIONS.ADD_GROUP: {
      const { color, title } = action.payload;

      available.push(createGroup(nanoid(10), title, color));

      return { ...state, available };
    }

    case GROUPS_ACTIONS.DELETE_GROUP: {
      const { index } = action.payload;

      // Re-assign active group if deleted group was the active one (use the group above if needed)
      const activeIdx = state.active.index;

      const newActive =
        activeIdx < index
          ? { ...state.active }
          : activeIdx === index
          ? { index: activeIdx - 1, id: available[activeIdx - 1].id }
          : { ...state.active, index: activeIdx - 1 };

      available.splice(index, 1);

      return { active: newActive, available };
    }

    case GROUPS_ACTIONS.DELETE_WINDOW: {
      const { groupIndex, windowIndex } = action.payload;

      available[groupIndex].windows.splice(windowIndex, 1);
      available[groupIndex].updatedAt = Date.now();

      return { ...state, available };
    }

    case GROUPS_ACTIONS.DELETE_TAB: {
      const { groupIndex, windowIndex, tabIndex } = action.payload;

      available[groupIndex].windows[windowIndex].tabs?.splice(tabIndex, 1);
      available[groupIndex].updatedAt = Date.now();

      return { ...state, available };
    }

    case GROUPS_ACTIONS.CLEAR_EMPTY_GROUPS: {
      const filteredGroups = available.filter((group, i) => i === 0 || (i > 0 && group.windows.length > 0));
      const filteredIds = filteredGroups.map((group) => group.id);

      // If filtered groups do not contain the active group, it was deleted, thus can assign the group above as active ...
      // ... as it is not the source of the dnd event - must be non-empty.
      const { index, id } = state.active;
      const newIdx = Math.max(0, index - 1);
      const newActive = !filteredIds.includes(id) ? { index: newIdx, id: available[newIdx].id } : { ...state.active };

      return { available: filteredGroups, active: newActive };
    }

    case GROUPS_ACTIONS.ADD_WINDOW: {
      const { index, name } = action.payload;

      available[index].windows.push(createWindowWithTabs([], name));

      return { ...state, available };
    }

    case GROUPS_ACTIONS.CLEAR_EMPTY_WINDOWS: {
      const { index } = action.payload;

      // Possible to have cleaned up the group (by removing all of its tabs) ...
      // ... now the above index has already been cleared, so the window won't exist ...
      // ... this should not happen, but is a good "safety guard"
      if (available[index].windows.length > 0) {
        available[index].windows = available[index].windows.filter(({ tabs }) => tabs && tabs.length > 0);
      }

      return { ...state, available };
    }

    case GROUPS_ACTIONS.UPDATE_GROUP_ORDER: {
      const { source, destination } = action.payload;

      let newActive = { ...state.active };

      if (destination) {
        const removedGroups = available.splice(source.index, 1);
        available.splice(destination.index, 0, ...removedGroups);

        // Make the dragged group active
        newActive = { id: removedGroups[0].id, index: destination.index };
      }

      return { active: newActive, available };
    }

    case GROUPS_ACTIONS.TOGGLE_WINDOW_INCOGNITO: {
      const { groupIndex, windowIndex } = action.payload;

      available[groupIndex].windows[windowIndex].incognito = !available[groupIndex].windows[windowIndex].incognito;
      available[groupIndex].updatedAt = Date.now();

      return { ...state, available };
    }

    case GROUPS_ACTIONS.TOGGLE_WINDOW_STARRED: {
      const { groupIndex, windowIndex } = action.payload;

      available[groupIndex].windows[windowIndex].starred = !available[groupIndex].windows[windowIndex].starred;

      // Place starred windows above regular windows
      available[groupIndex].windows = available[groupIndex].windows
        .filter((w) => w.starred)
        .concat(available[groupIndex].windows.filter((w) => !w.starred));

      available[groupIndex].updatedAt = Date.now();

      return { ...state, available };
    }

    case GROUPS_ACTIONS.DUPLICATE_GROUP: {
      const groupIndex = action.payload;

      // Make sure to deep clone the group
      available.splice(groupIndex, 0, JSON.parse(JSON.stringify(available[groupIndex])));

      // Assign new id to avoid having the same group
      available[groupIndex + 1].id = nanoid(10);

      // Update the timestamp in the new group (original group does not need to update this as nothing changed)
      available[groupIndex + 1].updatedAt = Date.now();

      if (groupIndex === 0) {
        // Make sure new group is not permanent
        available[1].permanent = false;

        // Unfocus all windows in new group (first one will be focused in the `Now Open` group)
        available[1].windows[0].focused = false;
      }

      return { ...state, available };
    }

    case GROUPS_ACTIONS.REPLACE_WITH_CURRENT: {
      const groupIndex = action.payload;

      // Overwrite the windows with the default group, then unfocus all the windows in the group
      available[groupIndex].windows = JSON.parse(JSON.stringify(available[0].windows));
      available[groupIndex].windows.forEach((w) => (w.focused = false));

      available[groupIndex].updatedAt = Date.now();

      return { ...state, available };
    }

    case GROUPS_ACTIONS.MERGE_WITH_CURRENT: {
      const groupIndex = action.payload;

      // Place merged windows first in the group then unfocus the newly merged windows
      available[groupIndex].windows = JSON.parse(JSON.stringify(available[0].windows)).concat(
        available[groupIndex].windows
      );
      available[groupIndex].windows.forEach((w) => (w.focused = false));

      available[groupIndex].updatedAt = Date.now();

      return { ...state, available };
    }

    case GROUPS_ACTIONS.UNITE_WINDOWS: {
      const groupIndex = action.payload;

      const allTabsInGroup = available[groupIndex].windows.flatMap((w) => w.tabs ?? []);
      const firstWindow = available[groupIndex].windows[0];
      firstWindow.tabs = allTabsInGroup;
      available[groupIndex].windows = [firstWindow];

      available[groupIndex].updatedAt = Date.now();

      return { ...state, available };
    }

    case GROUPS_ACTIONS.SPLIT_WINDOWS: {
      const groupIndex = action.payload;

      const allTabsInGroup = available[groupIndex].windows.flatMap((w) => w.tabs ?? []);
      available[groupIndex].windows = allTabsInGroup.map((tab) => createWindowWithTabs([tab]));

      available[groupIndex].updatedAt = Date.now();

      return { ...state, available };
    }

    case GROUPS_ACTIONS.SORT_BY_TAB_TITLE: {
      const groupIndex = action.payload;

      available[groupIndex].windows.forEach((w) =>
        w.tabs?.sort((a, b) => (a?.title && b?.title ? a.title.localeCompare(b.title) : 0))
      );

      available[groupIndex].updatedAt = Date.now();

      return { ...state, available };
    }

    case GROUPS_ACTIONS.SORT_BY_TAB_URL: {
      const groupIndex = action.payload;

      available[groupIndex].windows.forEach((w) =>
        w.tabs?.sort((a, b) => (a?.url && b?.url ? a.url.localeCompare(b.url) : 0))
      );

      available[groupIndex].updatedAt = Date.now();

      return { ...state, available };
    }

    case GROUPS_ACTIONS.UPDATE_GROUP_NAME: {
      const { groupIndex, name } = action.payload;
      available[groupIndex].name = name;
      available[groupIndex].updatedAt = Date.now();

      return { ...state, available };
    }

    case GROUPS_ACTIONS.UPDATE_WINDOW_NAME: {
      const { groupIndex, windowIndex, name } = action.payload;

      available[groupIndex].windows[windowIndex].name = name;

      available[groupIndex].updatedAt = Date.now();

      return { ...state, available };
    }

    default:
      return state;
  }
};

export default groupsReducer;
