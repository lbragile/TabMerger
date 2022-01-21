import { DND_CREATORS } from "../actions/dnd";
import { GROUPS_CREATORS } from "../actions/groups";
import { HEADER_CREATORS } from "../actions/header";
import { MODAL_CREATORS } from "../actions/modal";

import dndReducer, { initDnDState } from "./dnd";
import groupsReducer, { initGroupsState } from "./groups";
import headerReducer, { initHeaderState } from "./header";
import modalReducer, { initModalState } from "./modal";

import { ReducersMap, TRootReducer, TRootState } from "~/typings/reducers";

/**
 * @see https://stackoverflow.com/a/61439698/4298115
 */
const combineReducers = <S = TRootState>(reducers: ReducersMap<S>): TRootReducer<S> => {
  // Each "slice" of the combined reducer needs to be a reducer itself
  return (state, action) => {
    // Each reducer outputs the state for that "slice"
    return (Object.keys(reducers) as Array<keyof S>).reduce(
      (prevState, key) => ({
        ...prevState,
        [key]: reducers[key](prevState[key], action)
      }),
      state
    );
  };
};

export const rootState = {
  header: initHeaderState,
  groups: initGroupsState,
  dnd: initDnDState,
  modal: initModalState
};

export const rootActions = {
  ...DND_CREATORS,
  ...GROUPS_CREATORS,
  ...HEADER_CREATORS,
  ...MODAL_CREATORS
};

export const rootReducer = combineReducers({
  header: headerReducer,
  groups: groupsReducer,
  dnd: dndReducer,
  modal: modalReducer
});
