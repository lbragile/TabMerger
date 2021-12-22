import { IAction } from "../../typings/reducers";
import { IGroupItemState } from "./groups";

export const FILTER_ACTIONS = {
  UPDATE_FILTERED_TABS: "UPDATE_FILTERED_TABS",
  UPDATE_FILTERED_GROUPS: "UPDATE_FILTERED_GROUPS"
};

export interface IFilterState {
  filteredTabs: chrome.tabs.Tab[][];
  filteredGroups: IGroupItemState[];
}

const initState: IFilterState = {
  filteredTabs: [[]],
  filteredGroups: []
};

const filterReducer = (state = initState, action: IAction): IFilterState => {
  const { type, payload } = action;

  switch (type) {
    case FILTER_ACTIONS.UPDATE_FILTERED_TABS:
      return {
        ...state,
        filteredTabs: payload as IFilterState["filteredTabs"]
      };

    case FILTER_ACTIONS.UPDATE_FILTERED_GROUPS:
      return {
        ...state,
        filteredGroups: payload as IFilterState["filteredGroups"]
      };

    default:
      return state;
  }
};

export default filterReducer;
