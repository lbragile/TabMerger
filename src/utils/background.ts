import { nanoid } from "nanoid";

import { getReadableTimestamp, sortWindowsByFocus } from "./helper";

import { WINDOW_QUERY_OPTIONS } from "~/constants/chrome";
import { DEFAULT_GROUP_COLOR, FIRST_GROUP_TITLE } from "~/constants/defaults";
import { MAX_SYNC_ITEM_SIZE } from "~/constants/sync";
import { IGroupItemState } from "~/store/reducers/groups";
import { ISyncDataItem } from "~/store/reducers/modal";
import { TSentResponse } from "~/typings/background";

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

// Properly stores groups into very optimized sync items
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
