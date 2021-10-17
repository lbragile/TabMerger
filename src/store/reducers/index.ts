import { combineReducers } from "redux";
import groupReducer, { IGroupState } from "./group";
import headerReducer, { IHeaderState } from "./header";

const rootReducer = combineReducers<{ group: IGroupState; header: IHeaderState }>({
  group: groupReducer,
  header: headerReducer
});

export default rootReducer;
