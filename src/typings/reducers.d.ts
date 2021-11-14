import { store } from "../store/utils/configureStore";

export interface IAction {
  type: string;
  payload?: unknown;
}

/** @see https://redux.js.org/usage/usage-with-typescript */
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
