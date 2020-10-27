chrome.browserAction.onClicked.addListener((tab) => {
  chrome.tabs.create(
    {
      windowId: null,
      url: "./popup.html",
      active: true,
      openerTabId: tab.id,
    },
    (newTab) => {
      newTab.group_name = "StackOverflow";
      chrome.tabs.executeScript(newTab.id, { file: "./content.js" });
    }
  );
});
