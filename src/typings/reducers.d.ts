import { store } from "..";

export interface IAction<P> {
  type: string;
  payload: P;
}

type TActionFunc<P> = (payload?: P) => IAction<P | undefined>;

/** @see https://redux.js.org/usage/usage-with-typescript */
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
