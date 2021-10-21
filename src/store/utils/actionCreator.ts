import { IAction } from "../../typings/reducers";

export function createAction<P>(type: string, payload?: P): IAction<P | undefined> {
  return { type, payload };
}
