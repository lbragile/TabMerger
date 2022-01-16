import { useMemo } from "react";

import { useSelector } from "./useRedux";

/**
 * For each window in the currently active group, store the matching tabs (with current filter value)
 * For "tab" filter - Generates 2d array of tabs where each index corresponds to the matching tabs in that window
 * For "group" filter - Simply filters the list of groups to only keep those that contain the search value
 */
export default function useFilter() {
  const { inputValue } = useSelector((state) => state.header);
  const { available, active } = useSelector((state) => state.groups);

  const filteredTabs = useMemo(() => {
    const matchingTabs: chrome.tabs.Tab[][] = [];

    available[active.index].windows.forEach((window) => {
      const matchingTabsInWindow = window.tabs?.filter((tab) =>
        tab?.title?.toLowerCase()?.includes(inputValue.toLowerCase())
      );

      matchingTabsInWindow && matchingTabs.push(matchingTabsInWindow ?? []);
    });

    return matchingTabs;
  }, [inputValue, available, active.index]);

  const filteredGroups = useMemo(() => {
    return available.filter((group) => group.name.toLowerCase().includes(inputValue.toLowerCase()));
  }, [inputValue, available]);

  return { filteredTabs, filteredGroups };
}
