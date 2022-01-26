import * as dndActions from "./actions/dnd";
import * as groupsActions from "./actions/groups";
import * as headerActions from "./actions/header";
import * as modalActions from "./actions/modal";
import dndReducer, { initDnDState } from "./reducers/dnd";
import groupsReducer, { initGroupsState } from "./reducers/groups";
import headerReducer, { initHeaderState } from "./reducers/header";
import modalReducer, { initModalState } from "./reducers/modal";

import { TRootReducer, TRootState } from "~/typings/redux";

/**
 * Takes in reducer slices object and forms a single reducer with the combined state as output
 * @see https://stackoverflow.com/a/61439698/4298115
 */
const combineReducers = <S = TRootState>(reducers: { [K in keyof S]: TRootReducer<S[K]> }): TRootReducer<S> => {
  return (state, action) => {
    // Build the combined state
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
  header: headerActions,
  groups: groupsActions,
  dnd: dndActions,
  modal: modalActions
};

export const rootReducer = combineReducers({
  header: headerReducer,
  groups: groupsReducer,
  dnd: dndReducer,
  modal: modalReducer
});
