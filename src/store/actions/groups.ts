import { IAction } from "../../typings/reducers";
import { GROUP_ACTIONS } from "../reducers/groups";

export function updateActiveContainer(payload: unknown): IAction {
  return { type: GROUP_ACTIONS.UPDATE_ACTIVE_CONTAINER, payload };
}
