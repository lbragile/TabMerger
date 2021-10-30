import { combineReducers } from "redux";
import filterReducer, { IFilterState } from "./filter";
import groupsReducer, { IGroupsState } from "./groups";
import headerReducer, { IHeaderState } from "./header";

const rootReducer = combineReducers<{ header: IHeaderState; groups: IGroupsState; filter: IFilterState }>({
  header: headerReducer,
  groups: groupsReducer,
  filter: filterReducer
});

export default rootReducer;
