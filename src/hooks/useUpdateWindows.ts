import { useCallback, useEffect } from "react";

import useLocalStorage from "./useLocalStorage";
import { useDispatch } from "./useRedux";

import { WINDOW_QUERY_OPTIONS } from "~/constants/chrome";
import { updateWindows, updateTimestamp } from "~/store/actions/groups";
import { sortWindowsByFocus, wildcardGlobToRegExp } from "~/utils/helper";

export default function useUpdateWindows(): void {
  const dispatch = useDispatch();

  const [urlFilter] = useLocalStorage("urlFilter", "");

  const updateAwaitingStorageWindows = useCallback(() => {
    chrome.windows.getAll(WINDOW_QUERY_OPTIONS, (currentWindows) => {
      // Filter out tabs that are matching at least one pattern in the settings
      const filterPatterns = urlFilter.split(/,\s+/);

      currentWindows.forEach((w) => {
        w.tabs =
          w.tabs?.filter(({ url }) => {
            return filterPatterns.filter((pattern) => wildcardGlobToRegExp(pattern).test(url ?? "")).length === 0;
          }) ?? [];
      });

      // Clear empty windows
      currentWindows = currentWindows.filter((w) => (w.tabs?.length ?? 0) > 0);

      const { sortedWindows, hasFocused } = sortWindowsByFocus(currentWindows);

      // Can happen on tab or window removal
      if (!hasFocused) {
        currentWindows[0].focused = true;
      }

      dispatch(updateWindows({ index: 0, windows: hasFocused ? sortedWindows : currentWindows }));
      dispatch(updateTimestamp({ index: 0, updatedAt: Date.now() }));
    });
  }, [dispatch, urlFilter]);

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
