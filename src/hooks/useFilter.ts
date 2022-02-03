import { useMemo } from "react";

import { useSelector } from "./useRedux";

import type { IGroupItemState } from "~/store/reducers/groups";

/**
 * For each window in the currently active group, store the matching tabs (with current filter value)
 * For "tab" filter - Generates 2d array of tabs where each index corresponds to the matching tabs in that window
 * For "group" filter - Simply filters the list of groups to only keep those that contain the search value
 */
export default function useFilter() {
  const { inputValue } = useSelector((state) => state.header);
  const { available } = useSelector((state) => state.groups);

  const [filteredTabs, nonEmptyGroups] = useMemo(() => {
    const remainingTabs: Record<string, chrome.tabs.Tab[][]> = {};
    const remainingGroups: IGroupItemState[] = [];

    available.forEach((group) => {
      const windowTabs: chrome.tabs.Tab[][] = [];

      // Get all tabs in the windows of the group that have matching title
      group.windows.forEach((window) => {
        const matchingTabsInWindow = window.tabs?.filter((tab) =>
          tab?.title?.toLowerCase()?.includes(inputValue.toLowerCase())
        );

        if (matchingTabsInWindow) {
          windowTabs.push(matchingTabsInWindow);
        }
      });

      remainingTabs[group.id] = windowTabs;

      // Only add to the remaining groups if it has at least 1 window whose tabs match
      if (windowTabs.filter((item) => item.length).length > 0) {
        remainingGroups.push(group);
      }
    });

    return [remainingTabs, remainingGroups];
  }, [inputValue, available]);

  const filteredGroups = useMemo(() => {
    return available.filter((group) => group.name.toLowerCase().includes(inputValue.toLowerCase()));
  }, [inputValue, available]);

  return { filteredTabs, filteredGroups, nonEmptyGroups };
}
