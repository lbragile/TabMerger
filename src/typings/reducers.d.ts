import { Reducer } from "react";

import { combinedState } from "~/store/reducers";

export interface IAction {
  type: string;
  payload?: unknown;
}

export type TRootState = typeof combinedState;

export type TRootReducer<S = TRootState, A = IAction> = Reducer<S, A>;
