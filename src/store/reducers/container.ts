import { IAction } from "../../typings/reducers";

export const CONTAINER_ACTIONS = {
  UPDATE_ACTIVE_CONTAINER: "UPDATE_ACTIVE_CONTAINER"
};

export interface IContainerState {
  activeContainer: string;
}

export type TContainerAction = IAction<typeof CONTAINER_ACTIONS>;

const initState: IContainerState = { activeContainer: "google" };

const ContainerReducer = (state = initState, action: TContainerAction): IContainerState => {
  switch (action.type) {
    case CONTAINER_ACTIONS.UPDATE_ACTIVE_CONTAINER:
      return { ...state, activeContainer: action.payload as IContainerState["activeContainer"] };

    default:
      return state;
  }
};

export default ContainerReducer;
