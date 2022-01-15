import { Reducer } from "react";

import dndReducer, { initDnDState } from "./dnd";
import filterReducer, { initFilterState } from "./filter";
import groupsReducer, { initGroupsState } from "./groups";
import headerReducer, { initHeaderState } from "./header";
import modalReducer, { initModalState } from "./modal";

import { IAction, TRootState } from "~/typings/reducers";

type ReducersMap<S> = {
  [K in keyof S]: Reducer<S[K], IAction>;
};

/**
 * @see https://stackoverflow.com/a/61439698/4298115
 */
const combineReducers = <S>(reducers: ReducersMap<S>): Reducer<S, IAction> => {
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

export const rootReducer = combineReducers<TRootState>({
  header: headerReducer,
  groups: groupsReducer,
  filter: filterReducer,
  dnd: dndReducer,
  modal: modalReducer
});

export const combinedState = {
  header: initHeaderState,
  groups: initGroupsState,
  filter: initFilterState,
  dnd: initDnDState,
  modal: initModalState
};
