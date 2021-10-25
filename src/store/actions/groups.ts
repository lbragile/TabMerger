import { TActionFunc } from "../../typings/reducers";
import { GROUPS_ACTIONS, IGroupsState, IGroupState } from "../reducers/groups";
import { createAction } from "../utils/actionCreator";

export const updateActive: TActionFunc<IGroupsState["active"]> = (payload) => {
  return createAction<IGroupsState["active"]>(GROUPS_ACTIONS.UPDATE_ACTIVE, payload);
};

export const updateIndex: TActionFunc<IGroupsState["active"]["index"]> = (payload) => {
  return createAction<IGroupsState["active"]["index"]>(GROUPS_ACTIONS.UPDATE_INDEX, payload);
};

export const updateIsActive: TActionFunc<IGroupState["isActive"]> = (payload) => {
  return createAction<IGroupState["isActive"]>(GROUPS_ACTIONS.UPDATE_IS_ACTIVE, payload);
};

export const updateName: TActionFunc<{ index: number; name: IGroupState["name"] }> = (payload) => {
  return createAction<{ index: number; name: IGroupState["name"] }>(GROUPS_ACTIONS.UPDATE_NAME, payload);
};

export const updateColor: TActionFunc<IGroupState["color"]> = (payload) => {
  return createAction<IGroupState["color"]>(GROUPS_ACTIONS.UPDATE_COLOR, payload);
};

export const updateTimestamp: TActionFunc<IGroupState["updatedAt"]> = (payload) => {
  return createAction<IGroupState["updatedAt"]>(GROUPS_ACTIONS.UPDATE_TIMESTAMP, payload);
};

export const updateWindows: TActionFunc<{ index: number; windows: IGroupState["windows"] }> = (payload) => {
  return createAction<{ index: number; windows: IGroupState["windows"] }>(GROUPS_ACTIONS.UPDATE_WINDOWS, payload);
};

export const updateInfo: TActionFunc<{ index: number; info: IGroupState["info"] }> = (payload) => {
  return createAction<{ index: number; info: IGroupState["info"] }>(GROUPS_ACTIONS.UPDATE_INFO, payload);
};

export const updatePermanent: TActionFunc<IGroupState["permanent"]> = (payload) => {
  return createAction<IGroupState["permanent"]>(GROUPS_ACTIONS.UPDATE_PERMANENT, payload);
};

export const addGroup: TActionFunc<IGroupState> = () => {
  return createAction<IGroupState>(GROUPS_ACTIONS.ADD_GROUP);
};

export const deleteGroup: TActionFunc<IGroupsState["active"]> = (payload) => {
  return createAction<IGroupsState["active"]>(GROUPS_ACTIONS.DELETE_GROUP, payload);
};
