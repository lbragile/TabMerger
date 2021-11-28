import { nanoid } from "nanoid";
import { BG_ACTIONS } from "./constants/backgroundActions";
import { IGroupState } from "./store/reducers/groups";
import { TSentResponse } from "./typings/background";
import { executeResponse } from "./utils/background";

interface IAvailableGroups {
  available: IGroupState[];
}

const WINDOW_QUERY_OPTIONS: chrome.windows.QueryOptions = {
  populate: true,
  windowTypes: ["normal"]
};

const getAllWindows = async () => {
  return await chrome.windows.getAll(WINDOW_QUERY_OPTIONS);
};

const handleMessage = (req: { type: string }, sender: chrome.runtime.MessageSender, res: TSentResponse<unknown>) => {
  switch (req.type) {
    case BG_ACTIONS.GET_ALL_WINDOWS:
      executeResponse<chrome.windows.Window[]>(res, getAllWindows);
      break;

    default:
      break;
  }

  return true; /** @see https://developer.chrome.com/docs/extensions/mv3/messaging/#simple near the end */
};

const tabCreateHandler = (tab: chrome.tabs.Tab) => {
  chrome.storage.local.get("available", (result) => {
    const { available } = result as IAvailableGroups;
    const windowIdx = available[0].windows.findIndex((item) => item.id === tab.windowId);

    if (windowIdx > -1) {
      const tabIds = available[0].windows[windowIdx].tabs?.map((item) => item.id);

      /**
       * Created tab should appear first in the corresponding window
       * @note Added only if it does not exist in the window already (based on tab id)
       */
      if (!tabIds?.includes(tab.id)) {
        available[0].windows[windowIdx].tabs = [tab, ...(available[0].windows[windowIdx].tabs ?? [])];
        chrome.storage.local.set({ available }, () => console.log("tab created"));
      }
    }
  });
};

const tabUpdateHandler = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
  if (changeInfo.status === "complete") {
    chrome.storage.local.get("available", (result) => {
      const { available } = result as IAvailableGroups;
      const windowIdx = available[0].windows.findIndex((item) => item.id === tab.windowId);
      const tabIdx = available[0].windows[windowIdx].tabs?.findIndex((item) => item.id === tabId);

      if (tabIdx !== undefined && tabIdx > -1 && windowIdx > -1) {
        available[0].windows[windowIdx].tabs?.splice(tabIdx, 1, tab);
        chrome.storage.local.set({ available }, () => console.log("tab updated"));
      }
    });
  }
};

const windowCreatedHandler = (currentWindow: chrome.windows.Window) => {
  if (currentWindow.type === "normal") {
    chrome.storage.local.get("available", (result) => {
      const { available } = result as IAvailableGroups;

      const existingWindow = available[0].windows.find((item) => item.id === currentWindow.id);

      /**
       * Make current windows inactive & make new window first in the list
       * @note Only if the current window does not already exist
       */
      if (!existingWindow) {
        chrome.tabs.query({ windowId: currentWindow.id }, (tabs) => {
          currentWindow.tabs = tabs;
          available[0].windows.unshift(currentWindow);
          available[0].windows.forEach((item) => (item.focused = item.id === currentWindow.id));

          chrome.storage.local.set({ available }, () => console.log("window created"));
        });
      }
    });
  }
};

const windowFocusChangeHandler = (windowId: number) => {
  chrome.storage.local.get("available", (result) => {
    const { available } = result as IAvailableGroups;

    const existingWindow = available[0].windows.find((item) => item.id === windowId);
    if (existingWindow) {
      let targetIndex = 0;
      available[0].windows.forEach((item, i) => {
        const isActive = item.id === windowId;
        item.focused = isActive;
        if (isActive) targetIndex = i;
      });

      // move focused window to the top
      const targetWindow = available[0].windows.splice(targetIndex, 1)[0];
      available[0].windows.unshift(targetWindow);

      chrome.storage.local.set({ available }, () => console.log("window focus changed"));
    }
  });
};

/**
 * Sets the "Awaiting Storage" and "Duplicates" groups with corresponding data.
 * Additionally, sets the active group information
 */
async function setDefaultData() {
  // Get all the user's current open windows into the Awaiting Storage group
  const allCurrentWindows = await chrome.windows.getAll(WINDOW_QUERY_OPTIONS);

  const activeId = nanoid(10);
  const initActive = { id: activeId, index: 0 };

  const basePermanentGroup: Pick<IGroupState, "color" | "updatedAt" | "permanent"> = {
    color: "rgba(128, 128, 128, 1)",
    updatedAt: Date.now(),
    permanent: true
  };

  const initAvailable: IGroupState[] = [
    { ...basePermanentGroup, name: "Awaiting Storage", id: activeId, windows: allCurrentWindows },
    { ...basePermanentGroup, name: "Duplicates", id: nanoid(10), windows: [] }
  ];

  await chrome.storage.local.set({ active: initActive, available: initAvailable });
}

const handleInstall = async (details: chrome.runtime.InstalledDetails) => {
  switch (details.reason) {
    case "install": {
      chrome.runtime.setUninstallURL("https://lbragile.github.io/TabMerger-Extension/survey");

      await setDefaultData();

      const { version } = chrome.runtime.getManifest();
      console.info(`Initialized Storage for TabMerger v${version}`);
      break;
    }

    case "update": {
      // It is possible to clear the local storage via `chrome.storage.local.clear()`, in which case ...
      // ... this would prevent having to remove and re-add the extension
      const { available } = await chrome.storage.local.get("available");
      if (!available) {
        await setDefaultData();
      }

      console.info("Previous Version: ", details.previousVersion);
      break;
    }

    default:
      break;
  }
};

chrome.runtime.onMessage.addListener(handleMessage);
chrome.runtime.onInstalled.addListener(handleInstall);
chrome.tabs.onCreated.addListener(tabCreateHandler);
chrome.tabs.onUpdated.addListener(tabUpdateHandler);
chrome.windows.onCreated.addListener(windowCreatedHandler);
chrome.windows.onFocusChanged.addListener(windowFocusChangeHandler);
