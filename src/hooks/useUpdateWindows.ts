import { useCallback, useEffect } from "react";
import GROUPS_CREATORS from "../store/actions/groups";
import { useDispatch } from "./useDispatch";
import { useSelector } from "./useSelector";

/** @note This functionality will be moved to the background script */

export default function useUpdateWindows(): void {
  const dispatch = useDispatch();
  const { available } = useSelector((state) => state.groups);

  /** Add the newly created window to the end of the list */
  const windowCreateHandler = useCallback(
    (browserWindow: chrome.windows.Window, filters: chrome.windows.WindowEventFilter = { windowTypes: ["normal"] }) => {
      if (filters.windowTypes.includes(browserWindow.type ?? "normal")) {
        dispatch(
          GROUPS_CREATORS.updateWindows({
            index: 0,
            windows: [...available[0].windows, browserWindow],
            dragOverGroup: 0
          })
        );
      }
    },
    [dispatch, available]
  );

  /** Add a new tab to the end of the window where it was added */
  const tabCreateHandler = useCallback(
    (tab: chrome.tabs.Tab) => {
      const currentWindows = [...available[0].windows];
      currentWindows.forEach((elem) => {
        if (elem.id === tab.windowId) {
          elem.tabs = [...(elem.tabs ?? []), tab];
        }
      });

      dispatch(GROUPS_CREATORS.updateWindows({ index: 0, windows: currentWindows, dragOverGroup: 0 }));
    },
    [dispatch, available]
  );

  /** When a tab updates, find it in the windows list and update it respectively */
  // TODO - this might need to be done in the background script
  const tabUpdateHandler = useCallback((tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
    if (changeInfo.status === "complete") {
      console.log(tabId, tab);
    }
  }, []);

  /** When the popup is first opened, get the list of all windows */
  // TODO filter difference between existing windows and ones in local storage (of Awaiting Storage group) - add differences to top
  useEffect(() => {
    chrome.windows.getAll({ populate: true, windowTypes: ["normal"] }, (windows) => {
      dispatch(GROUPS_CREATORS.updateWindows({ index: 0, windows, dragOverGroup: 0 }));
    });
  }, [dispatch]);

  useEffect(() => {
    chrome.tabs.onUpdated.addListener(tabUpdateHandler);
    chrome.tabs.onCreated.addListener(tabCreateHandler);
    chrome.windows.onCreated.addListener(windowCreateHandler);

    return () => {
      chrome.tabs.onUpdated.removeListener(tabUpdateHandler);
      chrome.tabs.onCreated.removeListener(tabCreateHandler);
      chrome.windows.onCreated.removeListener(windowCreateHandler);
    };
  }, [windowCreateHandler, tabCreateHandler, tabUpdateHandler]);
}
