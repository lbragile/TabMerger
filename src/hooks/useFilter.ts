import { useEffect } from "react";

import { useDispatch, useSelector } from "./useRedux";

import FILTERS_CREATORS from "~/store/actions/filter";

/**
 * For each window in the currently active group, store the matching tabs (with current filter value)
 * For "tab" filter - Generates 2d array of tabs where each index corresponds to the matching tabs in that window
 * For "group" filter - Simply filters the list of groups to only keep those that contain the search value
 */
export default function useFilter() {
  const dispatch = useDispatch();

  const { typing, inputValue, filterChoice } = useSelector((state) => state.header);
  const { available, active } = useSelector((state) => state.groups);

  useEffect(() => {
    if (typing && filterChoice === "tab") {
      const matchingTabs: chrome.tabs.Tab[][] = [];

      available[active.index].windows.forEach((window) => {
        const matchingTabsInWindow = window.tabs?.filter((tab) =>
          tab?.title?.toLowerCase()?.includes(inputValue.toLowerCase())
        );

        matchingTabsInWindow && matchingTabs.push(matchingTabsInWindow ?? []);
      });

      dispatch(FILTERS_CREATORS.updateFilteredTabs(matchingTabs));
    } else if (typing && filterChoice === "group") {
      const matchingGroups = available.filter((group) => group.name.toLowerCase().includes(inputValue.toLowerCase()));
      dispatch(FILTERS_CREATORS.updateFilteredGroups(matchingGroups));
    }
  }, [dispatch, typing, inputValue, available, active.index, filterChoice]);
}
