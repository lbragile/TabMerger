function getAllTabsAndSend(samePage) {
  chrome.tabs.getAllInWindow(null, (tabs) => {
    tabs.forEach((tab) => {
      if (!tab.url.includes("localhost") && !tab.url.includes("netlify")) {
        chrome.tabs.remove(tab.id);
      }
    });
    !samePage
      ? chrome.tabs.create(
          {
            windowId: null,
            url: "https://tabmerger.netlify.app",
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
