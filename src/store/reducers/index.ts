import { combineReducers } from "redux";

import dndReducer, { IDnDState } from "./dnd";
import filterReducer, { IFilterState } from "./filter";
import groupsReducer, { IGroupsState } from "./groups";
import headerReducer, { IHeaderState } from "./header";
import modalReducer, { IModalState } from "./modal";

const rootReducer = combineReducers<{
  header: IHeaderState;
  groups: IGroupsState;
  filter: IFilterState;
  dnd: IDnDState;
  modal: IModalState;
}>({
  header: headerReducer,
  groups: groupsReducer,
  filter: filterReducer,
  dnd: dndReducer,
  modal: modalReducer
});

export default rootReducer;
