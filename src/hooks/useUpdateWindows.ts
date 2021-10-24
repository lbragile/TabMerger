import { useCallback, useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { updateWindows } from "../store/actions/groups";

export default function useUpdateWindows() {
  const dispatch = useDispatch();
  const [created, setCreated] = useState(false);

  const fetchWindows = useCallback(
    async (queryOptions: chrome.windows.QueryOptions) => {
      const windows = await chrome.windows.getAll(queryOptions);

      // Popup script (extension icon) click takes focus away from current window, so need to manually set it
      const currentWindow = await chrome.windows.getCurrent();
      windows.forEach((tabWindow) => {
        tabWindow.focused = currentWindow.id ? currentWindow.id === tabWindow.id : false;
      });

      // move active window to the top
      const sortedWindows = windows
        .filter((tabWindow) => tabWindow.focused)
        .concat(windows.filter((tabWindow) => !tabWindow.focused));

      // add this window information to the 'Awaiting Storage' group
      dispatch(updateWindows({ index: 0, windows: sortedWindows }));
    },
    [dispatch]
  );

  const reFetchWindows = useCallback(async () => {
    setCreated((prevCreated) => !prevCreated);
  }, []);

  const onUpdatedHandler = useCallback(
    async (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.status === "complete") {
        await reFetchWindows();
      }
    },
    [reFetchWindows]
  );

  useEffect(() => {
    fetchWindows({ populate: true, windowTypes: ["normal"] });
  }, [fetchWindows, created]);

  useEffect(() => {
    chrome.tabs.onUpdated.addListener(onUpdatedHandler);
    chrome.tabs.onRemoved.addListener(reFetchWindows);
    chrome.windows.onCreated.addListener(reFetchWindows);
    chrome.windows.onRemoved.addListener(reFetchWindows);

    return () => {
      chrome.tabs.onUpdated.removeListener(onUpdatedHandler);
      chrome.tabs.onRemoved.removeListener(reFetchWindows);
      chrome.windows.onCreated.removeListener(reFetchWindows);
      chrome.windows.onRemoved.removeListener(reFetchWindows);
    };
  }, [reFetchWindows, onUpdatedHandler]);
}
