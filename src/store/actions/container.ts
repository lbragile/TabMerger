import { CONTAINER_ACTIONS, IContainerState, TContainerAction } from "../reducers/container";

type TDispatchType = keyof typeof CONTAINER_ACTIONS;

export function updateActiveContainer(payload: IContainerState["activeContainer"]): TContainerAction {
  return { type: CONTAINER_ACTIONS.UPDATE_ACTIVE_CONTAINER as TDispatchType, payload };
}
