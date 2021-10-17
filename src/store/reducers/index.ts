import { combineReducers } from "redux";
import containerReducer, { IContainerState } from "./container";
import headerReducer, { IHeaderState } from "./header";

const rootReducer = combineReducers<{ container: IContainerState; header: IHeaderState }>({
  container: containerReducer,
  header: headerReducer
});

export default rootReducer;
