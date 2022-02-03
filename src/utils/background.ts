import { nanoid } from "nanoid";

import { getReadableTimestamp, sortWindowsByFocus } from "./helper";

import type { IGroupItemState } from "~/store/reducers/groups";
import type { TSentResponse } from "~/typings/background";
import type { ISyncDataItem } from "~/typings/settings";

import { WINDOW_QUERY_OPTIONS } from "~/constants/chrome";
import { DEFAULT_GROUP_COLOR, FIRST_GROUP_TITLE } from "~/constants/defaults";
import { MAX_SYNC_GROUPS, MAX_SYNC_ITEM_SIZE, MAX_SYNC_TABS_PER_GROUP } from "~/constants/sync";

/**
 * Immediately Invoked Function Expression that executes the `sendResponse` function to response to the web page
 * @see https://stackoverflow.com/a/53024910/4298115
 */
export function executeResponse<T>(res: TSentResponse<T>, cb: () => Promise<T>): void {
  (async () => {
    res({ data: await cb() });
  })();
}

/**
 * Sets the first group with corresponding data.
 * Additionally, sets the active group information
 */
export function setDefaultData(): void {
  // Get all the user's current open windows into the Now Open group
  chrome.windows.getAll(WINDOW_QUERY_OPTIONS, (windows) => {
    const activeId = nanoid(10);
    const active = { id: activeId, index: 0 };
    const { sortedWindows } = sortWindowsByFocus(windows);

    const available: IGroupItemState[] = [
      {
        name: FIRST_GROUP_TITLE,
        id: activeId,
        windows: sortedWindows,
        color: DEFAULT_GROUP_COLOR,
        updatedAt: Date.now(),
        permanent: true
      }
    ];

    chrome.storage.local.set({ active, available }, () => "");
  });
}

/**
 * Properly stores groups into very optimized sync items
 * @note Also performed in the extension popup script
 */
export const handleSyncUpload = (possibleData: ISyncDataItem[]) => {
  chrome.storage.sync.clear(() => "");

  let syncUpdated = false;
  for (let i = 0; i < possibleData.length; i++) {
    const group = possibleData[i];
    const currentSize = group.name.length + JSON.stringify(group).length;
    if (currentSize <= MAX_SYNC_ITEM_SIZE) {
      syncUpdated = true;

      // Short keys since they are not relevant for the download (save a few bytes to reduce limit constraint)
      chrome.storage.sync.set({ [i]: { ...group, order: i } }, () => "");
    }
  }

  // Update local storage upload sync timestamp (only if a sync occurred)
  if (syncUpdated) {
    chrome.storage.local.set({ lastSyncUpload: getReadableTimestamp() }, () => "");
  }
};

/**
 * Strips unnecessary information from each group, keeping only what is needed for a sync operation
 * @note Also performed in the extension popup script
 */
export const prepareGroupsForSync = (available: IGroupItemState[]) => {
  const syncedGroups: ISyncDataItem[] = [];

  // Only sync stored groups (index > 1)
  const storedGroups = available.slice(1);
  for (let i = 0; i < Math.min(storedGroups.length, MAX_SYNC_GROUPS); i++) {
    syncedGroups.push({ name: storedGroups[i].name, color: storedGroups[i].color, windows: [] });

    let tabCount = 0;
    const currentWindows = storedGroups[i].windows;
    for (let j = 0; j < currentWindows.length; j++) {
      const windowTabs = currentWindows[j].tabs;
      if (!windowTabs) continue;
      if (tabCount > MAX_SYNC_TABS_PER_GROUP) break;

      const numTabsInWindow = windowTabs.length;
      let newTabs: chrome.tabs.Tab[] = [];
      if (tabCount + numTabsInWindow > MAX_SYNC_TABS_PER_GROUP) {
        const numTabsToAdd = MAX_SYNC_TABS_PER_GROUP - tabCount;
        newTabs = windowTabs.slice(0, numTabsToAdd);
      } else {
        newTabs = currentWindows[j].tabs ?? [];
      }

      tabCount += numTabsInWindow;

      /**
       * Need to strip some unnecessary information which can be large in some cases to maximize tabs per sync item
       * @example tab.favIconUrl can be a very long string, but it can be reconstructed from the tab.url
       */
      const { incognito, starred, name } = currentWindows[j];
      syncedGroups[i].windows.push({
        incognito,
        starred,
        name,
        tabs: newTabs.map(({ title, url }) => ({ title, url: url?.split("?")[0] }))
      });
    }
  }

  return syncedGroups;
};
