import { combineReducers } from "redux";
import groupReducer from "./groups";

const rootReducer = combineReducers({ group: groupReducer });

export default rootReducer;
