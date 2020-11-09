function getTabsAndSend(info, tab) {
  chrome.tabs.getAllInWindow(null, (tabs) => {
    for (var i in tabs) {
      if (info.which === "right" && i > tab.index) {
        tabs.splice(0, i);
      } else if (info.which === "left") {
        tabs.splice(tab.index);
        break;
      } else if (info.which === "excluding") {
        tabs.splice(tab.index, 1);
        break;
      } else if (info.which === "only") {
        var extension_tabs = tabs.filter((item) =>
          item.url.includes("chrome-extension")
        );
        tabs = [tab, ...extension_tabs];
        break;
      }
      //else info.which === "all" (works by default)
    }

    if (!info.samePage) {
      tabs.forEach((item) => {
        chrome.tabs.remove(item.id);
      });

      chrome.tabs.create({
        url: "index.html",
        active: true,
      });
    } else {
      tabs.forEach((item) => {
        if (!item.url.includes("chrome-extension")) {
          chrome.tabs.remove(item.id);
        }
      });
    }

    window.localStorage.setItem("merged_tabs", JSON.stringify(tabs));
  });
}

// default values
var info = { samePage: false, which: "all" };
var tab = { index: 0 };

chrome.browserAction.onClicked.addListener(() => {
  getTabsAndSend(info, tab);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.msg === "get tabs") {
    info.samePage = true;

    getTabsAndSend(info, tab);
  }
  return true;
});

chrome.contextMenus.create({
  title: "Merge tabs to LEFT of current tab in this window",
  onclick: (info, tab) => {
    info.which = "left";
    getTabsAndSend(info, tab);
  },
});

chrome.contextMenus.create({
  title: "Merge tabs to RIGHT of current tab in this window",
  onclick: (info, tab) => {
    info.which = "right";
    getTabsAndSend(info, tab);
  },
});

chrome.contextMenus.create({
  title: "Merge tabs EXCLUDING current tab in this window",
  onclick: (info, tab) => {
    info.which = "excluding";
    getTabsAndSend(info, tab);
  },
});

chrome.contextMenus.create({
  title: "Merge ONLY current tab in this window",
  onclick: (info, tab) => {
    info.which = "only";
    getTabsAndSend(info, tab);
  },
});

chrome.contextMenus.create({
  title: "Merge ALL tabs in this window",
  onclick: (info, tab) => {
    info.which = "all";
    getTabsAndSend(info, tab);
  },
});
