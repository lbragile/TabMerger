import { nanoid } from "nanoid";
import { useCallback, useEffect, useState } from "react";

import { useDispatch } from "./useRedux";

import { updateAvailable } from "~/store/actions/groups";
import { IGroupItemState } from "~/store/reducers/groups";
import { ISyncDataItem } from "~/typings/settings";
import { prepareGroupsForSync, handleSyncUpload } from "~/utils/background";
import { createGroup, createTabFromTitleAndUrl, createWindowWithTabs, getReadableTimestamp } from "~/utils/helper";

export default function useSyncStorageInfo(activeTab: "Download" | "Upload", available: IGroupItemState[]) {
  const [possibleData, setPossibleData] = useState<ISyncDataItem[]>([]);
  const [currentData, setCurrentData] = useState<ISyncDataItem[]>([]);

  useEffect(() => {
    if (activeTab === "Download") {
      chrome.storage.sync.get(null, (groups) => {
        const groupsArr: (ISyncDataItem & { order?: number })[] = Object.values(groups);
        if (!groupsArr.length) return;

        const sortedGroupsArr = groupsArr.sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0));
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const newSyncData: ISyncDataItem[] = sortedGroupsArr.map(({ order, ...rest }) => rest);
        setCurrentData(newSyncData);
        setPossibleData([]);
      });
    } else {
      const syncedGroups = prepareGroupsForSync(available);
      setPossibleData(syncedGroups);
      setCurrentData([]);
    }
  }, [activeTab, available]);

  return { possibleData, currentData };
}

export function useSyncStorageUpload(possibleData: ISyncDataItem[]) {
  const syncUpload = useCallback(() => {
    handleSyncUpload(possibleData);
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
