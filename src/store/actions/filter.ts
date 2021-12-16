/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import { FILTER_ACTIONS } from "../reducers/filter";
import { IGroupState } from "../reducers/groups";

const updateFilteredTabs = (payload: chrome.tabs.Tab[][]) => ({
  type: FILTER_ACTIONS.UPDATE_FILTERED_TABS,
  payload
});

const updateFilteredGroups = (payload: IGroupState[]) => ({
  type: FILTER_ACTIONS.UPDATE_FILTERED_GROUPS,
  payload
});

export default {
  updateFilteredTabs,
  updateFilteredGroups
};
