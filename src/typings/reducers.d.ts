import { store } from "..";

export type TState = Record<string, unknown>;

export interface IAction {
  type: keyof typeof ACTIONS;
  payload: unknown;
}

/** @see https://redux.js.org/usage/usage-with-typescript */
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
