import type { IGroupsState } from "~/store/reducers/groups";
import type { TRootActions } from "~/typings/redux";

export const HISTORY_ACTIONS = {
  SET_ANCHOR_STATE: "SET_ANCHOR_STATE",
  ADD_ACTION: "ADD_ACTION",
  UPDATE_POSITION: "UPDATE_POSITION"
} as const;

interface IHistoryState {
  anchorState: IGroupsState;
  actions: { type: string; payload?: unknown }[];
  pos: number;
}

export const initHistoryState: IHistoryState = {
  anchorState: { available: [], active: { index: 0, id: "" } },
  actions: [],
  pos: 0
};

const historyReducer = (state = initHistoryState, action: TRootActions): IHistoryState => {
  switch (action.type) {
    case HISTORY_ACTIONS.SET_ANCHOR_STATE:
      return {
        ...state,
        anchorState: action.payload
      };

    case HISTORY_ACTIONS.ADD_ACTION: {
      const actionsArr = [...state.actions.slice(0, state.pos), action.payload];

      return {
        ...state,
        actions: actionsArr,
        pos: state.pos + 1
      };
    }

    case HISTORY_ACTIONS.UPDATE_POSITION:
      return {
        ...state,
        pos: action.payload
      };

    default:
      return state;
  }
};

export default historyReducer;
