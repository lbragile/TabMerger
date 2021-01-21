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

beforeEach(() => {
  sessionStorage.setItem("settings", JSON.stringify(default_settings));
});

// NEEDS WORK
describe("filterTabs", () => {
  const merge_tabs = [
    { id: 0, url: "https://abc.com/", title: "ABC" },
    { id: 1, url: "https://def.com/", title: "DEF" },
    { id: 2, url: "https://lichess.org/", title: "lichess.org" },
    { id: 3, url: "https://www.chess.com/", title: "Chess.com" },
    { id: 4, url: "https://www.twitch.tv/", title: "Twitch" },
    { id: 5, url: "https://www.ghi.com/", title: "GHI" },
    { id: 6, url: "https://www.jkl.com/", title: "JKL" },
    { id: 7, url: "https://www.jkl.com/", title: "JKL" }, // duplicate on purpose
  ];

  beforeEach(() => {
    localStorage.setItem("groups", JSON.stringify(init_groups));
    sessionStorage.setItem("open_tabs", JSON.stringify(merge_tabs));
    jest.clearAllMocks();
  });

  test.each([
    [{ which: "right" }, { index: 3 }, undefined],
    [{ which: "right" }, { index: 0 }, undefined],
    [{ which: "right" }, { index: 7 }, undefined],
    [{ which: "left" }, { index: 3 }, undefined],
    [{ which: "left" }, { index: 0 }, undefined],
    [{ which: "left" }, { index: 7 }, undefined],
    [{ which: "excluding" }, { index: 3 }, "group-1"],
    [{ which: "only" }, { index: 3 }, "group-2"],
    [{ which: "all" }, { index: 0 }, "group-3"],
  ])("%o, %o, %s", async (info, tab, group_id) => {
    var num_merge_count = info.which === "only" ? 1 : merge_tabs.length - (tab.index + 1);
    var tabs_to_be_merged = merge_tabs.splice(tab.index, num_merge_count);
    var into_group = group_id ? group_id : "group-0";

    jest.useFakeTimers(); // due to setTimeout
    BackgroundHelper.filterTabs(info, tab, group_id);
    jest.advanceTimersByTime(101);

    expect(chromeTabsQuerySpy).toHaveBeenCalledTimes(1);
    expect(chromeTabsQuerySpy).toHaveBeenCalledWith({ currentWindow: true }, anything);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ into_group, merged_tabs: tabs_to_be_merged }, anything);
  });
});

describe("findExtTabAndSwitch", () => {
  var chromeTabsUpdateSpy, chromeTabsCreateSpy, chromeTabsOnUpdatedAdd, chromeTabsOnUpdatedRemove;

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
    var expected_query = { title: "TabMerger", currentWindow: true };
    var expected_exists = { highlighted: true, active: true };
    var expected_not_exist = { url: "index.html", active: true };

    BackgroundHelper.findExtTabAndSwitch();

    expect(chromeTabsQuerySpy).toHaveBeenCalledTimes(1);
    expect(chromeTabsQuerySpy).toHaveBeenCalledWith(expected_query, anything);
  });

  it("TabMerger page is NOT already open", () => {
    var expected_query = { title: "TEMP", currentWindow: true };
    var expected_exists = { highlighted: true, active: true };
    var expected_not_exist = { url: "index.html", active: true };

    chromeTabsQuerySpy.mockImplementation((_, cb) => cb([]));

    jest.clearAllMocks();
    BackgroundHelper.findExtTabAndSwitch();

    expect(chromeTabsQuerySpy).toHaveBeenCalledTimes(1);
    expect(chromeTabsQuerySpy).toHaveBeenCalledWith(expected_query, anything);

    chromeTabsQuerySpy.mockRestore();
  });
});

describe("excludeSite", () => {
  it("adjusts sync storage correctly - empty", () => {
    const url = "www.google.com";

    var expected_settings = JSON.parse(sessionStorage.getItem("settings"));
    expected_settings.blacklist = url;
    jest.clearAllMocks();

    BackgroundHelper.excludeSite({ url });

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

    expect(chromeSyncSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncSetSpy).toHaveBeenCalledWith({ settings: expected_settings }, anything);
  });

  it("adjusts sync storage correctly - NOT empty", () => {
    const original_url = "www.facebook.com";
    const url = "www.google.com";

    var current_settings = JSON.parse(sessionStorage.getItem("settings"));
    current_settings.blacklist = original_url;
    sessionStorage.setItem("settings", JSON.stringify(current_settings));

    var expected_settings = current_settings;
    current_settings.blacklist = original_url + ", " + url;
    jest.clearAllMocks();

    BackgroundHelper.excludeSite({ url });

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

    expect(chromeSyncSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncSetSpy).toHaveBeenCalledWith({ settings: expected_settings }, anything);
  });
});
