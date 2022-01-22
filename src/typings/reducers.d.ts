import { Reducer } from "react";

import { rootActions, rootState } from "~/store/reducers";

/* STATE */
export type TRootState = typeof rootState;

/* ACTIONS */
export type ActionsMap<A> = {
  [K in keyof A]: A[K] extends Record<keyof A[K], (...arg: never[]) => infer R> ? R : never;
}[keyof A];

export type TRootActions = ActionsMap<typeof rootActions>;

/* REDUCERS */
export type TRootReducer<S = TRootState, A = TRootActions> = Reducer<S, A>;

export type ReducersMap<S> = {
  [K in keyof S]: TRootReducer<S[K]>;
};
