import { TypedUseSelectorHook, useSelector as useReduxSelector } from "react-redux";
import { RootState } from "../typings/reducers";

/** @see https://redux.js.org/usage/usage-with-typescript */
export const useSelector: TypedUseSelectorHook<RootState> = useReduxSelector;
