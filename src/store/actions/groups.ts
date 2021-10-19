import { IAction } from "../../typings/reducers";
import { GROUPS_ACTIONS, IGroupsState } from "../reducers/groups";

type TGroupsAction = IAction<IGroupsState>;
type TPayload = TGroupsAction["payload"];

export function updateActive(payload: TPayload): TGroupsAction {
  return { type: GROUPS_ACTIONS.UPDATE_ACTIVE, payload };
}

export function updateIndex(payload: TPayload): TGroupsAction {
  return { type: GROUPS_ACTIONS.UPDATE_INDEX, payload };
}

export function updateIsActive(payload: TPayload): TGroupsAction {
  return { type: GROUPS_ACTIONS.UPDATE_IS_ACTIVE, payload };
}

export function updateName(payload: TPayload): TGroupsAction {
  return { type: GROUPS_ACTIONS.UPDATE_NAME, payload };
}

export function updateColor(payload: TPayload): TGroupsAction {
  return { type: GROUPS_ACTIONS.UPDATE_COLOR, payload };
}

export function updateTimestamp(payload: TPayload): TGroupsAction {
  return { type: GROUPS_ACTIONS.UPDATE_TIMESTAMP, payload };
}

export function updateWindows(payload: TPayload): TGroupsAction {
  return { type: GROUPS_ACTIONS.UPDATE_WINDOWS, payload };
}

export function updatePermanent(payload: TPayload): TGroupsAction {
  return { type: GROUPS_ACTIONS.UPDATE_PERMANENT, payload };
}

export function updateInfo(payload: TPayload): TGroupsAction {
  return { type: GROUPS_ACTIONS.UPDATE_INFO, payload };
}

export function addGroup(): TGroupsAction {
  return { type: GROUPS_ACTIONS.ADD_GROUP, payload: undefined };
}

export function deleteGroup(payload: TPayload): TGroupsAction {
  return { type: GROUPS_ACTIONS.DELETE_GROUP, payload };
}
