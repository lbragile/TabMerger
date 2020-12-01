const getTabsAndSend = async (info, tab) => {
  if (chrome) {
    chrome.tabs.query({ currentWindow: true }, (tabs) =>
      filterTabs(info, tabs)
    );
  } else {
    var tabs = await browser.tabs.query({ currentWindow: true });
    filterTabs(info, tabs);
  }
};

function filterTabs(info, tabs) {
  var extension_tabs = tabs.filter((item) =>
    item.url.includes("chrome-extension")
  );

  var tab_urls = tabs.map((item) => item.url);

  // IF more than one unique URL, can safetly close chrome-extension tabs without closing window.
  // ELSE only chrome-extension tabs are open, so close all until one is left.
  if (new Set(tab_urls).length > 1) {
    extension_tabs.forEach(async (item) => {
      chrome ? chrome.tabs.remove(item.id) : await browser.tabs.remove(item.id);
    });
  } else {
    var num_tabs = extension_tabs.length;
    extension_tabs.forEach(async (item) => {
      if (num_tabs > 1) {
        chrome
          ? chrome.tabs.remove(item.id)
          : await browser.tabs.remove(item.id);
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

  const createOpts = { url: "index.html", active: true };
  chrome ? chrome.tabs.create(createOpts) : browser.tabs.create(createOpts);

  // apply blacklist items
  tabs = tabs.filter((item) => {
    var blacklist_sites = JSON.parse(window.localStorage.getItem("settings"))
      .blacklist.replace(" ", "")
      .split(",");

    blacklist_sites = blacklist_sites.map((item) => item.toLowerCase());
    return !blacklist_sites.includes(item.url);
  });

  tabs.forEach(async (item) => {
    if (!item.url.includes("chrome-extension")) {
      chrome ? chrome.tabs.remove(item.id) : await browser.tabs.remove(item.id);
    }
  });

  // in case of multiple chrome-extension tabs. Can have 2 at most for any instance
  const queryOpts = { title: "TabMerger", currentWindow: true };
  chrome
    ? chrome.tabs.query(queryOpts, (tabMergerTabs) => {
        chrome.tabs.remove(tabMergerTabs[0].id);
      })
    : browser.tabs.query(queryOpts, async (tabMergerTabs) => {
        await browser.tabs.remove(tabMergerTabs[0].id);
      });

  window.localStorage.setItem("merged_tabs", JSON.stringify(tabs));
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

function translate(msg) {
  return chrome ? chrome.i18n.getMessage(msg) : browser.i18n.getMessage(msg);
}

// default values
var info = { which: "all" };
var tab = { index: 0 };

chrome
  ? chrome.browserAction.onClicked.addListener(getTabsAndSend)
  : browser.browserAction.onClicked.addListener(getTabsAndSend);

const extensionMessage = (request) => {
  info.which = request.msg;
  chrome.tabs.query({ currentWindow: true, active: true }, (tabs) => {
    getTabsAndSend(info, tabs[0]);
  });
};

chrome
  ? chrome.runtime.onMessage.addListener(extensionMessage)
  : browser.runtime.onMessage.addListener(extensionMessage);

function createContextMenu(id, title, type) {
  // prettier-ignore
  chrome
    ? chrome.contextMenus.create({ id, title, type })
    : browser.contextMenus.create({ id, title, type });
}

const contextMenuClick = (info, tab) => {
  switch (info.menuItemId) {
    case "open-tabmerger":
      window.open(chrome.runtime.getURL("index.html"));
      console.log(chrome.runtime.getURL("index.html"));
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
chrome
  ? chrome.contextMenus.onClicked.addListener(contextMenuClick)
  : browser.contextMenus.onClicked.addListener(contextMenuClick);
