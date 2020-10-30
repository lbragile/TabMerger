chrome.browserAction.onClicked.addListener((tab) => {
  chrome.tabs.create(
    {
      windowId: null,
      url: "http://localhost:3000",
      active: true,
      openerTabId: tab.id,
    },
    (newTab) => {
      // wait for tab to load
      chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (changeInfo.status == "complete" && tabId == newTab.id) {
          chrome.tabs.getAllInWindow(null, (tabs) => {
            chrome.tabs.sendMessage(newTab.id, { tabs }, (response) => {
              chrome.tabs.remove(response.remove_tabs);
            });
          });
        }
      });
    }
  );
});
