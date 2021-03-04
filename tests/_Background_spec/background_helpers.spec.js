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

import { waitFor } from "@testing-library/react";

import * as BackgroundHelper from "../../public/background/background_helpers.js";

const anything = expect.any(Function);

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
    { id: 9, index: 9, pinned: false, url: "chrome-extension://inmiajapbpafmhjleiebcamfhkfnlgoc/index.html", title: "TabMerger" }, // prettier-ignore
    { id: 10, index: 10, pinned: false, url: "chrome://extensions/newtab", title: "New Tab" },
    { id: 11, index: 11, pinned: false, url: "chrome://extensions/", title: "Extensions" },
    { id: 12, index: 12, pinned: false, url: "about:addons", title: "Add-ons Manager" },
  ];

  beforeEach(() => {
    localStorage.setItem("groups", JSON.stringify(init_groups));
    sessionStorage.setItem("open_tabs", JSON.stringify(merge_tabs));

    CONSTANTS.DEFAULT_SETTINGS.blacklist = ", https://www.blacklisted.com/, ";
    sessionStorage.setItem("settings", JSON.stringify(CONSTANTS.DEFAULT_SETTINGS));
    CONSTANTS.DEFAULT_SETTINGS.blacklist = "";
    jest.clearAllMocks();
  });

  test.each([
    [{ which: "right" }, { index: 4 }, undefined, true],
    [{ which: "right" }, { index: 0 }, "group-0", true],
    [{ which: "right" }, { index: 12 }, "group-1", true],
    [{ which: "right" }, { index: 12 }, "group-1", false],
    [{ which: "left" }, { index: 4 }, undefined, true],
    [{ which: "left" }, { index: 0 }, "group-0", true],
    [{ which: "left" }, { index: 12 }, "group-1", true],
    [{ which: "excluding" }, { index: 1 }, "group-1", true],
    [{ which: "excluding" }, { index: 1 }, "group-1", false],
    [{ which: "only" }, { index: 6 }, "group-2", true],
    [{ which: "all" }, { index: 0 }, "group-3", true],
    [{ which: "all" }, { index: 0 }, "group-3", false],
  ])("%o, %o, %s, %s", async (info, tab, group_id, pinned) => {
    if (!pinned) {
      var new_settings = JSON.parse(sessionStorage.getItem("settings"));
      new_settings.pin = pinned;
      sessionStorage.setItem("settings", JSON.stringify(new_settings));
      jest.clearAllMocks();
    }

    var tabs_to_be_merged;
    if (info.which === "right") {
      if (tab.index === 4) {
        tabs_to_be_merged = merge_tabs.slice(5, 7);
      } else if (tab.index === 0) {
        tabs_to_be_merged = [...merge_tabs.slice(1, 2), ...merge_tabs.slice(5, 7)];
      } else {
        tabs_to_be_merged = [];
      }
    } else if (info.which === "left") {
      if (tab.index === 4) {
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
      if (!pinned) {
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

    await waitFor(() => {
      expect(chromeTabsQuerySpy).toHaveBeenCalledTimes(1);
      expect(chromeTabsQuerySpy).toHaveBeenCalledWith({ currentWindow: true }, anything);

      expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

      expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

      expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalSetSpy).toHaveBeenCalledWith({ into_group, merged_tabs }, anything);

      if (
        !(info.which === "right" && tab.index === 12) &&
        !(info.which === "left" && [0, 4].includes(tab.index)) &&
        !(info.which === "only" && tab.index === 6)
      ) {
        expect(chromeTabsRemoveSpy).toHaveBeenCalledTimes(2);
        if (
          (info.which === "right" && tab.index === 0) ||
          (info.which === "left" && [4, 12].includes(tab.index)) ||
          ["excluding", "all"].includes(info.which)
        ) {
          expect(chromeTabsRemoveSpy).toHaveBeenNthCalledWith(1, tab.index === 12 ? [2, 3, 4, 10, 11]: [2, 3, 4, 10, 11, 12]); // prettier-ignore
        } else {
          expect(chromeTabsRemoveSpy).toHaveBeenNthCalledWith(1, tab.index === 12 ? [10, 11] : [10, 11, 12]);
        }
        expect(chromeTabsRemoveSpy).toHaveBeenNthCalledWith(2, 7);
      } else {
        expect(chromeTabsRemoveSpy).toHaveBeenCalledTimes(1);
        expect(chromeTabsRemoveSpy).toHaveBeenCalledWith(info.which === "left" && tab.index === 4 ? [2, 3] : []);
      }
    });

    expect.hasAssertions();
  });
});

describe("findExtTabAndSwitch", () => {
  const expected_query = { title: "TabMerger", currentWindow: true };
  const expected_exists = { highlighted: true, active: true };
  const expected_not_exist = { url: "../index.html", active: true };
  const tab_id = 99;

  test("TabMerger page is already open", async () => {
    jest.clearAllMocks();

    const result = await BackgroundHelper.findExtTabAndSwitch();

    expect(result).toBe(0);

    expect(chromeTabsQuerySpy).toHaveBeenCalledTimes(1);
    expect(chromeTabsQuerySpy).toHaveBeenCalledWith(expected_query, anything);

    expect(chromeTabsUpdateSpy).toHaveBeenCalledTimes(1);
    expect(chromeTabsUpdateSpy).toHaveBeenCalledWith(tab_id, expected_exists, anything);
  });

  test.each([
    ["complete", true],
    ["complete", false],
    ["incomplete", true],
    ["incomplete", false],
  ])("TabMerger page is NOT already open - (loading = %s, match_id = %s)", async (type, id_match) => {
    chromeTabsQuerySpy.mockImplementationOnce((_, cb) => cb([]));
    chromeTabsCreateSpy.mockImplementationOnce((_, cb) => cb({ id: id_match ? tab_id : tab_id - 1 }));
    chromeTabsOnUpdatedAdd.mockImplementationOnce((cb) => cb(tab_id, { status: type }));
    global.resolve = jest.fn((arg) => Promise.resolve(arg));
    jest.clearAllMocks();

    const result = await BackgroundHelper.findExtTabAndSwitch(type !== "complete" || !id_match);

    expect(chromeTabsQuerySpy).toHaveBeenCalledTimes(1);
    expect(chromeTabsQuerySpy).toHaveBeenCalledWith(expected_query, anything);

    expect(chromeTabsCreateSpy).toHaveBeenCalledTimes(1);
    expect(chromeTabsCreateSpy).toHaveBeenCalledWith(expected_not_exist, anything);

    expect(chromeTabsOnUpdatedAdd).toHaveBeenCalledTimes(1);
    expect(chromeTabsOnUpdatedAdd).toHaveBeenCalledWith(anything);

    if (type === "complete" && id_match) {
      expect(chromeTabsOnUpdatedRemove).toHaveBeenCalledTimes(1);
      expect(chromeTabsOnUpdatedRemove).toHaveBeenCalledWith(anything);
      expect(result).toEqual(0);
    } else {
      expect(chromeTabsOnUpdatedRemove).not.toHaveBeenCalled();
      expect(result).toEqual(1);
    }

    resolve.mockRestore();
  });
});

describe("excludeSite", () => {
  const original_url = "www.facebook.com";
  const url = "www.google.com";

  it.each([["empty"], ["NOT empty"]])("adjusts sync storage correctly - %s", (type) => {
    CONSTANTS.DEFAULT_SETTINGS.blacklist = type === "empty" ? "" : original_url + ", ";
    sessionStorage.setItem("settings", JSON.stringify(CONSTANTS.DEFAULT_SETTINGS));
    CONSTANTS.DEFAULT_SETTINGS.blacklist = "";
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
