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

import { render, waitFor, fireEvent, act } from "@testing-library/react";

import * as AppFunc from "../../src/components/App/App_functions";
import * as AppHelper from "../../src/components/App/App_helpers";

import App from "../../src/components/App/App";
import { exportedVal } from "../__mocks__/jsonImportMock";

var chromeSyncSetSpy, chromeSyncGetSpy, chromeSyncRemoveSpy;
var chromeLocalSetSpy, chromeLocalGetSpy, chromeLocalRemoveSpy;
var mockSet, container, sync_node, anything;

beforeEach(() => {
  mockSet = jest.fn(); // mock for setState hooks
  anything = expect.anything();

  container = render(<App />).container;
  sync_node = container.querySelector("#sync-text span");

  Object.keys(init_groups).forEach((key) => {
    sessionStorage.setItem(key, JSON.stringify(init_groups[key]));
  });

  localStorage.setItem("groups", JSON.stringify(init_groups));

  chromeSyncSetSpy = jest.spyOn(chrome.storage.sync, "set");
  chromeSyncGetSpy = jest.spyOn(chrome.storage.sync, "get");
  chromeSyncRemoveSpy = jest.spyOn(chrome.storage.sync, "remove");

  chromeLocalSetSpy = jest.spyOn(chrome.storage.local, "set");
  chromeLocalGetSpy = jest.spyOn(chrome.storage.local, "get");
  chromeLocalRemoveSpy = jest.spyOn(chrome.storage.local, "remove");
});

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  jest.clearAllMocks();
});

describe("badgeIconInfo", () => {
  var chromeBrowserActionSetBadgeTextSpy = jest.spyOn(chrome.browserAction, "setBadgeText");
  var chromeBrowserActionSetBadgeBackgroundColorSpy = jest.spyOn(chrome.browserAction, "setBadgeBackgroundColor");
  var chromeBrowserActionSetTitleSpy = jest.spyOn(chrome.browserAction, "setTitle");

  const COLORS = { green: "#060", yellow: "#CC0", orange: "#C70", red: "#C00" };

  test.each([
    [1, COLORS.green, false],
    [20, COLORS.green, false],
    [40, COLORS.yellow, false],
    [60, COLORS.orange, false],
    [80, COLORS.red, false],
    [80, COLORS.red, true],
  ])("color, text, and title are correct for %s tabs", (num_tabs, color, one_group) => {
    const expected_title = `You currently have ${num_tabs} ${num_tabs === 1 ? "tab" : "tabs"} in ${one_group ? 1 + " group" : 4 + " groups"}`; // prettier-ignore
    const expected_text = `${num_tabs}|${one_group ? 1 : 4}`;

    if (one_group) {
      localStorage.setItem("groups", JSON.stringify({ "group-0": default_group }));
    }

    jest.clearAllMocks();

    AppFunc.badgeIconInfo(num_tabs);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(chromeBrowserActionSetBadgeTextSpy).toHaveBeenCalledTimes(1);
    expect(chromeBrowserActionSetBadgeTextSpy).toHaveBeenCalledWith({ text: expected_text }, anything);

    expect(chromeBrowserActionSetBadgeBackgroundColorSpy).toHaveBeenCalledTimes(1);
    expect(chromeBrowserActionSetBadgeBackgroundColorSpy).toHaveBeenCalledWith({ color }, anything);

    expect(chromeBrowserActionSetTitleSpy).toHaveBeenCalledTimes(1);
    expect(chromeBrowserActionSetTitleSpy).toHaveBeenCalledWith({ title: expected_title }, anything);
  });

  it("does nothing if there are no groups in local storage", () => {
    localStorage.removeItem("groups");
    jest.clearAllMocks();

    AppFunc.badgeIconInfo(10);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(chromeBrowserActionSetBadgeTextSpy).not.toHaveBeenCalled();
    expect(chromeBrowserActionSetBadgeBackgroundColorSpy).not.toHaveBeenCalled();
    expect(chromeBrowserActionSetTitleSpy).not.toHaveBeenCalled();
  });
});

describe("storageInit", () => {
  test("sync settings are null & local groups are null", () => {
    sessionStorage.clear();
    localStorage.clear();
    jest.clearAllMocks();

    AppFunc.storageInit(default_settings, default_group, sync_node, mockSet, mockSet);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith(null, anything);

    expect(chromeSyncSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncSetSpy).toHaveBeenCalledWith({ settings: default_settings }, anything);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(chromeLocalRemoveSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalRemoveSpy).toHaveBeenCalledWith(["groups"], anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: { "group-0": default_group }, groups_copy: [], scroll: 0 }, anything); // prettier-ignore

    expect(mockSet).toHaveBeenCalledTimes(2);
  });

  test("sync settings exist & sync group-0 is null", () => {
    sessionStorage.setItem("settings", 1);
    jest.clearAllMocks();

    AppFunc.storageInit(default_settings, default_group, sync_node, mockSet, mockSet);

    expect(chromeSyncSetSpy).not.toHaveBeenCalled();
  });

  test("sync group-0 exists & local groups exist", () => {
    sessionStorage.setItem("group-0", 1);
    localStorage.setItem("groups", JSON.stringify(init_groups));
    jest.clearAllMocks();

    AppFunc.storageInit(default_settings, default_group, sync_node, mockSet, mockSet);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: init_groups, groups_copy: [], scroll: 0 }, anything);
    expect(mockSet).toHaveBeenCalledTimes(2);
  });
});

describe("syncWrite", () => {
  it("does nothing when no groups in local storage", () => {
    jest.clearAllMocks();

    AppFunc.syncWrite(sync_node);

    expect(chromeSyncSetSpy).not.toHaveBeenCalled();
  });

  it("does nothing when no tabs in TabMerger and only default group is made", () => {
    localStorage.setItem("groups", JSON.stringify({ "group-0": default_group }));
    jest.clearAllMocks();

    AppFunc.syncWrite(sync_node);

    expect(chromeSyncSetSpy).not.toHaveBeenCalled();
  });

  it("calls the correct functions when less groups", async () => {
    // to simulate having to remove extras, since less groups now
    localStorage.setItem("groups", JSON.stringify({ "group-0": init_groups["group-0"] }));
    jest.clearAllMocks();

    AppFunc.syncWrite(sync_node);

    await waitFor(() => {
      expect(chromeSyncGetSpy).toHaveBeenCalledTimes(2);
      expect(chromeSyncGetSpy).toHaveBeenNthCalledWith(1, "group-0", anything); // await AppHelper.updateGroupItem
      expect(chromeSyncGetSpy).toHaveBeenNthCalledWith(2, null, anything);

      expect(chromeSyncSetSpy).not.toHaveBeenCalled();

      expect(chromeSyncRemoveSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncRemoveSpy).toHaveBeenCalledWith(Object.keys(init_groups).splice(1), anything);
    });

    expect.hasAssertions();
  });

  it("calls the correct functions when more groups", async () => {
    init_groups["group-11"] = default_group;
    localStorage.setItem("groups", JSON.stringify(init_groups));
    jest.clearAllMocks();

    AppFunc.syncWrite(sync_node);

    await waitFor(() => {
      expect(chromeSyncGetSpy).toHaveBeenCalledTimes(6);
      expect(chromeSyncGetSpy).toHaveBeenNthCalledWith(1, "group-0", anything); // await AppHelper.updateGroupItem
      expect(chromeSyncGetSpy).toHaveBeenNthCalledWith(6, null, anything);

      expect(chromeSyncSetSpy).toHaveBeenCalled();

      expect(chromeSyncRemoveSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncRemoveSpy).toHaveBeenCalledWith([], anything);
    });

    expect.hasAssertions();
  });
});

describe("syncRead", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
  });

  it("does nothing when no groups in sync storage", () => {
    AppFunc.syncRead(sync_node, mockSet, mockSet);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith(null, anything);
  });

  it("calls the correct functions", () => {
    const new_ss_item = {
      "group-0": init_groups["group-0"],
      "group-1": init_groups["group-1"],
    };

    sessionStorage.setItem("group-0", JSON.stringify(new_ss_item["group-0"]));
    sessionStorage.setItem("group-1", JSON.stringify(new_ss_item["group-1"]));

    jest.clearAllMocks();

    AppFunc.syncRead(sync_node, mockSet, mockSet);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncRemoveSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncRemoveSpy).toHaveBeenCalledWith(["group-0", "group-1"], anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalRemoveSpy).toHaveBeenCalledTimes(1);

    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: new_ss_item, scroll: 0 }, anything);
    expect(chromeLocalRemoveSpy).toHaveBeenCalledWith(["groups"], anything);
  });
});

describe("openOrRemoveTabs", () => {
  var chromeTabsMove, chromeTabsCreate;
  var tab_single = ["https://stackoverflow.com/"];
  var tab_group = [...tab_single, "https://lichess.org/", "https://www.chess.com/"];
  var tab_all = [...tab_group, "https://www.twitch.tv/", "https://www.reddit.com/", "https://www.a.com/", "https://www.b.com/"]; // prettier-ignore
  const tab_arr_map = { SINGLE: tab_single, GROUP: tab_group, ALL: tab_all };

  var open_tabs;
  beforeEach(() => {
    open_tabs = [
      { active: true, id: 0, pinned: false, url: location.href + "a" },
      { active: false, id: 1, pinned: false, url: location.href + "b" },
      { active: false, id: 2, pinned: false, url: location.href + "c" },
    ];
    sessionStorage.setItem("open_tabs", JSON.stringify(open_tabs));

    chromeTabsMove = jest.spyOn(chrome.tabs, "move");
    chromeTabsCreate = jest.spyOn(chrome.tabs, "create");
    jest.clearAllMocks();
  });

  afterEach(() => {
    sessionStorage.removeItem("open_tabs");
  });

  it("does nothing when namespace is not 'local'", () => {
    AppFunc.openOrRemoveTabs({}, "sync", mockSet, mockSet);

    expect(chromeTabsMove).not.toHaveBeenCalled();
    expect(chromeTabsCreate).not.toHaveBeenCalled();
    expect(chromeSyncGetSpy).not.toHaveBeenCalled();
    expect(chromeLocalGetSpy).not.toHaveBeenCalled();
    expect(chromeLocalSetSpy).not.toHaveBeenCalled();
    expect(chromeLocalRemoveSpy).not.toHaveBeenCalled();
  });

  test.each([
    ["KEEP", "WITHOUT", "SINGLE"],
    ["KEEP", "WITHOUT", "GROUP"],
    ["KEEP", "WITHOUT", "ALL"],
    ["REMOVE", "WITH", "SINGLE"],
    ["REMOVE", "WITH", "GROUP"],
    ["REMOVE", "WITH", "ALL"],
  ])("settings.restore === '%s' - opens the correct tab %s removing - tab isn't open / %s", (keepOrRemove, _, type) => {
    // ARRANGE
    var stub = { remove: { newValue: [type !== "ALL" ? "group-0" : null, ...tab_arr_map[type]] } };
    var expect_open_tabs = [...open_tabs, ...tab_arr_map[type].map((url) => ({ active: false, pinned: false, url }))];

    sessionStorage.setItem("settings", JSON.stringify({ restore: keepOrRemove.toLowerCase() }));

    var expected_groups = JSON.parse(localStorage.getItem("groups")); // only used in remove case
    if (type === "SINGLE") {
      expected_groups["group-0"].tabs.shift();
    } else if (type === "GROUP") {
      expected_groups["group-0"].tabs = [];
    } else {
      Object.keys(expected_groups).forEach((key) => {
        expected_groups[key].tabs = [];
      });
    }

    jest.clearAllMocks();

    // ACT
    AppFunc.openOrRemoveTabs(stub, "local", mockSet, mockSet);

    // ASSERT
    expect(chromeTabsMove).not.toHaveBeenCalled();

    expect(chromeTabsCreate).toHaveBeenCalledTimes(tab_arr_map[type].length);
    tab_arr_map[type].forEach((url) => {
      expect(chromeTabsCreate).toHaveBeenCalledWith({ active: false, pinned: false, url }, anything);
    });

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    if (keepOrRemove === "KEEP") {
      expect(chromeLocalSetSpy).not.toHaveBeenCalled();
    } else {
      expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: expected_groups, scroll: 0 }, anything);

      expect(mockSet).toHaveBeenCalledTimes(2);
      expect(mockSet).toHaveBeenNthCalledWith(1, tab_arr_map["ALL"].length - tab_arr_map[type].length);
      expect(mockSet).toHaveBeenNthCalledWith(2, JSON.stringify(expected_groups));
    }

    expect(chromeLocalRemoveSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalRemoveSpy).toHaveBeenCalledWith(["remove"], anything);

    expect(JSON.parse(sessionStorage.getItem("open_tabs"))).toStrictEqual(expect_open_tabs);
  });

  test("restore already open - opens the correct tabs MOVING them to correct position in array", () => {
    var expect_open_tabs = [open_tabs[2], open_tabs[0], open_tabs[1]];
    var stub = { remove: { newValue: ["group-0", open_tabs[0].url, open_tabs[1].url] } };

    sessionStorage.setItem("settings", JSON.stringify({ restore: "remove" }));

    // add new tabs that are also open
    var current_groups = JSON.parse(localStorage.getItem("groups"));
    current_groups["group-0"].tabs.push({ url: open_tabs[0].url, title: "already open a" });
    current_groups["group-0"].tabs.push({ url: open_tabs[1].url, title: "already open b" });
    localStorage.setItem("groups", JSON.stringify(current_groups));

    jest.clearAllMocks();

    AppFunc.openOrRemoveTabs(stub, "local", mockSet, mockSet);

    expect(chromeTabsMove).toHaveBeenCalledTimes(2);
    expect(chromeTabsMove).toHaveBeenNthCalledWith(1, 0, { index: -1 });
    expect(chromeTabsMove).toHaveBeenNthCalledWith(2, 1, { index: -1 });

    expect(JSON.parse(sessionStorage.getItem("open_tabs"))).toStrictEqual(expect_open_tabs) // prettier-ignore
  });
});

// note that duplicate removal is made in background script!
describe("checkMerging", () => {
  var chromeTabsRemove;
  const SYNC_LIMIT = 102000;
  const ITEM_LIMIT = 8000;

  var merge_all = [
    { id: 0, pinned: false, title: "merged tab a", url: location.href + "a" },
    { id: 1, pinned: false, title: "merged tab b", url: location.href + "b" },
    { id: 2, pinned: false, title: "merged tab c", url: location.href + "c" },
  ];

  beforeEach(() => {
    global.alert = jest.fn();
    chromeTabsRemove = jest.spyOn(chrome.tabs, "remove");
    jest.clearAllMocks();
  });

  it("does nothing when namespace is not 'local'", () => {
    AppFunc.checkMerging({}, "sync", SYNC_LIMIT, ITEM_LIMIT, mockSet, mockSet);

    expect(chromeLocalGetSpy).not.toHaveBeenCalled();
    expect(chromeLocalSetSpy).not.toHaveBeenCalled();
    expect(chromeTabsRemove).not.toHaveBeenCalled();
    expect(chromeLocalRemoveSpy).not.toHaveBeenCalled();
  });

  test.each([["NOT"], ["SYNC"], ["ITEM"]])("merge all and none exist in TabMerger - %s exceeding limit", (type) => {
    var stub = { merged_tabs: { newValue: merge_all } };
    const into_group = "group-1";

    var expected_groups = JSON.parse(localStorage.getItem("groups"));
    expected_groups[into_group].tabs = [
      ...expected_groups[into_group].tabs,
      ...merge_all.map((x) => ({ pinned: false, title: x.title, url: x.url })),
    ];

    localStorage.setItem("groups", JSON.stringify(init_groups));
    localStorage.setItem("into_group", into_group);
    localStorage.setItem("merged_tabs", JSON.stringify(merge_all));
    sessionStorage.setItem("open_tabs", JSON.stringify(merge_all));

    jest.clearAllMocks();

    if (type === "NOT") {
      AppFunc.checkMerging(stub, "local", SYNC_LIMIT, ITEM_LIMIT, mockSet, mockSet);
    } else if (type === "SYNC") {
      AppFunc.checkMerging(stub, "local", 100, ITEM_LIMIT, mockSet, mockSet);
    } else {
      AppFunc.checkMerging(stub, "local", SYNC_LIMIT, 100, mockSet, mockSet);
    }

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith(["merged_tabs", "into_group", "groups"], anything);

    if (type === "NOT") {
      expect(chromeTabsRemove).toHaveBeenCalledTimes(1);
      expect(chromeTabsRemove).toHaveBeenCalledWith([0, 1, 2]);

      expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: expected_groups, scroll: 0 }, anything);

      expect(mockSet).toHaveBeenCalledTimes(2);
      expect(mockSet).toHaveBeenNthCalledWith(1, 10);
      expect(mockSet).toHaveBeenNthCalledWith(2, JSON.stringify(expected_groups));
    } else {
      expect(chromeTabsRemove).not.toHaveBeenCalled();
      expect(chromeLocalSetSpy).not.toHaveBeenCalled();
      expect(mockSet).not.toHaveBeenCalled();
    }

    expect(chromeLocalRemoveSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalRemoveSpy).toHaveBeenCalledWith(["into_group", "merged_tabs"], anything);

    if (type === "NOT") {
      expect(sessionStorage.getItem("open_tabs")).toBe("[]");
    } else if (type === "SYNC") {
      expect(alert.mock.calls.pop()[0]).toContain("Total syncing capacity exceeded by");
      expect(sessionStorage.getItem("open_tabs")).toBe(JSON.stringify(merge_all));
    } else {
      expect(alert.mock.calls.pop()[0]).toContain("Group's syncing capacity exceeded by");
      expect(sessionStorage.getItem("open_tabs")).toBe(JSON.stringify(merge_all));
    }
  });
});

describe("addGroup", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("warns if group limit exceeded", () => {
    global.alert = jest.fn();

    AppFunc.addGroup(1, mockSet);

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls.pop()[0]).toContain("Number of groups exceeded.");

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(chromeSyncGetSpy).not.toHaveBeenCalled();
    expect(chromeLocalSetSpy).not.toHaveBeenCalled();
  });

  it("adjusts the groups if limit is not exceeded", () => {
    Object.defineProperty(document.body, "scrollHeight", { writable: true, configurable: true, value: 1000 });

    delete init_groups["group-11"];
    localStorage.setItem("groups", JSON.stringify(init_groups));

    var groups = init_groups;
    default_group.created = AppHelper.getTimestamp();
    groups["group-4"] = default_group;

    AppFunc.addGroup(100, mockSet);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups, scroll: document.body.scrollHeight }, anything);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(JSON.stringify(groups));
  });
});

describe("openAllTabs", () => {
  it("sets the local storage item correctly", () => {
    document.body.innerHTML = '<div><a class="a-tab" href="www.abc.com"></a></div>';
    var expected_ls = { remove: [null, location.href + "www.abc.com"] };

    chromeLocalSetSpy.mockClear();
    localStorage.setItem("groups", JSON.stringify(init_groups));

    AppFunc.openAllTabs();

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith(expected_ls, anything);
  });
});

describe("deleteAllGroups", () => {
  it("adjusts local storage to a default group only if user accepts", () => {
    sessionStorage.setItem("settings", JSON.stringify(default_settings));
    localStorage.setItem("groups_copy", JSON.stringify([]));
    localStorage.setItem("groups", JSON.stringify(init_groups));

    window.confirm = jest.fn().mockImplementation(() => true);

    var new_entry = { "group-0": default_group };
    new_entry["group-0"].created = AppHelper.getTimestamp();

    jest.clearAllMocks();

    AppFunc.deleteAllGroups(mockSet, mockSet);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: new_entry, groups_copy: [init_groups], scroll: 0 }, anything); // prettier-ignore

    expect(mockSet).toHaveBeenCalledTimes(2);
    expect(mockSet).toHaveBeenNthCalledWith(1, 0);
    expect(mockSet).toHaveBeenNthCalledWith(2, JSON.stringify(new_entry));

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(window.confirm.mock.calls.pop()[0]).toContain("Are you sure?");
    window.confirm.mockRestore();
  });

  it("adjusts local storage to a default group only", () => {
    window.confirm = jest.fn().mockImplementation(() => false);

    jest.clearAllMocks();

    AppFunc.deleteAllGroups(mockSet, mockSet);

    expect(chromeSyncGetSpy).not.toHaveBeenCalled();
    expect(chromeLocalSetSpy).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(window.confirm.mock.calls.pop()[0]).toContain("Are you sure?");
    window.confirm.mockRestore();
  });
});

describe("undoDestructiveAction", () => {
  beforeEach(() => {
    localStorage.setItem("groups", JSON.stringify(init_groups));
  });

  test("can undo a state", () => {
    localStorage.setItem("groups_copy", JSON.stringify([init_groups]));
    jest.clearAllMocks();

    AppFunc.undoDestructiveAction(mockSet, mockSet);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith(["groups", "groups_copy"], anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: init_groups, groups_copy: [], scroll: 0 }, anything); // prettier-ignore
  });

  test("can NOT undo a state", () => {
    localStorage.setItem("groups_copy", JSON.stringify([]));
    global.alert = jest.fn();
    jest.clearAllMocks();

    AppFunc.undoDestructiveAction(mockSet, mockSet);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith(["groups", "groups_copy"], anything);

    expect(chromeLocalSetSpy).not.toHaveBeenCalled();

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls.pop()[0]).toBe("There are no more states to undo");
  });
});

describe("dragOver", () => {
  var drag_elem, stub;

  beforeEach(() => {
    document.body.innerHTML =
      `<div class="group">` +
      `  <div class="tabs-container">` +
      `    <div class="draggable">a</div>` +
      `    <div class="draggable">b</div>` +
      `    <div class="draggable">c</div>` +
      `  </div>` +
      `</div>`;

    drag_elem = document.querySelector(".draggable");
    drag_elem.classList.add("dragging");

    stub = { preventDefault: jest.fn(), clientY: window.innerHeight, target: drag_elem };

    global.scrollTo = jest.fn();
  });

  it.each([
    ["START/MIDDLE", 2, window.innerHeight, ["b", "a", "c"]],
    ["END", 3, 20, ["b", "c", "a"]],
    ["AFTER=DRAG", 0, 0, ["a", "b", "c"]],
  ])("finds the correct after element -> %s", (type, tab_num, scroll, expect_result) => {
    var getDragAfterElementSpy = jest.spyOn(AppHelper, "getDragAfterElement").mockImplementation(() => {
      return document.querySelectorAll(".draggable")[tab_num];
    });
    stub.clientY = scroll;

    AppFunc.dragOver(stub);

    const tabs_text = [...document.querySelectorAll(".draggable")].map((x) => x.textContent);
    expect(tabs_text).toEqual(expect_result);

    if (type === "END") {
      expect(global.scrollTo).not.toHaveBeenCalled();
    } else {
      expect(global.scrollTo).toHaveBeenCalled();
      expect(global.scrollTo).toHaveBeenCalledWith(0, stub.clientY);
    }

    getDragAfterElementSpy.mockRestore();
  });
});

describe("regexSearchForTab", () => {
  var input;
  beforeEach(() => {
    document.body.innerHTML =
      `<div class="group-item">` +
      `  <input class="title-edit-input" value="aaaaa"/>` +
      `  <div class="draggable">` +
      `    <a href="#" class="a-tab">aaaaa</a>` +
      `  </div>` +
      `</div>` +
      `<div class="group-item">` +
      `  <input class="title-edit-input" value="bbbbb"/>` +
      `  <div class="draggable">` +
      `    <a href="#" class="a-tab">bbbbb</a>` +
      `  </div>` +
      `</div>`;

    input = container.querySelector(".search-filter input");
  });

  it.each([
    ["group", "NO", "#c", ["none", "none"]],
    ["group", "YES", "#a", ["", "none"]],
    ["tab", "NO", "c", ["none", "none"]],
    ["tab", "YES", "b", ["none", ""]],
    ["blank", "BACKSPACE_BLANK", "", ["", ""]],
  ])("works for %s search - %s match", (type, match, value, expect_arr) => {
    if (match !== "BACKSPACE_BLANK") {
      fireEvent.change(input, { target: { value } });
    } else {
      fireEvent.change(input, { target: { value: "random" } });
      fireEvent.change(input, { target: { value } });
    }

    const targets = [...document.body.querySelectorAll(type === "tab" ? ".draggable" : ".group-item")];
    expect(targets.map((x) => x.style.display)).toStrictEqual(expect_arr);
  });
});

describe("importJSON", () => {
  it("alerts on wrong non json input", () => {
    global.alert = jest.fn();
    const input = { target: { files: [{ type: "application/pdf" }] } };
    jest.clearAllMocks();

    AppFunc.importJSON(input, mockSet, mockSet);

    expect(chromeSyncSetSpy).not.toHaveBeenCalled();
    expect(chromeLocalSetSpy).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls.pop()[0]).toContain("You must import a JSON file (.json extension)!");
  });

  it("updates sync and local storage on valid input", () => {
    const fakeFile = new File([JSON.stringify(exportedVal)], "file.json", { type: "application/json" });
    const input = { target: { files: [fakeFile] } };

    jest.spyOn(global, "FileReader").mockImplementation(function () {
      this.readAsText = jest.fn(() => (this.result = JSON.stringify(exportedVal)));
    });
    jest.clearAllMocks();

    AppFunc.importJSON(input, mockSet, mockSet);

    expect(FileReader).toHaveBeenCalledTimes(1);
    const reader = FileReader.mock.instances[0];
    act(() => reader.onload());

    expect(reader.readAsText).toHaveBeenCalledTimes(1);
    expect(reader.readAsText).toHaveBeenCalledWith(fakeFile);
    expect(reader.onload).toEqual(expect.any(Function));

    expect(chromeSyncSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncSetSpy).toHaveBeenCalledWith({ settings: exportedVal.settings }, anything);

    delete exportedVal.settings;

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: exportedVal, scroll: 0 }, anything);

    expect(mockSet).toHaveBeenCalledTimes(2);
    expect(mockSet).toHaveBeenNthCalledWith(1, JSON.stringify(exportedVal));
    expect(mockSet).toHaveBeenNthCalledWith(2, 12);
  });
});

describe("exportJSON", () => {
  it("correctly exports a JSON file of the current configuration", () => {
    function makeAnchor(target) {
      return {
        target,
        setAttribute: jest.fn((key, value) => (target[key] = value)),
        click: jest.fn(),
        remove: jest.fn(),
      };
    }

    var anchor = makeAnchor({ href: "#", download: "" });
    var createElementMock = jest.spyOn(document, "createElement").mockReturnValue(anchor);
    var setAttributeSpy = jest.spyOn(anchor, "setAttribute");
    var clickSpy = jest.spyOn(anchor, "click");
    var removeSpy = jest.spyOn(anchor, "remove");

    var group_blocks = JSON.parse(localStorage.getItem("groups"));
    group_blocks["settings"] = JSON.parse(sessionStorage.getItem("settings"));
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(group_blocks, null, 2));

    jest.clearAllMocks();

    AppFunc.exportJSON();

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

    expect(document.createElement).toHaveBeenCalledTimes(1);
    expect(document.createElement).toHaveBeenCalledWith("a");

    expect(setAttributeSpy).toHaveBeenCalledTimes(2);
    expect(setAttributeSpy).toHaveBeenNthCalledWith(1, "href", dataStr);
    expect(setAttributeSpy).toHaveBeenNthCalledWith(2, "download", AppHelper.outputFileName() + ".json");

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledTimes(1);

    createElementMock.mockRestore();
  });
});

describe("translate", () => {
  it("returns a translation if avaiable", () => {
    expect(AppFunc.translate("Title")).toEqual("титул");
  });

  it("returns original msg if translation is not available", () => {
    expect(AppFunc.translate("random")).toEqual("random");
  });
});
