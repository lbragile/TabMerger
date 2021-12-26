import { useCallback, useEffect } from "react";

import { WINDOW_QUERY_OPTIONS } from "../constants/chrome";
import GROUPS_CREATORS from "../store/actions/groups";
import { sortWindowsByFocus } from "../utils/helper";

import { useDispatch } from "./useRedux";

export default function useUpdateWindows(): void {
  const dispatch = useDispatch();

  const updateAwaitingStorageWindows = useCallback(() => {
    chrome.windows.getAll(WINDOW_QUERY_OPTIONS, (currentWindows) => {
      const { sortedWindows, hasFocused } = sortWindowsByFocus(currentWindows);

      if (!hasFocused) {
        // can happen on tab or window removal
        currentWindows[0].focused = true;
      }

      dispatch(GROUPS_CREATORS.updateWindows({ index: 0, windows: hasFocused ? sortedWindows : currentWindows }));
      dispatch(GROUPS_CREATORS.updateTimestamp({ index: 0, updatedAt: Date.now() }));
    });
  }, [dispatch]);

  const tabUpdateHandler = useCallback(
    (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.status === "complete") {
        updateAwaitingStorageWindows();
      }
    },
    [updateAwaitingStorageWindows]
  );

  const windowFocusChangedHandler = useCallback(
    (windowId: number) => {
      if (windowId > -1) {
        chrome.windows.get(windowId, WINDOW_QUERY_OPTIONS, (currentWindow) => {
          if (currentWindow.type === "normal") {
            updateAwaitingStorageWindows();
          }
        });
      }
    },
    [updateAwaitingStorageWindows]
  );

  useEffect(() => {
    updateAwaitingStorageWindows();

    chrome.tabs.onCreated.addListener(updateAwaitingStorageWindows);
    chrome.tabs.onUpdated.addListener(tabUpdateHandler);
    chrome.tabs.onRemoved.addListener(updateAwaitingStorageWindows);
    chrome.tabs.onDetached.addListener(updateAwaitingStorageWindows);
    chrome.tabs.onAttached.addListener(updateAwaitingStorageWindows);

    chrome.windows.onCreated.addListener(updateAwaitingStorageWindows);
    chrome.windows.onRemoved.addListener(updateAwaitingStorageWindows);
    chrome.windows.onBoundsChanged.addListener(updateAwaitingStorageWindows);
    chrome.windows.onFocusChanged.addListener(windowFocusChangedHandler);

    return () => {
      chrome.tabs.onCreated.removeListener(updateAwaitingStorageWindows);
      chrome.tabs.onUpdated.removeListener(tabUpdateHandler);
      chrome.tabs.onRemoved.removeListener(updateAwaitingStorageWindows);
      chrome.tabs.onDetached.removeListener(updateAwaitingStorageWindows);
      chrome.tabs.onAttached.removeListener(updateAwaitingStorageWindows);

      chrome.windows.onCreated.removeListener(updateAwaitingStorageWindows);
      chrome.windows.onRemoved.removeListener(updateAwaitingStorageWindows);
      chrome.windows.onBoundsChanged.removeListener(updateAwaitingStorageWindows);
      chrome.windows.onFocusChanged.removeListener(windowFocusChangedHandler);
    };
  }, [tabUpdateHandler, updateAwaitingStorageWindows, windowFocusChangedHandler]);
}
