function filterTabs(info, tab, group_id) {
  chrome.tabs.query({ currentWindow: true }, async (tabs) => {
    findExtTabAndSwitch();

    // FILTER BASED ON USER BUTTON CLICK
    tabs = tabs.filter((x) => x.title !== "TabMerger");
    switch (info.which) {
      case "right":
        tabs = tabs.filter((x) => x.index > tab.index);
        break;
      case "left":
        tabs = tabs.filter((x) => x.index < tab.index);
        break;
      case "excluding":
        tabs = tabs.filter((x) => x.index !== tab.index);
        break;
      case "only":
        tabs = tabs.filter((x) => x.index === tab.index);
        break;

      default:
        //all (already filtered all tabs except TabMerger)
        break;
    }

    // create duplicate title/url list & filter blacklisted sites
    var filter_vals = ["TabMerger", "New Tab", "Extensions", "Add-ons Manager"];
    await new Promise((resolve) => {
      chrome.storage.sync.get(null, (result) => {
        // get a list of all the current tab titles and/or urls
        Object.keys(result).forEach((key) => {
          if (key !== "settings") {
            var extra_vals = result[key].tabs.map((x) => x.url);
            filter_vals = filter_vals.concat(extra_vals);
          }
        });

        // apply blacklist items
        tabs = tabs.filter((x) => {
          var bl_sites = result.settings.blacklist.replace(" ", "").split(",");
          bl_sites = bl_sites.map((site) => site.toLowerCase());
          return !bl_sites.includes(x.url);
        });

        resolve(0);
      });
    });

    // remove unnecessary information from each tab
    tabs = tabs.map((x) => {
      return { title: x.title, favIconUrl: x.favIconUrl, url: x.url, id: x.id };
    });

    // duplicates (already in TabMerger) can be removed
    var duplicates = tabs.filter((x) => {
      return filter_vals.includes(x.title) || filter_vals.includes(x.url);
    });

    chrome.tabs.remove(duplicates.map((x) => x.id));

    // apply above filter
    tabs = tabs.filter((x) => {
      return !filter_vals.includes(x.title) && !filter_vals.includes(x.url);
    });

    // make sure original merge has no duplicated values
    // obtain offending indicies
    // prettier-ignore
    var prev_urls = [], indicies = [];
    tabs.forEach((x, i) => {
      if (prev_urls.includes(x.url)) {
        indicies.push(i);
      } else {
        prev_urls.push(x.url);
      }
    });

    // close duplicates in the merging process
    indicies.forEach((i) => {
      chrome.tabs.remove(tabs[i].id);
    });

    // filter out offending indicies
    tabs = tabs.filter((_, i) => !indicies.includes(i));

    var whichGroup = group_id ? group_id : "group-0";
    chrome.storage.local.set({ into_group: whichGroup, merged_tabs: tabs });
  });
}

function findExtTabAndSwitch() {
  var query = { title: "TabMerger", currentWindow: true };
  var exists = { highlighted: true, active: true };
  var not_exist = { url: "index.html", active: true };
  chrome.tabs.query(query, (tabMergerTabs) => {
    tabMergerTabs[0]
      ? chrome.tabs.update(tabMergerTabs[0].id, exists)
      : chrome.tabs.create(not_exist);
  });
}

function excludeSite(info, tab) {
  chrome.storage.sync.get("settings", (result) => {
    result.settings.blacklist +=
      result.settings.blacklist === "" ? `${tab.url}` : `, ${tab.url}`;
    chrome.storage.sync.set({ settings: result.settings });
  });
}

async function createDefaultStorageItems() {
  var default_settings = {
    open: "without",
    color: "#dedede",
    title: "Title",
    restore: "keep",
    blacklist: "",
    dark: true,
  };

  var default_group = {
    title: "Title",
    color: "#dedede",
    created: new Date(Date.now()).toString(),
    tabs: [],
  };

  chrome.storage.sync.get(["settings", "group-0"], (result) => {
    if (!result.settings) {
      chrome.storage.sync.set({ settings: default_settings });
    }

    if (!result["group-0"]) {
      chrome.storage.sync.set({ "group-0": default_group });
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
      : filterTabs(info, tab);
  });
});

const extensionMessage = (request) => {
  info.which = request.msg;
  var queryOpts = { currentWindow: true, active: true };
  chrome.tabs.query(queryOpts, (tabs) => {
    filterTabs(info, tabs[0], request.id);
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
      filterTabs(info, tab);
      break;
    case "merge-right-menu":
      info.which = "right";
      filterTabs(info, tab);
      break;
    case "merge-xcluding-menu":
      info.which = "excluding";
      filterTabs(info, tab);
      break;
    case "merge-snly-menu":
      info.which = "only";
      filterTabs(info, tab);
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
      filterTabs(info, tab);
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
