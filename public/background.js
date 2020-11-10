function getTabsAndSend(info, tab) {
  chrome.tabs.getAllInWindow(null, (tabs) => {
    tabs.forEach((item, index) => {
      if (item.url.includes("chrome-extension")) {
        chrome.tabs.remove(item.id);
      }
    });

    if (info.which === "right") {
      for (var i in tabs) {
        if (i > tab.index) {
          tabs.splice(0, i);
        }
      }
    } else if (info.which === "left") {
      tabs.splice(tab.index);
    } else if (info.which === "excluding") {
      tabs.splice(tab.index, 1);
    } else if (info.which === "only") {
      var extension_tabs = tabs.filter((item) =>
        item.url.includes("chrome-extension")
      );
      tabs = [tab, ...extension_tabs];
    }
    //else info.which === "all" (works by default)

    chrome.tabs.create({
      url: "index.html",
      active: true,
    });

    tabs.forEach((item, index) => {
      if (!item.url.includes("chrome-extension")) {
        chrome.tabs.remove(item.id);
      }
    });

    window.localStorage.setItem("merged_tabs", JSON.stringify(tabs));
  });
}

// default values
var info = { which: "all" };
var tab = { index: 0 };

chrome.browserAction.onClicked.addListener(() => {
  getTabsAndSend(info, tab);
});

chrome.runtime.onMessage.addListener((request) => {
  info.which = request.msg;
  chrome.tabs.query({ currentWindow: true, active: true }, (tabs) => {
    getTabsAndSend(info, tabs[0]);
  });
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
