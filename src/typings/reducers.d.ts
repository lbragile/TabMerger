import { store } from "..";

export interface IAction<T> {
  type: keyof T;
  payload: unknown;
}

/** @see https://redux.js.org/usage/usage-with-typescript */
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
