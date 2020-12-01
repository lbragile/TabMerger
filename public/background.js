var is_chrome = /chrome/i.test(navigator.userAgent);

const getTabsAndSend = async (info, tab) => {
  if (is_chrome) {
    chrome.tabs.query({ currentWindow: true }, (tabs) =>
      filterTabs(info, tabs, tab)
    );
  } else {
    var tabs = await browser.tabs.query({ currentWindow: true });
    filterTabs(info, tabs, tab);
  }
};

async function filterTabs(info, tabs, tab) {
  var extension_tabs = tabs.filter((item) => item.title === "TabMerger");

  var tab_urls = tabs.map((item) => item.url);

  // IF more than one unique URL, can safetly close chrome-extension tabs without closing window.
  // ELSE only chrome-extension tabs are open, so close all until one is left.
  if (new Set(tab_urls).length > 1) {
    extension_tabs.forEach(async (item) => {
      is_chrome
        ? chrome.tabs.remove(item.id)
        : await browser.tabs.remove(item.id);
    });
  } else {
    var num_tabs = extension_tabs.length;
    extension_tabs.forEach(async (item) => {
      if (num_tabs > 1) {
        is_chrome
          ? chrome.tabs.remove(item.id)
          : await browser.tabs.remove(item.id);
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

  const createOpts = { url: "index.html", active: true };
  is_chrome
    ? chrome.tabs.create(createOpts)
    : await browser.tabs.create(createOpts);

  // apply blacklist items
  tabs = tabs.filter((item) => {
    var blacklist_sites = JSON.parse(window.localStorage.getItem("settings"))
      .blacklist.replace(" ", "")
      .split(",");

    blacklist_sites = blacklist_sites.map((item) => item.toLowerCase());
    return !blacklist_sites.includes(item.url);
  });

  tabs.forEach(async (item) => {
    if (item.title !== "TabMerger") {
      is_chrome
        ? chrome.tabs.remove(item.id)
        : await browser.tabs.remove(item.id);
    }
  });

  // in case of multiple chrome-extension tabs. Can have 2 at most for any instance
  const queryOpts = { title: "TabMerger", currentWindow: true };
  if (is_chrome) {
    chrome.tabs.query(queryOpts, (tabMergerTabs) => {
      chrome.tabs.remove(tabMergerTabs[0].id);
    });
  } else {
    var tabMergerTabs = await browser.tabs.query(queryOpts);
    await browser.tabs.remove(tabMergerTabs[0].id);
  }

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
  return is_chrome ? chrome.i18n.getMessage(msg) : browser.i18n.getMessage(msg);
}

// default values
var info = { which: "all" };
var tab = { index: 0 };

is_chrome
  ? chrome.browserAction.onClicked.addListener(getTabsAndSend)
  : browser.browserAction.onClicked.addListener(getTabsAndSend);

const extensionMessage = async (request) => {
  info.which = request.msg;
  var queryOpts = { currentWindow: true, active: true };
  if (is_chrome) {
    chrome.tabs.query(queryOpts, (tabs) => {
      getTabsAndSend(info, tabs[0]);
    });
  } else {
    var tabs = await browser.tabs.query(queryOpts);
    getTabsAndSend(info, tabs[0]);
  }
};

is_chrome
  ? chrome.runtime.onMessage.addListener(extensionMessage)
  : browser.runtime.onMessage.addListener(extensionMessage);

function createContextMenu(id, title, type) {
  // prettier-ignore
  is_chrome
    ? chrome.contextMenus.create({ id, title, type })
    : browser.contextMenus.create({ id, title, type });
}

const contextMenuClick = async (info, tab) => {
  switch (info.menuItemId) {
    case "open-tabmerger":
      is_chrome
        ? window.open(chrome.runtime.getURL("index.html"))
        : await browser.tabs.create({
            active: true,
            url: browser.runtime.getURL("index.html"),
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
      is_chrome
        ? window.open(dest_url)
        : await browser.tabs.create({ active: true, url: dest_url });
      break;
    case "dl-contact":
      var dest_url = "https://tabmerger.herokuapp.com/contact";
      is_chrome
        ? window.open(dest_url)
        : await browser.tabs.create({ active: true, url: dest_url });
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
is_chrome
  ? chrome.contextMenus.onClicked.addListener(contextMenuClick)
  : browser.contextMenus.onClicked.addListener(contextMenuClick);
