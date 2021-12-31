import { FILTER_ACTIONS } from "~/store/reducers/filter";
import { IGroupItemState } from "~/store/reducers/groups";

const updateFilteredTabs = (payload: chrome.tabs.Tab[][]) => ({ type: FILTER_ACTIONS.UPDATE_FILTERED_TABS, payload });

const updateFilteredGroups = (payload: IGroupItemState[]) => ({ type: FILTER_ACTIONS.UPDATE_FILTERED_GROUPS, payload });

export default {
  updateFilteredTabs,
  updateFilteredGroups
};
