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
    tabs = tabs.filter((item) => {
      var settings = JSON.parse(window.localStorage.getItem("settings"));
      var blacklist_sites = settings.blacklist.replace(" ", "").split(",");
      blacklist_sites = blacklist_sites.map((item) => item.toLowerCase());
      return !blacklist_sites.includes(item.url);
    });

    findExtTabAndSwitch();

    // close the to-be-merged tabs
    chrome.tabs.remove(tabs.map((x) => x.id));

    // ===== FILTERING for tab total counts ====== //
    // get a list of all the current tab titles
    var group_blocks = JSON.parse(window.localStorage.getItem("groups"));
    var tab_titles = ["TabMerger", "New Tab", "Extensions", "Add-ons Manager"];
    Object.values(group_blocks).forEach((item) => {
      var groups_tab_titles = item.tabs.map((curr_tab) => curr_tab.title);
      tab_titles = tab_titles.concat(groups_tab_titles);
    });

    tabs = tabs.filter((item) => {
      return !tab_titles.includes(item.title);
    });

    window.localStorage.setItem("merged_tabs", JSON.stringify(tabs));
    window.localStorage.setItem("into_group", group_id ? group_id : "group-0");
  });
}

function findExtTabAndSwitch() {
  chrome.tabs.query(
    { title: "TabMerger", currentWindow: true },
    (tabMergerTabs) => {
      if (tabMergerTabs[0]) {
        chrome.tabs.update(tabMergerTabs[0].id, { highlighted: true });
        chrome.tabs.reload(tabMergerTabs[0].id);
      } else {
        chrome.tabs.create({ url: "index.html", active: true });
      }
    }
  );
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
  return chrome.i18n.getMessage(msg);
}

// default values
var info = { which: "all" };
var tab = { index: 0 };

// extension click - open without merging or with merging
chrome.browserAction.onClicked.addListener(() => {
  if (JSON.parse(window.localStorage.getItem("settings")).open === "without") {
    findExtTabAndSwitch();
  } else {
    getTabsAndSend(info, tab);
  }
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

const contextMenuClick = (info, tab) => {
  switch (info.menuItemId) {
    case "open-tabmerger":
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
