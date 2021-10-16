import { useDispatch as useReduxDispatch } from "react-redux";
import { AppDispatch } from "../typings/reducers";

/** @see https://redux.js.org/usage/usage-with-typescript */
export const useDispatch = (): AppDispatch => useReduxDispatch<AppDispatch>();
