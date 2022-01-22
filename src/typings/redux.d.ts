import { Reducer } from "react";

import { rootActions, rootState } from "~/store";

type ActionsMap<A> = {
  [K in keyof A]: A[K] extends Record<keyof A[K], (...arg: never[]) => infer R> ? R : never;
}[keyof A];

export type TRootState = typeof rootState;

export type TRootActions = ActionsMap<typeof rootActions>;

export type TRootReducer<S = TRootState, A = TRootActions> = Reducer<S, A>;
