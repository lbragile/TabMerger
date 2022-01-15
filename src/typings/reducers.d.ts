import { combinedState } from "~/store/reducers";

export interface IAction {
  type: string;
  payload?: unknown;
}

export type TRootState = typeof combinedState;
