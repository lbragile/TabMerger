const getTabsAndSend = (info, tab, group_id) => {
  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    var extension_tabs = tabs.filter((item) => item.title === "TabMerger");
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

    switch (info.which) {
      case "right":
        tabs = tabs.filter((item) => item.index > tab.index);
        break;
      case "left":
        tabs.splice(tab.index);
        break;
      case "excluding":
        tabs.splice(tab.index, 1);
        break;
      case "only":
        tabs = [tab, ...extension_tabs];
        break;

      default:
        // info.which === "all"
        break;
    }

    chrome.tabs.create({ url: "index.html", active: true });

    // apply blacklist items
    tabs = tabs.filter((item) => {
      var blacklist_sites = JSON.parse(window.localStorage.getItem("settings"))
        .blacklist.replace(" ", "")
        .split(",");

      blacklist_sites = blacklist_sites.map((item) => item.toLowerCase());
      return !blacklist_sites.includes(item.url);
    });

    tabs.forEach((item) => {
      if (item.title !== "TabMerger") {
        chrome.tabs.remove(item.id);
      }
    });

    // in case of multiple chrome-extension tabs. Can have 2 at most for any instance
    const queryOpts = { title: "TabMerger", currentWindow: true };
    chrome.tabs.query(queryOpts, (tabMergerTabs) => {
      chrome.tabs.remove(tabMergerTabs[0].id);
    });

    window.localStorage.setItem("merged_tabs", JSON.stringify(tabs));
    window.localStorage.setItem("into_group", group_id ? group_id : "group-0");
  });
};

function excludeSite(info, tab) {
  var settings = JSON.parse(window.localStorage.getItem("settings")) || {};
  if (!settings.blacklist || settings.blacklist === "") {
    settings.blacklist += `${tab.url}`;
  } else {
    settings.blacklist += `, ${tab.url}`;
  }
  window.localStorage.setItem("settings", JSON.stringify(settings));
}

function translate(msg) {
  return chrome.i18n.getMessage(msg);
}

// default values
var info = { which: "all" };
var tab = { index: 0 };

chrome.browserAction.onClicked.addListener(getTabsAndSend);

const extensionMessage = (request) => {
  info.which = request.msg;
  var queryOpts = { currentWindow: true, active: true };
  chrome.tabs.query(queryOpts, (tabs) => {
    getTabsAndSend(info, tabs[0], request.id);
  });
};

chrome.runtime.onMessage.addListener(extensionMessage);

function createContextMenu(id, title, type) {
  chrome.contextMenus.create({ id, title, type });
}

const contextMenuClick = (info, tab) => {
  switch (info.menuItemId) {
    case "open-tabmerger":
      chrome.tabs.create({
        active: true,
        url: chrome.runtime.getURL("index.html"),
      });
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
      var dest_url = "https://tabmerger.herokuapp.com/instructions";
      chrome.tabs.create({ active: true, url: dest_url });
      break;
    case "dl-contact":
      var dest_url = "https://tabmerger.herokuapp.com/contact";
      chrome.tabs.create({ active: true, url: dest_url });
      break;

    default:
      getTabsAndSend(info, tab);
      break;
  }
};

createContextMenu("open-tabmerger", translate("bgOpen"));

createContextMenu("first-separator", "separator", "separator");
createContextMenu("merge-all-menu", translate("bgAll"));
createContextMenu("merge-left-menu", translate("bgLeft"));
createContextMenu("merge-right-menu", translate("bgRight"));
createContextMenu("merge-excluding-menu", translate("bgExclude"));
createContextMenu("merge-only-menu", translate("bgOnly"));

createContextMenu("second-separator", "separator", "separator");
createContextMenu("exclude-settings-menu", translate("bgSiteExclude"));

createContextMenu("third-separator", "separator", "separator");
createContextMenu("dl-instructions", translate("bgInstructions"));
createContextMenu("dl-contact", translate("bgContact"));

// context menu actions
chrome.contextMenus.onClicked.addListener(contextMenuClick);
