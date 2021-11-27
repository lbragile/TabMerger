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

/**
 * Whenever a tab's url is updated, it needs to be reflected in the local storage.
 * This can happen due to the following:
 * 1. A window is created (new tab is added by default)
 * 2. A tab is created in an existing window
 * 3. Navigation occurs within a tab (url change) in an existing window
 */
const tabUpdateHandler = async (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
  if (changeInfo.status === "complete") {
    const { available } = (await chrome.storage.local.get("available")) as IAvailableGroups;

    // Check if there is a window (in local storage - not what the user has on screen!) with a matching id...
    // ... to the tab's windowId → if not, condition 1. is met
    const possibleWindows = available[0].windows.map((item, i) => {
      if (item.id === tab.windowId) return { value: item, index: i };
    });

    // removed undefined entries
    const containingWindow = possibleWindows.filter((item) => item);

    // Only matters if condition 1. fails ...
    // ... Check if there is a window (again in local storage) with a matching tab based on the tabId: ...
    // ... if not, condition 2. is met, otherwise condition 3. is met
    const possibleExistingTab = containingWindow?.[0]?.value?.tabs?.map((item, i) => {
      if (item.id === tabId) return { value: item, index: i };
    });

    // removed undefined entries
    const existingTab = possibleExistingTab?.filter((item) => item);

    if (!containingWindow[0]) {
      // console.log("created window");
      const currentWindow = await chrome.windows.getCurrent(WINDOW_QUERY_OPTIONS);
      available[0].windows.push(currentWindow);
    } else if (!existingTab?.[0]) {
      // console.log("created tab");
      const { index } = containingWindow[0];
      const currentTab = await chrome.tabs.get(tabId);
      available[0].windows[index].tabs = [...(available[0].windows[index].tabs ?? []), currentTab];
    } else {
      // console.log("updated tab");
      const { index: windowIdx } = containingWindow[0];
      const { index: tabIdx } = existingTab[0];
      available[0].windows[windowIdx].tabs?.splice(tabIdx, 1, tab);
    }

    await chrome.storage.local.set({ available });
  }
};

const handleInstall = async (details: chrome.runtime.InstalledDetails) => {
  switch (details.reason) {
    case "install": {
      chrome.runtime.setUninstallURL("https://lbragile.github.io/TabMerger-Extension/survey");

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

      chrome.storage.local.set({ active: initActive, available: initAvailable }, () => {
        const { version } = chrome.runtime.getManifest();
        console.info(`Initialized Storage for TabMerger v${version}`);
      });

      break;
    }

    case "update": {
      console.info("Previous Version: ", details.previousVersion);
      break;
    }

    default:
      break;
  }
};

chrome.runtime.onMessage.addListener(handleMessage);

chrome.runtime.onInstalled.addListener(handleInstall);
chrome.tabs.onUpdated.addListener(tabUpdateHandler);
