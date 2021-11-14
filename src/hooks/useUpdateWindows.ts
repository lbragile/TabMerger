import { useCallback, useEffect, useMemo } from "react";
import { useDispatch } from "react-redux";
import GROUPS_CREATORS from "../store/actions/groups";

export default function useUpdateWindows(): void {
  const dispatch = useDispatch();

  const fetchOpts: chrome.windows.QueryOptions = useMemo(() => ({ populate: true, windowTypes: ["normal"] }), []);

  const fetchWindows = useCallback(
    async (queryOptions: typeof fetchOpts = fetchOpts) => {
      const allWindows = await chrome.windows.getAll(queryOptions);

      // Popup script (extension icon) click takes focus away from current window, so need to manually set it
      const currentWindow = await chrome.windows.getCurrent();
      allWindows.forEach((tabWindow) => {
        tabWindow.focused = currentWindow.id ? currentWindow.id === tabWindow.id : false;
      });

      // move active window to the top
      const sortedWindows = allWindows
        .filter((tabWindow) => tabWindow.focused)
        .concat(allWindows.filter((tabWindow) => !tabWindow.focused));

      // add this window information to the 'Awaiting Storage' group
      dispatch(GROUPS_CREATORS.updateWindows({ index: 0, windows: sortedWindows, dragOverGroup: 0 }));
    },
    [dispatch, fetchOpts]
  );

  const onUpdatedHandler = useCallback(
    async (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.status === "complete") {
        await fetchWindows();
      }
    },
    [fetchWindows]
  );

  useEffect(() => {
    fetchWindows();
  }, [fetchWindows]);

  useEffect(() => {
    chrome.tabs.onUpdated.addListener(onUpdatedHandler);
    chrome.tabs.onRemoved.addListener(() => fetchWindows());
    chrome.windows.onCreated.addListener(() => fetchWindows());
    chrome.windows.onRemoved.addListener(() => fetchWindows());

    return () => {
      chrome.tabs.onUpdated.removeListener(onUpdatedHandler);
      chrome.tabs.onRemoved.removeListener(() => fetchWindows());
      chrome.windows.onCreated.removeListener(() => fetchWindows());
      chrome.windows.onRemoved.removeListener(() => fetchWindows());
    };
  }, [fetchWindows, onUpdatedHandler]);
}
