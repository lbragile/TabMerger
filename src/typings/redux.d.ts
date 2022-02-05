import type { store } from "~/store/configureStore";

/** @see https://redux.js.org/usage/usage-with-typescript */

export type RootState = ReturnType<typeof store.getState>;

export type AppDispatch = typeof store.dispatch;

type ValueOf<T> = T[keyof T];

export type TAction<A extends Record<string, (...args: never[]) => unknown>> = ReturnType<ValueOf<A>>;
