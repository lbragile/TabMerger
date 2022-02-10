import { TABMERGER_CONTACT, TABMERGER_HELP, TABMERGER_SURVEY } from "./constants/urls";
import { prepareGroupsForSync, handleSyncUpload, setDefaultData } from "./utils/background";
import { createActiveTab, getReadableTimestamp } from "./utils/helper";

const installHandler = (details: chrome.runtime.InstalledDetails) => {
  switch (details.reason) {
    case "install": {
      chrome.runtime.setUninstallURL(TABMERGER_SURVEY);

      setDefaultData();

      const { version } = chrome.runtime.getManifest();
      console.info(`Successfully Installed TabMerger v${version}`);
      break;
    }

    case "update": {
      // It is possible to clear the local storage via `chrome.storage.local.clear()`, in which case ...
      // ... this would prevent having to remove and re-add the extension
      chrome.storage.local.get("available", ({ available }) => {
        if (!available) setDefaultData();

        console.info(`Updated TabMerger - Previous Version: ${details.previousVersion}`);
      });
      break;
    }

    default:
      break;
  }

  // Context menu needs to be created once on any install event
  chrome.contextMenus.create({ title: "Exclude Site From TabMerger Visibility", id: "exclude", contexts: ["all"] });
  chrome.contextMenus.create({ type: "separator", id: "separator-1" });
  chrome.contextMenus.create({ title: "Help", id: "help", contexts: ["all"] });
  chrome.contextMenus.create({ title: "Contact Us", id: "contact", contexts: ["all"] });
};

/**
 * Helper for either:
 * 1. Clearing (checkbox became 'unchecked')
 * 2. Updating an alarm (a property of the alarm changed OR it was enabled)
 */
function updateAlarm(type: "autoExport" | "autoSync", newValue?: boolean) {
  const item = type === "autoExport" ? "exportFreq" : "syncFreq";
  const alarmName = type + "Alarm";

  if (newValue) {
    chrome.storage.local.get([item], (result) => {
      chrome.alarms.create(alarmName, { when: Date.now(), periodInMinutes: result[item] });
    });
  } else {
    chrome.alarms.clear(alarmName, () => "");
  }
}

const storageChangeHandler = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: "sync" | "local" | "managed"
) => {
  if (areaName !== "local") return;

  const changedKeys = Object.keys(changes);
  const relevantKeys = ["autoExport", "exportFreq", "autoSync", "syncFreq"];

  // Only create/update alarm when one of the following changed
  if (!changedKeys.some((key) => relevantKeys.includes(key))) return;

  chrome.storage.local.get(relevantKeys, ({ autoExport, autoSync }) => {
    updateAlarm("autoExport", !!autoExport);
    updateAlarm("autoSync", !!autoSync);
  });
};

/**
 * When a download completes, need to set the export timestamp and re-show the gray download shelf
 */
const downloadStatusHandler = (downloadDelta: chrome.downloads.DownloadDelta) => {
  if (downloadDelta.state?.current === "complete") {
    try {
      chrome.downloads.setShelfEnabled(true);
      chrome.storage.local.set({ lastExport: getReadableTimestamp() }, () => "");
    } catch (err) {
      /**
       * Enabling the shelf while at least one other extension has disabled it will return an error through runtime.lastError
       * @see https://developer.chrome.com/docs/extensions/reference/downloads/#type-DownloadOptions
       */
      // Do nothing
    }
  }
};

/**
 * Depending on the triggering alarm, executes an action
 *
 * To export, simply stringify the current storage object.
 * Depending on user settings, this also clears the old files from the directory and downloads history.
 *
 * To sync, the same functionality found in the main sync modal tab is performed
 * @param alarm
 */
const alarmHandler = (alarm: chrome.alarms.Alarm) => {
  if (alarm.name === "autoExportAlarm") {
    chrome.storage.local.get(null, (result) => {
      const reader = new FileReader();

      const name = `TabMerger Auto Export.json`;
      const newFile = new File([JSON.stringify(result, null, 4)], name, { type: "application/json" });

      reader.addEventListener(
        "load",
        () => {
          // Disable download shelf as automatic exports should happen in the background
          chrome.downloads.setShelfEnabled(false);
          chrome.downloads.download(
            {
              conflictAction: "uniquify",
              saveAs: false,
              filename: `TabMerger Backups/${name}`,
              url: reader.result as string
            },
            (downloadId) => {
              chrome.storage.local.get(["downloads", "exportMax"], (result) => {
                const downloads: number[] = result.downloads ?? [];
                let newDownloads: number[] = [];
                if (downloads.length === (result.exportMax as number)) {
                  const removeId = downloads[downloads.length - 1];

                  // Remove oldest download from directory
                  chrome.downloads.removeFile(removeId, () => "");

                  // Remove oldest download from history (chrome://downloads)
                  chrome.downloads.erase({ id: removeId }, () => "");

                  newDownloads = [downloadId, ...downloads.slice(0, -1)];
                } else {
                  newDownloads = [downloadId, ...downloads];
                }

                chrome.storage.local.set({ downloads: newDownloads }, () => "");
              });
            }
          );
        },
        false
      );

      if (newFile) {
        reader.readAsDataURL(newFile);
      }
    });
  } else if (alarm.name === "autoSyncAlarm") {
    chrome.storage.local.get(["available"], (result) => {
      handleSyncUpload(prepareGroupsForSync(result.available));
    });
  }
};

/**
 * Helper to add a tab URL to the filter list of ignored tabs
 * @note Query parameters are omitted
 */
function excludeTab(tab: chrome.tabs.Tab | undefined) {
  const { url } = tab ?? {};
  if (url) {
    chrome.storage.local.get(["urlFilter"], (result) => {
      chrome.storage.local.set({ urlFilter: url.split("?")[0] + ",\n" + (result.urlFilter ?? "") }, () => "");
    });
  }
}

const contextMenuHandler = (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
  switch (info.menuItemId) {
    case "exclude":
      excludeTab(tab);
      break;

    case "help":
      createActiveTab(TABMERGER_HELP);
      break;

    case "contact":
      createActiveTab(TABMERGER_CONTACT);
      break;

    default:
      break;
  }
};

/**
 * Excluding is a "global" command (happens outside of the popup) ...
 * ... and thus needs to be handled in the background service worker
 */
const commandsHandler = (command: string, tab: chrome.tabs.Tab) => {
  if (command === "exclude") {
    excludeTab(tab);
  }
};

chrome.runtime.onInstalled.addListener(installHandler);
chrome.alarms.onAlarm.addListener(alarmHandler);
chrome.storage.onChanged.addListener(storageChangeHandler);
chrome.downloads.onChanged.addListener(downloadStatusHandler);
chrome.contextMenus.onClicked.addListener(contextMenuHandler);
chrome.commands.onCommand.addListener(commandsHandler);
