import * as AppHelper from "../../src/components/App/App_helpers";

global.init_groups = {
  "group-0": {
    color: "#d6ffe0",
    created: "11/12/2020 @ 22:13:24",
    hidden: false,
    locked: false,
    starred: false,
    tabs: [
      {
        pinned: false,
        title: "Stack Overflow - Where Developers Learn, Share, & Build Careers",
        url: "https://stackoverflow.com/",
      },
      {
        pinned: false,
        title: "lichess.org • Free Online Chess",
        url: "https://lichess.org/",
      },
      {
        pinned: false,
        title: "Chess.com - Play Chess Online - Free Games",
        url: "https://www.chess.com/",
      },
    ],
    title: "Chess",
  },
  "group-1": {
    color: "#c7eeff",
    created: "11/12/2020 @ 22:15:11",
    hidden: false,
    locked: false,
    starred: false,
    tabs: [
      {
        pinned: false,
        title: "Twitch",
        url: "https://www.twitch.tv/",
      },
      {
        pinned: false,
        title: "reddit: the front page of the internet",
        url: "https://www.reddit.com/",
      },
    ],
    title: "Social",
  },
  "group-3": {
    color: "#123123",
    created: "01/01/2021 @ 12:34:56",
    hidden: false,
    locked: false,
    starred: false,
    tabs: [
      {
        pinned: false,
        title: "A",
        url: "https://www.a.com/",
      },
    ],
    title: "A",
  },
  "group-2": {
    color: "#456456",
    created: "10/09/2021 @ 12:11:10",
    hidden: false,
    locked: false,
    starred: false,
    tabs: [
      {
        pinned: false,
        title: "B",
        url: "https://www.b.com/",
      },
    ],
    title: "B",
  },
};

global.default_settings = {
  badgeInfo: "display",
  blacklist: "",
  color: "#dedede",
  dark: true,
  merge: "merge",
  open: "without",
  pin: "include",
  restore: "keep",
  title: "Title",
};

global.default_group = {
  color: "#dedede",
  created: "",
  hidden: false,
  locked: false,
  starred: false,
  tabs: [],
  title: "Title",
};

global.chromeSyncSetSpy = jest.spyOn(chrome.storage.sync, "set");
global.chromeSyncGetSpy = jest.spyOn(chrome.storage.sync, "get");
global.chromeSyncRemoveSpy = jest.spyOn(chrome.storage.sync, "remove");

global.chromeLocalSetSpy = jest.spyOn(chrome.storage.local, "set");
global.chromeLocalGetSpy = jest.spyOn(chrome.storage.local, "get");
global.chromeLocalRemoveSpy = jest.spyOn(chrome.storage.local, "remove");

global.chromeBrowserActionSetBadgeTextSpy = jest.spyOn(chrome.browserAction, "setBadgeText");
global.chromeBrowserActionSetBadgeBackgroundColorSpy = jest.spyOn(chrome.browserAction, "setBadgeBackgroundColor");
global.chromeBrowserActionSetTitleSpy = jest.spyOn(chrome.browserAction, "setTitle");

global.chromeTabsMoveSpy = jest.spyOn(chrome.tabs, "move");
global.chromeTabsCreateSpy = jest.spyOn(chrome.tabs, "create");
global.chromeTabsQuerySpy = jest.spyOn(chrome.tabs, "query");
global.chromeTabsRemoveSpy = jest.spyOn(chrome.tabs, "remove");
global.chromeTabsUpdateSpy = jest.spyOn(chrome.tabs, "update");
global.chromeTabsOnUpdatedAdd = jest.spyOn(chrome.tabs.onUpdated, "addListener");
global.chromeTabsOnUpdatedRemove = jest.spyOn(chrome.tabs.onUpdated, "removeListener");
global.chromeContextMenusCeateSpy = jest.spyOn(chrome.contextMenus, "create");

global.toggleDarkModeSpy = jest.spyOn(AppHelper, "toggleDarkMode");
global.toggleSyncTimestampSpy = jest.spyOn(AppHelper, "toggleSyncTimestamp");

global.chromeRuntimeSendMessageSpy = jest.spyOn(chrome.runtime, "sendMessage");
global.mockSet = jest.fn(); // mock for setState hooks

global.SYNC_LIMIT = 102000;
global.ITEM_LIMIT = 8000;
