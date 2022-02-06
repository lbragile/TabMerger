import { combineReducers } from "redux";
import undoable, { excludeAction } from "redux-undo";

import dndReducer from "./reducers/dnd";
import groupsReducer, { GROUPS_ACTIONS } from "./reducers/groups";
import headerReducer from "./reducers/header";
import modalReducer from "./reducers/modal";

const DND_GROUPING = [
  GROUPS_ACTIONS.ADD_GROUP,
  GROUPS_ACTIONS.ADD_WINDOW,
  GROUPS_ACTIONS.UPDATE_TABS_FROM_GROUP_DND,
  GROUPS_ACTIONS.UPDATE_TABS_FROM_SIDEPANEL_DND,
  GROUPS_ACTIONS.UPDATE_WINDOWS_FROM_GROUP_DND,
  GROUPS_ACTIONS.UPDATE_WINDOWS_FROM_SIDEPANEL_DND,
  GROUPS_ACTIONS.CLEAR_EMPTY_GROUPS,
  GROUPS_ACTIONS.CLEAR_EMPTY_WINDOWS
] as string[];

const EXCLUDED_ACTIONS = [GROUPS_ACTIONS.UPDATE_INFO, GROUPS_ACTIONS.UPDATE_TIMESTAMP];

export const rootReducer = combineReducers({
  header: headerReducer,
  dnd: dndReducer,
  modal: modalReducer,
  groups: undoable(groupsReducer, {
    filter: excludeAction(EXCLUDED_ACTIONS),
    groupBy: (actionType) => (DND_GROUPING.includes(actionType.type) ? DND_GROUPING[0] : null),
    syncFilter: true
  })
});
