window.payload = {};

function getAllTabsAndSend(samePage) {
  chrome.tabs.getAllInWindow(null, (tabs) => {
    if (!samePage) {
      chrome.tabs.create({
        url: "index.html",
        active: true,
      });
    } else {
      tabs.forEach((tab) => {
        if (!tab.url.includes("chrome-extension")) {
          chrome.tabs.remove(tab.id);
        }
      });
    }
    window.payload["tabs"] = tabs;
  });
}

chrome.browserAction.onClicked.addListener(() => {
  getAllTabsAndSend(false);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.msg === "get tabs") {
    getAllTabsAndSend(true);
  }
  return true;
});
