import { combineReducers } from "redux";
import undoable, { groupByActionTypes, includeAction } from "redux-undo";

import dndReducer from "./reducers/dnd";
import groupsReducer from "./reducers/groups";
import headerReducer from "./reducers/header";
import modalReducer from "./reducers/modal";

export const rootReducer = combineReducers({
  header: headerReducer,
  groups: undoable(groupsReducer, {
    filter: includeAction(["DELETE_GROUP", "DELETE_WINDOW", "DELETE_TAB", "UPDATE_ACTIVE"]),
    groupBy: groupByActionTypes([
      "ADD_GROUP",
      "ADD_WINDOW",
      "UPDATE_TABS_FROM_GROUP_DND",
      "UPDATE_TABS_FROM_SIDEPANEL_DND",
      "UPDATE_WINDOWS_FROM_GROUP_DND",
      "UPDATE_WINDOWS_FROM_SIDEPANEL_DND",
      "UPDATE_INFO",
      "UPDATE_TIMESTAMP"
    ]),
    ignoreInitialState: true,
    syncFilter: true
  }),
  dnd: dndReducer,
  modal: modalReducer
});
