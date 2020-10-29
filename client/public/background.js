var target_url = "http://localhost:3000";
chrome.browserAction.onClicked.addListener((tab) => {
  chrome.tabs.create(
    {
      windowId: null,
      url: target_url,
      active: true,
      openerTabId: tab.id,
    },
    (newTab) => {
      // wait for tab to load
      chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (changeInfo.status == "complete" && tabId == newTab.id) {
          chrome.tabs.getAllInWindow(null, (tabs) => {
            chrome.cookies.set({
              url: target_url,
              name: "tabs",
              value: JSON.stringify(tabs),
            });
          });
        }
      });
    }
  );
});
