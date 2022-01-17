import { nanoid } from "nanoid";
import { useCallback, useEffect } from "react";

import { useDispatch } from "./useRedux";

import { MAX_SYNC_GROUPS, MAX_SYNC_TABS_PER_GROUP, MAX_SYNC_ITEM_SIZE } from "~/constants/sync";
import { updateAvailable } from "~/store/actions/groups";
import { updateSyncCurrentData, updateSyncPossibleData } from "~/store/actions/modal";
import { IGroupItemState } from "~/store/reducers/groups";
import { ISyncDataItem } from "~/store/reducers/modal";
import { createGroup, createTabFromTitleAndUrl, createWindowWithTabs, getReadableTimestamp } from "~/utils/helper";

export default function useSyncStorageInfo(activeTab: "Download" | "Upload", available: IGroupItemState[]) {
  const dispatch = useDispatch();

  useEffect(() => {
    if (activeTab === "Download") {
      chrome.storage.sync.get(null, (groups) => {
        const groupsArr: (ISyncDataItem & { order?: number })[] = Object.values(groups);
        if (!groupsArr.length) return;

        const sortedGroupsArr = groupsArr.sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0));
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const newSyncData: ISyncDataItem[] = sortedGroupsArr.map(({ order, ...rest }) => rest);
        dispatch(updateSyncCurrentData(newSyncData));
        dispatch(updateSyncPossibleData([]));
      });
    } else {
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

      dispatch(updateSyncPossibleData(syncedGroups));
      dispatch(updateSyncCurrentData([]));
    }
  }, [dispatch, activeTab, available]);
}

export function useSyncStorageUpload(possibleData: ISyncDataItem[]) {
  const syncUpload = useCallback(() => {
    chrome.storage.sync.clear();

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
  }, [possibleData]);

  return syncUpload;
}

export function useSyncStorageDownload(currentData: ISyncDataItem[], available: IGroupItemState[]) {
  const dispatch = useDispatch();

  const syncDownload = useCallback(() => {
    // Create groups that are properly formatted using the limited sync data
    const newAvailable = currentData.map((item) => {
      const group = createGroup(nanoid(10), item.name, item.color);
      item.windows.forEach((w) => {
        const tabs: chrome.tabs.Tab[] = [];

        w.tabs.forEach((t) => {
          tabs.push(createTabFromTitleAndUrl(t.title, t.url));
        });

        group.windows.push(createWindowWithTabs(tabs, w.name, w.incognito, w.starred));
      });

      return group;
    });

    dispatch(updateAvailable([available[0], ...newAvailable]));

    // Update local storage download sync timestamp
    chrome.storage.local.set({ lastSyncDownload: getReadableTimestamp() }, () => "");
  }, [dispatch, currentData, available]);

  return syncDownload;
}
