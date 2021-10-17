import { IAction } from "../../typings/reducers";
import { GROUP_ACTIONS, IGroupState } from "../reducers/group";

type TGroupAction = IAction<IGroupState>;
type TPayload = TGroupAction["payload"];

export function updateActiveGroup(payload: TPayload): TGroupAction {
  return { type: GROUP_ACTIONS.UPDATE_ACTIVE_GROUP, payload };
}

export function updateWindows(payload: TPayload): TGroupAction {
  return { type: GROUP_ACTIONS.UPDATE_WINDOWS, payload };
}
