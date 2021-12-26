import { combineReducers } from "redux";

import dndReducer, { IDnDState } from "./dnd";
import filterReducer, { IFilterState } from "./filter";
import groupsReducer, { IGroupsState } from "./groups";
import headerReducer, { IHeaderState } from "./header";

const rootReducer = combineReducers<{
  header: IHeaderState;
  groups: IGroupsState;
  filter: IFilterState;
  dnd: IDnDState;
}>({
  header: headerReducer,
  groups: groupsReducer,
  filter: filterReducer,
  dnd: dndReducer
});

export default rootReducer;
