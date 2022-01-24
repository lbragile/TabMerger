import { TABMERGER_SURVEY } from "./constants/urls";
import { ISyncDataItem } from "./store/reducers/modal";
import { handleSyncUpload, setDefaultData } from "./utils/background";

const handleMessage = (req: { type: string }) => {
  switch (req.type) {
    default:
      break;
  }

  /** @see https://developer.chrome.com/docs/extensions/mv3/messaging/#simple near the end */
  return true;
};

const handleInstall = (details: chrome.runtime.InstalledDetails) => {
  switch (details.reason) {
    case "install": {
      chrome.runtime.setUninstallURL(TABMERGER_SURVEY);

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

function handleAlarmUpdate(type: "autoExport" | "autoSync", newValue?: boolean) {
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

chrome.storage.onChanged.addListener(
  (changes: Record<string, chrome.storage.StorageChange>, areaName: "sync" | "local" | "managed") => {
    if (areaName !== "local") return;

    const changedKeys = Object.keys(changes);
    const relevantKeys = ["autoExport", "exportFreq", "autoSync", "syncFreq"];

    // Only create/update alarm when one of the following changed
    if (!changedKeys.some((key) => relevantKeys.includes(key))) return;

    chrome.storage.local.get(relevantKeys, ({ autoExport, autoSync }) => {
      handleAlarmUpdate("autoExport", !!autoExport);
      handleAlarmUpdate("autoSync", !!autoSync);
    });
  }
);

chrome.downloads.onChanged.addListener((downloadDelta) => {
  if (downloadDelta.state?.current === "complete") {
    try {
      chrome.downloads.setShelfEnabled(true);
    } catch (err) {
      /**
       * Enabling the shelf while at least one other extension has disabled it will return an error through runtime.lastError
       * @see https://developer.chrome.com/docs/extensions/reference/downloads/#type-DownloadOptions
       */
      // Do nothing
    }
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
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
            () => ""
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
      handleSyncUpload(result.available as ISyncDataItem[]);
    });
  }
});

chrome.runtime.onInstalled.addListener(handleInstall);
chrome.runtime.onMessage.addListener(handleMessage);
