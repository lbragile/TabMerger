import { IGroupItemState } from "./groups";

import { IAction } from "~/typings/reducers";

export const FILTER_ACTIONS = {
  UPDATE_FILTERED_TABS: "UPDATE_FILTERED_TABS",
  UPDATE_FILTERED_GROUPS: "UPDATE_FILTERED_GROUPS"
};

export interface IFilterState {
  filteredTabs: chrome.tabs.Tab[][];
  filteredGroups: IGroupItemState[];
}

export const initFilterState: IFilterState = {
  filteredTabs: [[]],
  filteredGroups: []
};

const filterReducer = (state: IFilterState, action: IAction): IFilterState => {
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
