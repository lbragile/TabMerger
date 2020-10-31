function getAllTabsAndSend() {
  var window_tabs = null;
  chrome.tabs.getAllInWindow(null, (tabs) => {
    window_tabs = [...tabs];
    tabs.forEach((tab) => {
      if (!tab.url.includes("tests/integration")) {
        chrome.tabs.remove(tab.id);
      }
    });
  });

  chrome.tabs.create(
    {
      windowId: null,
      url: "http://localhost:3000",
      active: true,
    },
    (newTab) => {
      // wait for tab to load
      chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (changeInfo.status == "complete" && tabId == newTab.id) {
          chrome.tabs.sendMessage(newTab.id, { tabs: window_tabs });
        }
      });
    }
  );
}

chrome.browserAction.onClicked.addListener(() => {
  getAllTabsAndSend();
});

chrome.runtime.onMessageExternal.addListener(
  (request, sender, sendResponse) => {
    if (request.msg === "get tabs") {
      getAllTabsAndSend();
    }
    return true;
  }
);
