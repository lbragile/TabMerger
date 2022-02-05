import { combineReducers } from "redux";

import dndReducer from "./reducers/dnd";
import groupsReducer from "./reducers/groups";
import headerReducer from "./reducers/header";
import modalReducer from "./reducers/modal";

export const rootReducer = combineReducers({
  header: headerReducer,
  groups: groupsReducer,
  dnd: dndReducer,
  modal: modalReducer
});
