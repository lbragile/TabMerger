import { IAction } from "../../typings/reducers";
import { nanoid } from "nanoid";
import { DraggableLocation } from "react-beautiful-dnd";

export const GROUPS_ACTIONS = {
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
  DELETE_GROUP: "DELETE_GROUP"
};

export interface IGroupState {
  isActive: boolean;
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

// id & updatedAt are set upon creation to ensure uniqueness/correctness
const DEFAULT_GROUP: IGroupState = {
  isActive: false,
  name: "No Name",
  id: "",
  color: "#808080",
  updatedAt: 0,
  windows: [],
  permanent: false,
  info: "0T | 0W"
};

const createWindowWithTabs = (tabs: chrome.tabs.Tab[]): chrome.windows.Window => ({
  alwaysOnTop: false,
  focused: false,
  incognito: false,
  state: "maximized",
  type: "normal",
  tabs
});

const initState: IGroupsState = {
  active: { id: nanoid(10), index: 0 },
  available: [
    {
      isActive: true,
      name: "Awaiting Storage",
      id: nanoid(10),
      color: "#808080",
      updatedAt: Date.now(),
      windows: [],
      permanent: true
    },
    {
      isActive: false,
      name: "Duplicates",
      id: nanoid(10),
      color: "#808080",
      updatedAt: Date.now(),
      windows: [],
      permanent: true
    }
  ]
};

const GroupsReducer = (state = initState, action: IAction): IGroupsState => {
  const available = [...state.available];

  switch (action.type) {
    case GROUPS_ACTIONS.UPDATE_ACTIVE: {
      const active = action.payload as IGroupsState["active"];

      // set all to in-active, then set selection to active
      available.forEach((group) => (group.isActive = false));
      available[active.index].isActive = true;

      return {
        ...state,
        active,
        available
      };
    }

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

          // source window became empty? clear it
          if (windows[srcWindowIdx].tabs?.length === 0) {
            available[index].windows.splice(srcWindowIdx, 1);
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

    case GROUPS_ACTIONS.ADD_GROUP:
      available.push({ ...DEFAULT_GROUP, id: nanoid(10), updatedAt: Date.now() });

      return {
        ...state,
        available
      };

    case GROUPS_ACTIONS.DELETE_GROUP: {
      const { index } = action.payload as { index: number };
      available.splice(index, 1);

      // to avoid having a large index, need to re-locate the active group (incase index was for last)
      const activeIdx = available.findIndex((group) => group.isActive);
      const newIdx = activeIdx > -1 ? activeIdx : index - 1;

      // Now update the active group - no need to reset all groups as this is taken care of by the above
      available[newIdx].isActive = true;

      return {
        ...state,
        active: { index: newIdx, id: available[newIdx].id },
        available
      };
    }

    default:
      return state;
  }
};

export default GroupsReducer;
