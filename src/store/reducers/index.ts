import { combineReducers } from "redux";
import groupsReducer, { IGroupsState } from "./groups";
import headerReducer, { IHeaderState } from "./header";

const rootReducer = combineReducers<{ header: IHeaderState; groups: IGroupsState }>({
  header: headerReducer,
  groups: groupsReducer
});

export default rootReducer;
