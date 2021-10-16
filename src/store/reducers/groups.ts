import { TState, IAction } from "../../typings/reducers";

export const GROUP_ACTIONS = {
  UPDATE_ACTIVE_CONTAINER: "UPDATE_ACTIVE_CONTAINER"
};

const initState: TState = { activeContainer: "google" };

const groupReducer = (state = initState, action: IAction): TState => {
  switch (action.type) {
    case GROUP_ACTIONS.UPDATE_ACTIVE_CONTAINER:
      return { ...state, activeContainer: action.payload };

    default:
      return state;
  }
};

export default groupReducer;
