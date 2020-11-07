function getAllTabsAndSend(samePage) {
  var url =
    "%NODE_ENV%" === "production"
      ? "https://tabmerger.netlify.app"
      : "http://localhost:3000";

  chrome.tabs.getAllInWindow(null, (tabs) => {
    tabs.forEach((tab) => {
      if (!tab.url.includes("localhost")) {
        chrome.tabs.remove(tab.id);
      }
    });
    !samePage
      ? chrome.tabs.create(
          {
            windowId: null,
            url: url,
            active: true,
          },
          (newTab) => {
            chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
              if (changeInfo.status == "complete" && tabId === newTab.id) {
                chrome.tabs.sendMessage(newTab.id, { tabs });
              }
            });
          }
        )
      : chrome.tabs.query(
          { active: true, windowId: tabs[0].windowId },
          (activeTab) => {
            chrome.tabs.sendMessage(activeTab[0].id, { tabs });
          }
        );
  });
}

chrome.browserAction.onClicked.addListener(() => {
  getAllTabsAndSend(false);
});

chrome.runtime.onMessageExternal.addListener(
  (request, sender, sendResponse) => {
    if (request.msg === "get tabs") {
      getAllTabsAndSend(true);
    }
    return true;
  }
);
