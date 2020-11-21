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
      tabs = tabs.filter((item) => item.index > tab.index);
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

function excludeSite(info, tab) {
  var settings = JSON.parse(window.localStorage.getItem("settings")) || {};
  if (!settings.blacklist || settings.blacklist === "") {
    settings.blacklist += `${tab.url}`;
  } else {
    settings.blacklist += `, ${tab.url}`;
  }
  window.localStorage.setItem("settings", JSON.stringify(settings));
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
  id: "open-tabmerger",
  title: chrome.i18n.getMessage("bgOpen"),
});

chrome.contextMenus.create({
  id: "first-separator",
  type: "separator",
});

chrome.contextMenus.create({
  id: "merge-all-menu",
  title: chrome.i18n.getMessage("bgAll"),
});

chrome.contextMenus.create({
  id: "merge-left-menu",
  title: chrome.i18n.getMessage("bgLeft"),
});

chrome.contextMenus.create({
  id: "merge-right-menu",
  title: chrome.i18n.getMessage("bgRight"),
});

chrome.contextMenus.create({
  id: "merge-excluding-menu",
  title: chrome.i18n.getMessage("bgExclude"),
});

chrome.contextMenus.create({
  id: "merge-only-menu",
  title: chrome.i18n.getMessage("bgOnly"),
});

chrome.contextMenus.create({
  id: "second-separator",
  type: "separator",
});

chrome.contextMenus.create({
  id: "exclude-settings-menu",
  title: chrome.i18n.getMessage("bgSiteExclude"),
});

chrome.contextMenus.create({
  id: "third-separator",
  type: "separator",
});

chrome.contextMenus.create({
  id: "dl-instructions",
  title: chrome.i18n.getMessage("bgInstructions"),
});

chrome.contextMenus.create({
  id: "dl-contact",
  title: chrome.i18n.getMessage("bgContact"),
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  switch (info.menuItemId) {
    case "open-tabmerger":
      window.open(chrome.runtime.getURL("index.html"));
      break;
    case "merge-left-menu":
      info.which = "left";
      getTabsAndSend(info, tab);
      break;
    case "merge-right-menu":
      info.which = "right";
      getTabsAndSend(info, tab);
      break;
    case "merge-excluding-menu":
      info.which = "excluding";
      getTabsAndSend(info, tab);
      break;
    case "merge-only-menu":
      info.which = "only";
      getTabsAndSend(info, tab);
      break;
    case "exclude-settings-menu":
      excludeSite(info, tab);
      break;
    case "dl-instructions":
      window.open("https://tabmerger.herokuapp.com/instructions");
      break;
    case "dl-contact":
      window.open("https://tabmerger.herokuapp.com/contact");
      break;

    default:
      getTabsAndSend(info, tab);
      break;
  }
});
