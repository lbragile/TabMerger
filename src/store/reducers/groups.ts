import { IAction } from "../../typings/reducers";
import { nanoid } from "nanoid";
import { DraggableLocation } from "react-beautiful-dnd";

export const GROUPS_ACTIONS = {
  UPDATE_AVAILABLE: "UPDATE_AVAILABLE",
  UPDATE_ACTIVE: "UPDATE_ACTIVE",
  UPDATE_INDEX: "UPDATE_INDEX",
  UPDATE_IS_ACTIVE: "UPDATE_IS_ACTIVE",
  UPDATE_NAME: "UPDATE_NAME",
  UPDATE_COLOR: "UPDATE_COLOR",
  UPDATE_TIMESTAMP: "UPDATE_TIMESTAMP",
  UPDATE_WINDOWS: "UPDATE_WINDOWS",
  UPDATE_TABS: "UPDATE_TABS",
  UPDATE_PERMANENT: "UPDATE_PERMANENT",
  UPDATE_INFO: "UPDATE_INFO",
  ADD_GROUP: "ADD_GROUP",
  ADD_WINDOW: "ADD_WINDOW",
  DELETE_GROUP: "DELETE_GROUP",
  CLEAR_EMPTY_GROUPS: "CLEAR_EMPTY_GROUPS",
  CLEAR_EMPTY_WINDOWS: "CLEAR_EMPTY_WINDOWS",
  UPDATE_GROUP_ORDER: "UPDATE_GROUP_ORDER"
};

export interface IGroupState {
  name: string;
  id: string;
  color: string;
  updatedAt: number;
  windows: chrome.windows.Window[];
  permanent?: boolean;
  info?: string;
}

export interface IGroupsState {
  active: { id: string; index: number };
  available: IGroupState[];
}

const createWindowWithTabs = (tabs: chrome.tabs.Tab[]): chrome.windows.Window => ({
  alwaysOnTop: false,
  focused: false,
  incognito: false,
  state: "maximized",
  type: "normal",
  tabs
});

const activeId = nanoid(10);
const initState: IGroupsState = {
  active: { id: activeId, index: 0 },
  available: [
    {
      name: "Awaiting Storage",
      id: activeId,
      color: "rgba(128, 128, 128, 1)",
      updatedAt: Date.now(),
      windows: [],
      permanent: true
    },
    {
      name: "Duplicates",
      id: nanoid(10),
      color: "rgba(128, 128, 128, 1)",
      updatedAt: Date.now(),
      windows: [],
      permanent: true
    }
  ]
};

const GroupsReducer = (state = initState, action: IAction): IGroupsState => {
  const available = [...state.available];

  switch (action.type) {
    case GROUPS_ACTIONS.UPDATE_AVAILABLE:
      return {
        ...state,
        available: action.payload as IGroupsState["available"]
      };

    case GROUPS_ACTIONS.UPDATE_ACTIVE:
      return {
        ...state,
        active: action.payload as IGroupsState["active"]
      };

    case GROUPS_ACTIONS.UPDATE_NAME: {
      const { index, name } = action.payload as { index: number; name: string };
      available[index].name = name;

      return {
        ...state,
        available
      };
    }

    case GROUPS_ACTIONS.UPDATE_COLOR: {
      const { index, color } = action.payload as { index: number; color: string };
      available[index].color = color;

      return {
        ...state,
        available
      };
    }

    case GROUPS_ACTIONS.UPDATE_TIMESTAMP: {
      const { index, updatedAt } = action.payload as { index: number; updatedAt: number };
      available[index].updatedAt = updatedAt;

      return {
        ...state,
        available
      };
    }

    case GROUPS_ACTIONS.UPDATE_WINDOWS: {
      const { index, windows, dnd, dragOverGroup } = action.payload as {
        index: number;
        dnd?: { source: DraggableLocation; destination?: DraggableLocation };
        windows?: chrome.windows.Window[];
        dragOverGroup: number;
      };

      if (windows) {
        available[index].windows = windows;
      } else if (dnd) {
        const { source, destination } = dnd;
        const currentWindows = available[index].windows;

        if (destination) {
          // destination exists if not dragging over a group ...
          // ... (since it is droppable disabled for window/tab draggable)
          // swap windows based on dnd information
          const temp = currentWindows[source.index];
          currentWindows[source.index] = currentWindows[destination.index];
          currentWindows[destination.index] = temp;
        } else if (dragOverGroup > 1) {
          // only possible if dragging a window over a group item ...
          // ... remove source window, add it to new group at the top (make sure all windows are unfocused)
          const removedWindows = currentWindows.splice(source.index, 1).map((item) => {
            item.focused = false;
            return item;
          });
          available[dragOverGroup].windows.unshift(...removedWindows);
        }
      }

      return {
        ...state,
        available
      };
    }

    case GROUPS_ACTIONS.UPDATE_TABS: {
      const { index, source, destination, dragOverGroup } = action.payload as {
        index: number;
        source: DraggableLocation;
        destination?: DraggableLocation;
        dragOverGroup: number;
      };

      const { windows } = available[index];
      const srcWindowIdx = Number(source.droppableId.split("-")[1]);
      if (destination || dragOverGroup > 1) {
        const removedTabs = windows[srcWindowIdx].tabs?.splice(source.index, 1);
        if (removedTabs) {
          if (destination) {
            // destination exists if not dragging over a group ...
            // ... (since it is droppable disabled for window/tab draggable)
            const destWindowIdx = Number(destination.droppableId.split("-")[1]);
            windows[destWindowIdx].tabs?.splice(destination.index, 0, ...removedTabs);
          } else if (dragOverGroup > 1) {
            // only possible if dragging a tab over a group item ...
            // ... remove source tab, add it to new group in a new window at the top
            const newWindow = createWindowWithTabs(removedTabs);
            available[dragOverGroup].windows.unshift(newWindow);
          }
        }
      }

      return {
        ...state,
        available
      };
    }

    case GROUPS_ACTIONS.UPDATE_PERMANENT: {
      const { index, permanent } = action.payload as { index: number; permanent: boolean };
      available[index].permanent = permanent;

      return {
        ...state,
        available
      };
    }

    case GROUPS_ACTIONS.UPDATE_INFO: {
      const { index, info } = action.payload as { index: number; info: string };
      available[index].info = info;

      return {
        ...state,
        available
      };
    }

    case GROUPS_ACTIONS.ADD_GROUP: {
      const NEW_GROUP: IGroupState = {
        name: "No Name",
        id: nanoid(10),
        color: "rgba(128, 128, 128, 1)",
        updatedAt: Date.now(),
        windows: [],
        permanent: false,
        info: "0T | 0W"
      };

      available.push(NEW_GROUP);

      return {
        ...state,
        available
      };
    }

    case GROUPS_ACTIONS.DELETE_GROUP: {
      const { index } = action.payload as { index: number };
      available.splice(index, 1);

      // re-assign active group if deleted group was the active one (use the group above if needed)
      const activeIdx = state.active.index;
      const newIdx = activeIdx === index ? index - 1 : activeIdx;

      return {
        ...state,
        active: { index: newIdx, id: available[newIdx].id },
        available
      };
    }

    case GROUPS_ACTIONS.CLEAR_EMPTY_GROUPS: {
      const filteredGroups = available.filter((group, i) => i <= 1 || (i > 1 && group.windows.length > 0));
      const filteredIds = filteredGroups.map((group) => group.id);

      // if filtered groups do not contain the active group, it was deleted, thus can assign the group above as active ...
      // ... as it is not the source of the dnd event - must be non-empty.
      const { index, id } = state.active;
      const newIdx = Math.min(0, index - 1);
      const active = !filteredIds.includes(id) ? { index: newIdx, id: available[newIdx].id } : { ...state.active };

      return {
        ...state,
        available: filteredGroups,
        active
      };
    }

    case GROUPS_ACTIONS.ADD_WINDOW: {
      const { index } = action.payload as { index: number };
      available[index].windows.push(createWindowWithTabs([]));

      return {
        ...state,
        available
      };
    }

    case GROUPS_ACTIONS.CLEAR_EMPTY_WINDOWS: {
      const { index } = action.payload as { index: number };
      const { windows } = available[index] ?? {};

      // possible to have cleaned up the group (by removing all of its tabs) ...
      // ... now the above index has already been cleared, so the window won't exist ...
      // ... this should not happen, but is a good "safety guard"
      if (Object.values(windows).length > 0) {
        const newWindows = windows.filter(({ tabs }) => {
          const numTabs = tabs?.length;
          return numTabs !== undefined && numTabs > 0;
        });

        available[index].windows = newWindows;
      }

      return {
        ...state,
        available
      };
    }

    case GROUPS_ACTIONS.UPDATE_GROUP_ORDER: {
      const { source, destination } = action.payload as { source: DraggableLocation; destination: DraggableLocation };

      const removedGroups = available.splice(source.index, 1);
      if (removedGroups) {
        available.splice(destination.index, 0, ...removedGroups);
      }

      return {
        ...state,
        available
      };
    }

    default:
      return state;
  }
};

export default GroupsReducer;
