/* 
TabMerger as the name implies merges your tabs into one location to save
memory usage and increase your productivity.

Copyright (C) 2021  Lior Bragilevsky

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.

If you have any questions, comments, or concerns you can contact the
TabMerger team at <https://lbragile.github.io/TabMerger-Extension/contact/>
*/

import React from "react";
global.React = React;

import * as AppHelper from "../../src/components/App/App_helpers";

/*  CHROME SYNC STORAGE API SPIES */
global.chromeSyncSetSpy = jest.spyOn(chrome.storage.sync, "set");
global.chromeSyncGetSpy = jest.spyOn(chrome.storage.sync, "get");
global.chromeSyncRemoveSpy = jest.spyOn(chrome.storage.sync, "remove");

/*  CHROME LOCAL STORAGE API SPIES */
global.chromeLocalSetSpy = jest.spyOn(chrome.storage.local, "set");
global.chromeLocalGetSpy = jest.spyOn(chrome.storage.local, "get");
global.chromeLocalRemoveSpy = jest.spyOn(chrome.storage.local, "remove");

/*  CHROME BROWSER ACTION API SPIES */
global.chromeBrowserActionSetBadgeTextSpy = jest.spyOn(chrome.browserAction, "setBadgeText");
global.chromeBrowserActionSetBadgeBackgroundColorSpy = jest.spyOn(chrome.browserAction, "setBadgeBackgroundColor");
global.chromeBrowserActionSetTitleSpy = jest.spyOn(chrome.browserAction, "setTitle");

/*  CHROME TABS API SPIES */
global.chromeTabsMoveSpy = jest.spyOn(chrome.tabs, "move");
global.chromeTabsCreateSpy = jest.spyOn(chrome.tabs, "create");
global.chromeTabsQuerySpy = jest.spyOn(chrome.tabs, "query");
global.chromeTabsRemoveSpy = jest.spyOn(chrome.tabs, "remove");
global.chromeTabsUpdateSpy = jest.spyOn(chrome.tabs, "update");
global.chromeTabsOnUpdatedAdd = jest.spyOn(chrome.tabs.onUpdated, "addListener");
global.chromeTabsOnUpdatedRemove = jest.spyOn(chrome.tabs.onUpdated, "removeListener");

/*  CHROME CONTEXT MENU & RUNTIME API SPIES */
global.chromeContextMenusCeateSpy = jest.spyOn(chrome.contextMenus, "create");
global.chromeRuntimeSendMessageSpy = jest.spyOn(chrome.runtime, "sendMessage");

/*  TABMERGER RELATED TOGGLE SPIES */
global.toggleDarkModeSpy = jest.spyOn(AppHelper, "toggleDarkMode");
global.toggleSyncTimestampSpy = jest.spyOn(AppHelper, "toggleSyncTimestamp");

/*  MOCK FOR SETTING STATE HOOKS */
global.mockSet = jest.fn();

/*  CHROME STORAGE LIMIT CONSTANTS */
global.SYNC_LIMIT = 102000;
global.ITEM_LIMIT = 8000;

global.user = { paid: true, tier: "Premium" }; // will check this in integration tests

/*  COMMON VARIABLES & DEFAULT VALUES */
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

global.exportedJSON = {
  "group-0": {
    color: "#ff9999",
    created: "04/02/2021 @ 21:21:49",
    hidden: false,
    locked: true,
    starred: true,
    tabs: [
      {
        pinned: true,
        title: "TabMerger v1.5.0 Sample Use Case - YouTube",
        url: "https://www.youtube.com/watch?v=9eXmYE49jxA&t=15s&ab_channel=TabMerger",
      },
      {
        pinned: false,
        title: "TabMerger v1.4.3 Cross-Browser Extension Walkthrough - YouTube",
        url: "https://www.youtube.com/watch?v=zkI0T-GzmzQ&t=3s&ab_channel=TabMerger",
      },
      {
        pinned: false,
        title: "TabMerger v1.2.0 Example Use Case Available In Chrome & FireFox - YouTube",
        url: "https://www.youtube.com/watch?v=gx0dNUbwCn4&t=7s&ab_channel=TabMerger",
      },
      {
        pinned: false,
        title: "TabMerger Chrome Extension Example Use Case - YouTube",
        url: "https://www.youtube.com/watch?v=cXG1lIx7WP4&t=5s&ab_channel=TabMerger",
      },
    ],
    title: "YouTube",
  },
  "group-1": {
    color: "#ffdb99",
    created: "04/02/2021 @ 21:22:05",
    hidden: false,
    locked: true,
    starred: false,
    tabs: [
      {
        pinned: true,
        title: "lbragile (Lior Bragilevsky)",
        url: "https://github.com/lbragile",
      },
      {
        pinned: false,
        title:
          "lbragile/TabMerger: TabMerger, as the name suggests, merges your tabs into one location to save memory usage and increase your productivity. TabMerger is a cross-browser extension - currently available on Chrome, Firefox, and Edge.",
        url: "https://github.com/lbragile/TabMerger",
      },
      {
        pinned: false,
        title:
          "lbragile/Portfolio: This is my personal portfolio where I outline my skills and practice applying my web development knowledge. It lists all the projects that I completed throughout the years - both the good and bad 😅",
        url: "https://github.com/lbragile/Portfolio",
      },
    ],
    title: "GitHub Profile / Account",
  },
  "group-2": {
    color: "#ffff99",
    created: "04/02/2021 @ 21:22:08",
    hidden: false,
    locked: true,
    starred: false,
    tabs: [
      {
        pinned: true,
        title: "User lbragile - Stack Overflow",
        url: "https://stackoverflow.com/users/4298115/lbragile",
      },
    ],
    title: "StackOverflow",
  },
  "group-3": {
    color: "#99ff99",
    created: "04/02/2021 @ 21:22:11",
    hidden: false,
    locked: true,
    starred: false,
    tabs: [
      {
        pinned: false,
        title: "Chess.com - Play Chess Online - Free Games",
        url: "https://www.chess.com/",
      },
      {
        pinned: false,
        title: "lichess.org • Free Online Chess",
        url: "https://lichess.org/",
      },
    ],
    title: "Games / Entertainment I Like",
  },
  "group-4": {
    color: "#99ffff",
    created: "04/02/2021 @ 21:22:11",
    hidden: false,
    locked: true,
    starred: false,
    tabs: [
      {
        pinned: false,
        title: "lbragile_dev (u/lbragile_dev) - Reddit",
        url: "https://www.reddit.com/user/lbragile_dev",
      },
      {
        pinned: false,
        title: "Lior Bragilevsky, MASc | LinkedIn",
        url: "https://www.linkedin.com/in/liorbragilevsky/",
      },
      {
        pinned: false,
        title: "https://twitter.com/lbragile",
        url: "https://twitter.com/lbragile",
      },
    ],
    title: "Social Media Platforms I Am On",
  },
  "group-5": {
    color: "#9999ff",
    created: "04/02/2021 @ 21:22:11",
    hidden: true,
    locked: false,
    starred: false,
    tabs: [
      {
        pinned: false,
        title: "Kaggle: Your Machine Learning and Data Science Community",
        url: "https://www.kaggle.com/",
      },
      {
        pinned: false,
        title: "Piazza • Ask. Answer. Explore. Whenever.",
        url: "https://piazza.com/",
      },
    ],
    title: "Hidden Group",
  },
  "group-6": {
    color: "#ff99ff",
    created: "04/02/2021 @ 21:22:29",
    hidden: false,
    locked: false,
    starred: false,
    tabs: [
      {
        pinned: false,
        title: "css selectors w3schools - Google Search",
        url:
          "https://www.google.com/search?q=css+selectors+w3schools&oq=css+selectors+&aqs=chrome.1.69i57j0l6j69i60.12085j0j7&sourceid=chrome&ie=UTF-8",
      },
      {
        pinned: false,
        title: "color theory w3schools - Google Search",
        url:
          "https://www.google.com/search?sxsrf=ALeKk03W5grXh5hX0SUl_nj_5ndIjo3Cnw%3A1612503087625&ei=L9gcYMrUJaSu0PEPydS8KA&q=color+theory+w3schools&oq=color+theory+w3schools&gs_lcp=CgZwc3ktYWIQAzICCAA6BwgjELADECc6BwgAEEcQsAM6BggAEBYQHlCNDVjGFmDLF2gBcAJ4AIABOYgBqQOSAQE4mAEAoAEBqgEHZ3dzLXdpesgBCcABAQ&sclient=psy-ab&ved=0ahUKEwiKqPKNgtLuAhUkFzQIHUkqDwUQ4dUDCA0&uact=5",
      },
      {
        pinned: false,
        title: "stack overflow react - Google Search",
        url:
          "https://www.google.com/search?sxsrf=ALeKk03du1aGwXFEKJ4rXrZlZSyRNStVWg%3A1612503021307&ei=7dccYOmkErLO0PEPj8WyuAY&q=stack+overflow+react&oq=stack+overflow+react&gs_lcp=CgZwc3ktYWIQAzICCAAyAggAMgIIADICCAAyCQgAEMkDEBYQHjIGCAAQFhAeMgYIABAWEB4yBggAEBYQHjIGCAAQFhAeMgYIABAWEB46BAgjECc6BQgAEJECOgsILhCxAxDHARCjAjoICC4QsQMQgwE6BQgAELEDOgQIABBDOgcIABCxAxBDOgoILhDHARCvARBDOgQILhBDOggIABCxAxCRAjoFCC4QsQM6BwgAEBQQhwJQx2VYhn1grn5oAHACeACAAVyIAcUJkgECMjGYAQCgAQGqAQdnd3Mtd2l6wAEB&sclient=psy-ab&ved=0ahUKEwipz6LugdLuAhUyJzQIHY-iDGcQ4dUDCA0&uact=5",
      },
    ],
    title: "Things I Typically Google",
  },
  "group-7": {
    color: "#000000",
    created: "04/02/2021 @ 21:22:36",
    hidden: false,
    locked: false,
    starred: false,
    tabs: [
      {
        pinned: false,
        title:
          'lbragile/chessCAMO: chessCAMO is a newly proposed chess engine with a built-in variant that stands for Calculations Always Make Opportunities and was inspired by the very popular chess variant Crazyhouse. The "CAMO" portion comes from the idea that in this variant a player can sacrifice making a move to replace one of their pieces from the "piece reservoir".',
        url: "https://github.com/lbragile/chessCAMO",
      },
      {
        pinned: false,
        title: "COVID19 Statistics",
        url: "https://www.simpleglobalstats.com/",
      },
    ],
    title: "Other Projects I Made",
  },
  settings: {
    badgeInfo: "display",
    blacklist: "",
    color: "#dedede",
    dark: true,
    font: "Arial",
    merge: "merge",
    open: "without",
    pin: "include",
    restore: "keep",
    title: "Title",
    weight: "Normal",
  },
};

global.default_settings = {
  badgeInfo: "display",
  blacklist: "",
  color: "#dedede",
  dark: true,
  font: "Arial",
  merge: "merge",
  open: "without",
  pin: "include",
  restore: "keep",
  title: "Title",
  weight: "Normal",
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
