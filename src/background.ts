import { nanoid } from "nanoid";
import { BG_ACTIONS } from "./constants/backgroundActions";
import { IGroupState } from "./store/reducers/groups";
import { TSentResponse } from "./typings/background";
import { executeResponse } from "./utils/background";

interface IAvailableGroups {
  available: IGroupState[];
}

const getAllWindows = async () => {
  return await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
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

/** Add a new tab to the end of the window where it was added */
const tabCreateHandler = async (tab: chrome.tabs.Tab) => {
  const { available } = (await chrome.storage.local.get("available")) as IAvailableGroups;
  available[0].windows.forEach((browserWindow) => {
    if (browserWindow.id === tab.windowId) {
      browserWindow.tabs = [...(browserWindow.tabs ?? []), tab];
    }
  });

  await chrome.storage.local.set({ available });
};

/** Whenever a tab's url is updated, it needs to be reflected in the local storage
 * @note This is also triggered upon tab creation & window creation (since a new tab is added by default)
 */
const tabUpdateHandler = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
  console.log(changeInfo);
  if (changeInfo.status === "complete") {
    console.log(tabId, tab);
  }
};

/** Add the newly created window to the end of the list */
const windowCreateHandler = async (
  browserWindow: chrome.windows.Window,
  filters: chrome.windows.WindowEventFilter = { windowTypes: ["normal"] }
) => {
  if (filters.windowTypes.includes(browserWindow.type ?? "normal")) {
    const { available } = (await chrome.storage.local.get("available")) as IAvailableGroups;
    available[0].windows.push(browserWindow);
    await chrome.storage.local.set({ available });
  }
};

const handleInstall = async (details: chrome.runtime.InstalledDetails) => {
  console.log("Previous Version: ", details.previousVersion);

  if (details.reason === "install") {
    const activeId = nanoid(10);
    const initActive = { id: activeId, index: 0 };
    const initAvailable: IGroupState[] = [
      {
        name: "Awaiting Storage",
        id: activeId,
        color: "rgba(128, 128, 128, 1)",
        updatedAt: Date.now(),
        windows: [],
        permanent: true
      },
      {
        name: "Duplicates",
        id: nanoid(10),
        color: "rgba(128, 128, 128, 1)",
        updatedAt: Date.now(),
        windows: [],
        permanent: true
      }
    ];

    await chrome.storage.local.set({ active: initActive });
    await chrome.storage.local.set({ available: initAvailable });

    console.log("initialized storage");
  }
};

chrome.runtime.onMessage.addListener(handleMessage);

chrome.runtime.onInstalled.addListener(handleInstall);
chrome.tabs.onCreated.addListener(tabCreateHandler);
chrome.tabs.onUpdated.addListener(tabUpdateHandler);
chrome.windows.onCreated.addListener(windowCreateHandler);
