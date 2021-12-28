import { TypedUseSelectorHook, useSelector as useReduxSelector, useDispatch as useReduxDispatch } from "react-redux";

import { RootState, AppDispatch } from "../typings/reducers";

/** @see https://redux.js.org/usage/usage-with-typescript */

export const useSelector: TypedUseSelectorHook<RootState> = useReduxSelector;

export const useDispatch = (): AppDispatch => useReduxDispatch<AppDispatch>();
