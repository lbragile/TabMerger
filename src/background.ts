import { nanoid } from "nanoid";
import { IGroupState } from "./store/reducers/groups";
// import { BG_ACTIONS } from "./constants/backgroundActions";
// import { TSentResponse } from "./typings/background";
// import { executeResponse } from "./utils/background";

interface IAvailableGroups {
  available: IGroupState[];
}

const WINDOW_QUERY_OPTIONS: chrome.windows.QueryOptions = {
  populate: true,
  windowTypes: ["normal"]
};

const handleMessage = (req: { type: string } /*sender: chrome.runtime.MessageSender, res: TSentResponse<unknown>*/) => {
  switch (req.type) {
    // case BG_ACTIONS.GET_ALL_WINDOWS:
    //   executeResponse<chrome.windows.Window[]>(res, async function);
    //   break;

    default:
      break;
  }

  return true; /** @see https://developer.chrome.com/docs/extensions/mv3/messaging/#simple near the end */
};

function sortWindowsByFocus(windows: chrome.windows.Window[]): {
  sortedWindows: chrome.windows.Window[];
  hasFocused: boolean;
} {
  const focused = windows.filter((w) => w.focused);
  const notFocused = windows.filter((w) => !w.focused);

  return { sortedWindows: focused.concat(notFocused), hasFocused: focused.length > 0 };
}

const updateAwaitingStorageWindows = () => {
  chrome.storage.local.get("available", (result) => {
    const { available } = result as IAvailableGroups;

    chrome.windows.getAll(WINDOW_QUERY_OPTIONS, (currentWindows) => {
      const { sortedWindows, hasFocused } = sortWindowsByFocus(currentWindows);

      if (hasFocused) {
        available[0].windows = sortedWindows;
      } else {
        // can happen on tab or window removal
        currentWindows[0].focused = true;
        available[0].windows = currentWindows;
      }

      chrome.storage.local.set({ available }, () => "");
    });
  });
};

const tabUpdateHandler = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
  if (changeInfo.status === "complete") {
    updateAwaitingStorageWindows();
  }
};

const windowFocusChangedHandler = (windowId: number) => {
  chrome.windows.get(windowId, WINDOW_QUERY_OPTIONS, (currentWindow) => {
    if (currentWindow.type === "normal") {
      updateAwaitingStorageWindows();
    }
  });
};

/**
 * Sets the "Awaiting Storage" and "Duplicates" groups with corresponding data.
 * Additionally, sets the active group information
 */
function setDefaultData() {
  // Get all the user's current open windows into the Awaiting Storage group
  chrome.windows.getAll(WINDOW_QUERY_OPTIONS, (windows) => {
    const activeId = nanoid(10);
    const active = { id: activeId, index: 0 };

    const basePermanentGroup: Pick<IGroupState, "color" | "updatedAt" | "permanent"> = {
      color: "rgba(128, 128, 128, 1)",
      updatedAt: Date.now(),
      permanent: true
    };

    const { sortedWindows } = sortWindowsByFocus(windows);

    const available: IGroupState[] = [
      { ...basePermanentGroup, name: "Awaiting Storage", id: activeId, windows: sortedWindows },
      { ...basePermanentGroup, name: "Duplicates", id: nanoid(10), windows: [] }
    ];

    chrome.storage.local.set({ active, available }, () => "");
  });
}

const handleInstall = (details: chrome.runtime.InstalledDetails) => {
  switch (details.reason) {
    case "install": {
      chrome.runtime.setUninstallURL("https://lbragile.github.io/TabMerger-Extension/survey");

      setDefaultData();

      const { version } = chrome.runtime.getManifest();
      console.info(`Initialized Storage for TabMerger v${version}`);
      break;
    }

    case "update": {
      // It is possible to clear the local storage via `chrome.storage.local.clear()`, in which case ...
      // ... this would prevent having to remove and re-add the extension
      chrome.storage.local.get("available", ({ available }) => {
        if (!available) {
          setDefaultData();
        }

        console.info("Previous Version: ", details.previousVersion);
      });
      break;
    }

    default:
      break;
  }
};

chrome.runtime.onInstalled.addListener(handleInstall);

chrome.runtime.onMessage.addListener(handleMessage);

chrome.tabs.onCreated.addListener(updateAwaitingStorageWindows);
chrome.tabs.onUpdated.addListener(tabUpdateHandler);
chrome.tabs.onRemoved.addListener(updateAwaitingStorageWindows);
chrome.tabs.onDetached.addListener(updateAwaitingStorageWindows);
chrome.tabs.onAttached.addListener(updateAwaitingStorageWindows);

chrome.windows.onCreated.addListener(updateAwaitingStorageWindows);
chrome.windows.onRemoved.addListener(updateAwaitingStorageWindows);
chrome.windows.onBoundsChanged.addListener(updateAwaitingStorageWindows);
chrome.windows.onFocusChanged.addListener(windowFocusChangedHandler);
