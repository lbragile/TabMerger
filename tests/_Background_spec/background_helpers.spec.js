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
window.React = React;

import * as BackgroundHelper from "../../public/background/background_helpers.js";

var mockSet, anything;
var chromeSyncGetSpy, chromeSyncSetSpy, chromeLocalGetSpy, chromeLocalSetSpy, chromeTabsQuerySpy;

beforeAll(() => {
  mockSet = jest.fn();
  anything = expect.anything();

  chromeSyncGetSpy = jest.spyOn(chrome.storage.sync, "get");
  chromeSyncSetSpy = jest.spyOn(chrome.storage.sync, "set");
  chromeLocalGetSpy = jest.spyOn(chrome.storage.local, "get");
  chromeLocalSetSpy = jest.spyOn(chrome.storage.local, "set");
  chromeTabsQuerySpy = jest.spyOn(chrome.tabs, "query");
});

describe("filterTabs", () => {
  const merge_tabs = [
    { id: 0, index: 0, pinned: true, url: "https://www.abc.com/", title: "ABC" },
    { id: 1, index: 1, pinned: false, url: "https://www.def.com/", title: "DEF" },
    { id: 2, index: 2, pinned: false, url: "https://lichess.org/", title: "lichess.org" },
    { id: 3, index: 3, pinned: false, url: "https://www.chess.com/", title: "Chess.com" },
    { id: 4, index: 4, pinned: true, url: "https://www.twitch.tv/", title: "Twitch" },
    { id: 5, index: 5, pinned: false, url: "https://www.ghi.com/", title: "GHI" },
    { id: 6, index: 6, pinned: false, url: "https://www.jkl.com/", title: "JKL" },
    { id: 7, index: 7, pinned: false, url: "https://www.jkl.com/", title: "JKL" }, // duplicate on purpose
    { id: 8, index: 8, pinned: true, url: "https://www.blacklisted.com/", title: "blacklisted" },
  ];

  beforeEach(() => {
    localStorage.setItem("groups", JSON.stringify(init_groups));
    sessionStorage.setItem("open_tabs", JSON.stringify(merge_tabs));

    default_settings.blacklist = "https://www.blacklisted.com/, ";
    sessionStorage.setItem("settings", JSON.stringify(default_settings));
    default_settings.blacklist = "";
    jest.clearAllMocks();
  });

  test.each([
    [{ which: "right" }, { index: 3 }, undefined, "include"],
    [{ which: "right" }, { index: 0 }, "group-0", "include"],
    [{ which: "right" }, { index: 7 }, "group-1", "include"],
    [{ which: "right" }, { index: 7 }, "group-1", "avoid"],
    [{ which: "left" }, { index: 3 }, undefined, "include"],
    [{ which: "left" }, { index: 0 }, "group-0", "include"],
    [{ which: "left" }, { index: 7 }, "group-1", "include"],
    [{ which: "excluding" }, { index: 1 }, "group-1", "include"],
    [{ which: "excluding" }, { index: 1 }, "group-1", "avoid"],
    [{ which: "only" }, { index: 6 }, "group-2", "include"],
    [{ which: "all" }, { index: 0 }, "group-3", "include"],
    [{ which: "all" }, { index: 0 }, "group-3", "avoid"],
  ])("%o, %o, %s, %s", (info, tab, group_id, pinned) => {
    if (pinned === "avoid") {
      var new_settings = JSON.parse(sessionStorage.getItem("settings"));
      new_settings.pin = pinned;
      sessionStorage.setItem("settings", JSON.stringify(new_settings));
      jest.clearAllMocks();
    }

    var tabs_to_be_merged;
    if (info.which === "right") {
      if (tab.index === 3) {
        tabs_to_be_merged = merge_tabs.slice(5, 7);
      } else if (tab.index === 0) {
        tabs_to_be_merged = [...merge_tabs.slice(1, 2), ...merge_tabs.slice(5, 7)];
      } else {
        tabs_to_be_merged = [];
      }
    } else if (info.which === "left") {
      if (tab.index === 3) {
        tabs_to_be_merged = merge_tabs.slice(0, 2);
      } else if (tab.index === 0) {
        tabs_to_be_merged = [];
      } else {
        tabs_to_be_merged = [...merge_tabs.slice(0, 2), ...merge_tabs.slice(5, 7)];
      }
    } else if (info.which === "excluding") {
      tabs_to_be_merged = [...merge_tabs.slice(0, 1), ...merge_tabs.slice(5, 7)];
    } else if (info.which === "only") {
      tabs_to_be_merged = [merge_tabs[tab.index]];
    } else {
      tabs_to_be_merged = [...merge_tabs.slice(0, 2), ...merge_tabs.slice(5, 7)];
    }

    const into_group = group_id ? group_id : "contextMenu";
    var merged_tabs = [];
    tabs_to_be_merged.forEach((x) => {
      if (pinned === "avoid") {
        if (!x.pinned) {
          merged_tabs = [...merged_tabs, { id: x.id, pinned: false, title: x.title, url: x.url }];
        }
      } else {
        merged_tabs = [...merged_tabs, { id: x.id, pinned: x.pinned, title: x.title, url: x.url }];
      }
    });

    jest.useFakeTimers();
    BackgroundHelper.filterTabs(info, tab, group_id);
    jest.advanceTimersByTime(101);

    expect(chromeTabsQuerySpy).toHaveBeenCalledTimes(1);
    expect(chromeTabsQuerySpy).toHaveBeenCalledWith({ currentWindow: true }, anything);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ into_group, merged_tabs }, anything);
  });
});

describe("findExtTabAndSwitch", () => {
  var chromeTabsUpdateSpy, chromeTabsCreateSpy, chromeTabsOnUpdatedAdd, chromeTabsOnUpdatedRemove;
  const expected_query = { title: "TabMerger", currentWindow: true };
  const id = 99;

  beforeAll(() => {
    chromeTabsUpdateSpy = jest.spyOn(chrome.tabs, "update");
    chromeTabsCreateSpy = jest.spyOn(chrome.tabs, "create");
    chromeTabsOnUpdatedAdd = jest.spyOn(chrome.tabs.onUpdated, "addListener");
    chromeTabsOnUpdatedRemove = jest.spyOn(chrome.tabs.onUpdated, "removeListener");
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("TabMerger page is already open", () => {
    const expected_exists = { highlighted: true, active: true };

    BackgroundHelper.findExtTabAndSwitch();

    expect(chromeTabsQuerySpy).toHaveBeenCalledTimes(1);
    expect(chromeTabsQuerySpy).toHaveBeenCalledWith(expected_query, anything);

    expect(chromeTabsUpdateSpy).toHaveBeenCalledTimes(1);
    expect(chromeTabsUpdateSpy).toHaveBeenCalledWith(id, expected_exists, anything);
  });

  describe("TabMerger page is NOT already open", () => {
    const expected_not_exist = { url: "../index.html", active: true };

    beforeAll(() => {
      chromeTabsQuerySpy.mockImplementation((_, cb) => cb([]));
      chromeTabsCreateSpy.mockImplementation((_, cb) => cb({ id }));
    });

    afterAll(() => {
      chromeTabsQuerySpy.mockRestore();
      chromeTabsCreateSpy.mockRestore();
      chromeTabsOnUpdatedAdd.mockRestore();
    });

    test.each([["complete"], ["incomplete"]])("%s", (type) => {
      chromeTabsOnUpdatedAdd.mockImplementation((cb) => cb(id, { status: type }));
      jest.clearAllMocks();

      BackgroundHelper.findExtTabAndSwitch();

      expect(chromeTabsQuerySpy).toHaveBeenCalledTimes(1);
      expect(chromeTabsQuerySpy).toHaveBeenCalledWith(expected_query, anything);

      expect(chromeTabsCreateSpy).toHaveBeenCalledTimes(1);
      expect(chromeTabsCreateSpy).toHaveBeenCalledWith(expected_not_exist, anything);

      expect(chromeTabsOnUpdatedAdd).toHaveBeenCalledTimes(1);
      expect(chromeTabsOnUpdatedAdd).toHaveBeenCalledWith(expect.any(Function));

      if (type === "complete") {
        expect(chromeTabsOnUpdatedRemove).toHaveBeenCalledTimes(1);
        expect(chromeTabsOnUpdatedRemove).toHaveBeenCalledWith(expect.any(Function));
      } else {
        expect(chromeTabsOnUpdatedRemove).not.toHaveBeenCalled();
      }
    });
  });
});

describe("excludeSite", () => {
  const original_url = "www.facebook.com";
  const url = "www.google.com";

  it.each([["empty"], ["NOT empty"]])("adjusts sync storage correctly - %s", (type) => {
    default_settings.blacklist = type === "empty" ? "" : original_url + ", ";
    sessionStorage.setItem("settings", JSON.stringify(default_settings));
    default_settings.blacklist = "";
    var expected_settings = JSON.parse(sessionStorage.getItem("settings"));
    expected_settings.blacklist += url + ", ";

    jest.clearAllMocks();

    BackgroundHelper.excludeSite({ url });

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

    expect(chromeSyncSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncSetSpy).toHaveBeenCalledWith({ settings: expected_settings }, anything);
  });
});
