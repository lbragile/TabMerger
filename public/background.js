function getTabsAndSend(info, tab) {
  chrome.tabs.getAllInWindow(null, (tabs) => {
    var extension_tabs = tabs.filter((item) =>
      item.url.includes("chrome-extension")
    );

    var tab_urls = tabs.map((item) => item.url);

    // IF more than one unique URL, can safetly close chrome-extension tabs without closing window.
    // ELSE only chrome-extension tabs are open, so close all until one is left.
    if (new Set(tab_urls).length > 1) {
      extension_tabs.forEach((item) => {
        chrome.tabs.remove(item.id);
      });
    } else {
      var num_tabs = extension_tabs.length;
      extension_tabs.forEach((item) => {
        if (num_tabs > 1) {
          chrome.tabs.remove(item.id);
          num_tabs--;
        }
      });
    }

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
      tabs = [tab, ...extension_tabs];
    }
    //else info.which === "all" (works by default)

    chrome.tabs.create({
      url: "index.html",
      active: true,
    });

    // apply blacklist items
    tabs = tabs.filter((item) => {
      var blacklist = JSON.parse(window.localStorage.getItem("settings"))
        .blacklist.replace(" ", "")
        .split(",");

      blacklist.map((item) => item.toLowerCase());

      var matched = false;
      blacklist.forEach((blacklist_url) => {
        if (item.url === blacklist_url) {
          matched = true;
        }
      });

      return !matched;
    });

    tabs.forEach((item) => {
      if (!item.url.includes("chrome-extension")) {
        chrome.tabs.remove(item.id);
      }
    });

    // in case of multiple chrome-extension tabs. Can have 2 at most for any instance
    chrome.tabs.query(
      { title: "TabMerger", currentWindow: true },
      (tabMergerTabs) => {
        chrome.tabs.remove(tabMergerTabs[0].id);
      }
    );

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
