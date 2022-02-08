import { combineReducers } from "redux";
import undoable, { excludeAction } from "redux-undo";

import dndReducer from "./reducers/dnd";
import groupsReducer, { GROUPS_ACTIONS } from "./reducers/groups";
import headerReducer from "./reducers/header";
import modalReducer from "./reducers/modal";

// ! Last elements must be ordered properly
const DND_GROUPING = [
  GROUPS_ACTIONS.ADD_GROUP,
  GROUPS_ACTIONS.ADD_WINDOW,
  GROUPS_ACTIONS.UPDATE_TABS_FROM_GROUP_DND,
  GROUPS_ACTIONS.UPDATE_TABS_FROM_SIDEPANEL_DND,
  GROUPS_ACTIONS.UPDATE_WINDOWS_FROM_GROUP_DND,
  GROUPS_ACTIONS.UPDATE_WINDOWS_FROM_SIDEPANEL_DND,
  GROUPS_ACTIONS.CLEAR_EMPTY_WINDOWS,
  GROUPS_ACTIONS.CLEAR_EMPTY_GROUPS
] as string[];

const EXCLUDED_ACTIONS = [GROUPS_ACTIONS.UPDATE_INFO, GROUPS_ACTIONS.UPDATE_TIMESTAMP, GROUPS_ACTIONS.UPDATE_WINDOWS];

let randomGroupPostfix = 0;

export const rootReducer = combineReducers({
  header: headerReducer,
  dnd: dndReducer,
  modal: modalReducer,
  groups: undoable(groupsReducer, {
    filter: excludeAction(EXCLUDED_ACTIONS),
    groupBy: (actionType) => {
      const matchType = DND_GROUPING[DND_GROUPING.length - 1];
      const groupingId = DND_GROUPING.includes(actionType.type) ? matchType + "-" + randomGroupPostfix : null;

      // Want to update the random postfix after the final group's `groupingId` is updated
      if (actionType.type === matchType) {
        randomGroupPostfix = Math.random();
      }

      return groupingId;
    },
    syncFilter: true
  })
});
