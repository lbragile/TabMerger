import { setDefaultData } from "./utils/background";
// import { BG_ACTIONS } from "./constants/backgroundActions";
// import { TSentResponse } from "./typings/background";
// import { executeResponse } from "./utils/background";

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
        if (!available) setDefaultData();

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
