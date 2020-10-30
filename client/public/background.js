chrome.browserAction.onClicked.addListener((tab) => {
  var window_tabs = null;
  chrome.tabs.getAllInWindow(null, (tabs) => {
    window_tabs = [...tabs];
    tabs.forEach((tab) => {
      chrome.tabs.remove(tab.id);
    });
  });

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
          chrome.tabs.sendMessage(newTab.id, { tabs: window_tabs });
        }
      });
    }
  );
});
