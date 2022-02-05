import { useSelector as useReduxSelector, useDispatch as useReduxDispatch } from "react-redux";

import type { TypedUseSelectorHook } from "react-redux";
import type { RootState, AppDispatch } from "~/typings/redux";

/** @see https://redux.js.org/usage/usage-with-typescript */

export const useSelector: TypedUseSelectorHook<RootState> = useReduxSelector;

export const useDispatch = (): AppDispatch => useReduxDispatch<AppDispatch>();
