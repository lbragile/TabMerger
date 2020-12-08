function getTabsAndSend(info, tab, group_id) {
  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    switch (info.which) {
      case "right":
        tabs = tabs.filter(
          (item) => item.index > tab.index && item.title !== "TabMerger"
        );
        break;
      case "left":
        tabs = tabs.filter(
          (item) => item.index < tab.index && item.title !== "TabMerger"
        );
        break;
      case "excluding":
        tabs = tabs.filter(
          (item) => item.index !== tab.index && item.title !== "TabMerger"
        );
        break;
      case "only":
        tabs = tabs.filter(
          (item) => item.index === tab.index && item.title !== "TabMerger"
        );
        break;

      default:
        //all
        tabs = tabs.filter((item) => item.title !== "TabMerger");
        break;
    }

    // apply blacklist items
    chrome.storage.sync.get("settings", (result) => {
      tabs = tabs.filter((item) => {
        var blacklist_sites = result.settings.blacklist
          .replace(" ", "")
          .split(",");
        blacklist_sites = blacklist_sites.map((item) => item.toLowerCase());
        return !blacklist_sites.includes(item.url);
      });
    });

    findExtTabAndSwitch();

    // close the to-be-merged tabs
    chrome.tabs.remove(tabs.map((x) => x.id));

    // ===== FILTERING for tab total counts ====== //
    // get a list of all the current tab titles
    var tab_titles = ["TabMerger", "New Tab", "Extensions", "Add-ons Manager"];
    chrome.storage.sync.get("groups", (result) => {
      Object.values(result.groups).forEach((item) => {
        var groups_tab_titles = item.tabs.map((curr_tab) => curr_tab.title);
        tab_titles = tab_titles.concat(groups_tab_titles);
      });
    });

    tabs = tabs.filter((item) => {
      return !tab_titles.includes(item.title);
    });

    // need time to open page sometimes
    setTimeout(
      () => {
        window.localStorage.setItem(
          "into_group",
          group_id ? group_id : "group-0"
        );
        window.localStorage.setItem("merged_tabs", JSON.stringify(tabs));
      },
      /chrome/i.test(navigator.userAgent) ? 50 : 200
    );
  });
}

function findExtTabAndSwitch() {
  chrome.tabs.query(
    { title: "TabMerger", currentWindow: true },
    (tabMergerTabs) => {
      if (tabMergerTabs[0]) {
        if (!tabMergerTabs[0].active) {
          chrome.tabs.reload(tabMergerTabs[0].id);
        }
        chrome.tabs.update(tabMergerTabs[0].id, {
          highlighted: true,
          active: true,
        });
      } else {
        chrome.tabs.create({ url: "index.html", active: true });
      }
    }
  );
}

function excludeSite(info, tab) {
  chrome.storage.sync.get("settings", (result) => {
    result.settings.blacklist +=
      result.settings.blacklist === "" ? `${tab.url}` : `, ${tab.url}`;
    chrome.storage.sync.set({ settings: result.settings });
  });
}

function createDefaultStorageItems() {
  chrome.storage.sync.clear();

  var default_settings = {
    open: "without",
    color: "#dedede",
    title: "Title",
    restore: "keep",
    blacklist: "",
    dark: true,
  };

  var default_groups = {
    "group-0": {
      title: "Title",
      color: "#dedede",
      created: new Date(Date.now()).toString(),
      tabs: [],
    },
  };

  chrome.storage.sync.get(["settings", "groups"], (result) => {
    if (!result.settings) {
      chrome.storage.sync.set({ settings: default_settings });
    }

    if (!result.groups) {
      chrome.storage.sync.set({ groups: default_groups });
    }
  });
}

function translate(msg) {
  return chrome.i18n.getMessage(msg);
}

// default values
var info = { which: "all" };
var tab = { index: 0 };

// extension click - open without merging or with merging
chrome.browserAction.onClicked.addListener(() => {
  createDefaultStorageItems();

  chrome.storage.sync.get("settings", (result) => {
    result.settings.open === "without"
      ? findExtTabAndSwitch()
      : getTabsAndSend(info, tab);
  });
});

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

const contextMenuOrShortCut = (info, tab) => {
  createDefaultStorageItems();

  // shortcut keyboard commands
  if (typeof info === "string") {
    info = { which: "all", command: info };
  }

  switch (info.menuItemId || info.command) {
    case "aopen-tabmerger":
      findExtTabAndSwitch();
      break;
    case "merge-left-menu":
      info.which = "left";
      getTabsAndSend(info, tab);
      break;
    case "merge-right-menu":
      info.which = "right";
      getTabsAndSend(info, tab);
      break;
    case "merge-xcluding-menu":
      info.which = "excluding";
      getTabsAndSend(info, tab);
      break;
    case "merge-snly-menu":
      info.which = "only";
      getTabsAndSend(info, tab);
      break;
    case "remove-visibility":
      excludeSite(info, tab);
      break;
    case "zdl-instructions":
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

createContextMenu("aopen-tabmerger", translate("bgOpen"));

createContextMenu("first-separator", "separator", "separator");
createContextMenu("merge-all-menu", translate("bgAll"));
createContextMenu("merge-left-menu", translate("bgLeft"));
createContextMenu("merge-right-menu", translate("bgRight"));
createContextMenu("merge-xcluding-menu", translate("bgExclude"));
createContextMenu("merge-snly-menu", translate("bgOnly"));

createContextMenu("second-separator", "separator", "separator");
createContextMenu("remove-visibility", translate("bgSiteExclude"));

createContextMenu("third-separator", "separator", "separator");
createContextMenu("zdl-instructions", translate("bgInstructions"));
createContextMenu("dl-contact", translate("bgContact"));

// context menu actions
chrome.contextMenus.onClicked.addListener(contextMenuOrShortCut);

// shortcut keyboard
chrome.commands.onCommand.addListener(contextMenuOrShortCut);
