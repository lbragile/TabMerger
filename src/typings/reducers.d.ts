import { Reducer } from "react";

import { rootActions, rootState } from "~/store/reducers";

export type TRootState = typeof rootState;

export type TRootActions = ReturnType<typeof rootActions[keyof typeof rootActions]>;

export type TRootReducer<S = TRootState, A = TRootActions> = Reducer<S, A>;

export type ReducersMap<S> = {
  [K in keyof S]: TRootReducer<S[K]>;
};
