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
var mockSet, container, new_item, sync_node, sync_container, anything;

beforeEach(() => {
  mockSet = jest.fn(); // mock for setState hooks
  anything = expect.anything();

  container = render(<App />).container;
  sync_node = container.querySelector("#sync-text span");
  sync_container = sync_node.parentNode;

  new_item = init_groups["group-0"];
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
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: { "group-0": default_group } }, anything);

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
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: init_groups }, anything);
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

    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: new_ss_item }, anything);
    expect(chromeLocalRemoveSpy).toHaveBeenCalledWith(["groups"], anything);
  });
});

describe("openOrRemoveTabs", () => {
  var chromeTabsMove, chromeTabsCreate;
  var tab_single = "https://stackoverflow.com/";
  var tab_group = ["https://stackoverflow.com/", "https://lichess.org/", "https://www.chess.com/"];
  var tab_all = [...tab_group, "https://www.twitch.tv/", "https://www.reddit.com/", "https://www.a.com/", "https://www.b.com/"]; // prettier-ignore

  var open_tabs;

  beforeEach(() => {
    open_tabs = [
      { url: location.href + "a", id: 0, active: true },
      { url: location.href + "b", id: 1, active: false },
      { url: location.href + "c", id: 2, active: false },
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

  describe("settings.restore === 'keep'", () => {
    it("opens the correct tab WITHOUT removing - tab isn't open / single", () => {
      var stub = { remove: { newValue: ["group-0", tab_single] } };
      jest.clearAllMocks();

      AppFunc.openOrRemoveTabs(stub, "local", mockSet, mockSet);

      expect(chromeTabsMove).not.toHaveBeenCalled();

      expect(chromeTabsCreate).toHaveBeenCalledTimes(1);
      expect(chromeTabsCreate).toHaveBeenCalledWith({ url: tab_single, active: false });

      expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

      expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

      expect(chromeLocalSetSpy).not.toHaveBeenCalled();

      expect(chromeLocalRemoveSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalRemoveSpy).toHaveBeenCalledWith(["remove"], anything);

      expect(JSON.parse(sessionStorage.getItem("open_tabs"))).toStrictEqual([...open_tabs, {url: tab_single, active: false}]) // prettier-ignore
    });

    it("opens the correct tab WITHOUT removing - tab isn't open / group", () => {
      var expect_open_tabs = [...open_tabs, ...tab_group.map((url) => ({ url, active: false }))];
      var stub = { remove: { newValue: ["group-0", ...tab_group] } };
      jest.clearAllMocks();

      AppFunc.openOrRemoveTabs(stub, "local", mockSet, mockSet);

      expect(chromeTabsMove).not.toHaveBeenCalled();

      expect(chromeTabsCreate).toHaveBeenCalledTimes(tab_group.length);
      tab_group.forEach((url) => {
        expect(chromeTabsCreate).toHaveBeenCalledWith({ url, active: false });
      });

      expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

      expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

      expect(chromeLocalSetSpy).not.toHaveBeenCalled();

      expect(chromeLocalRemoveSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalRemoveSpy).toHaveBeenCalledWith(["remove"], anything);

      expect(JSON.parse(sessionStorage.getItem("open_tabs"))).toStrictEqual(expect_open_tabs);
    });

    it("opens the correct tab WITHOUT removing - tab isn't open / all", () => {
      var expect_open_tabs = [...open_tabs, ...tab_all.map((url) => ({ url, active: false }))];
      var stub = { remove: { newValue: [null, ...tab_all] } };
      jest.clearAllMocks();

      AppFunc.openOrRemoveTabs(stub, "local", mockSet, mockSet);

      expect(chromeTabsMove).not.toHaveBeenCalled();

      expect(chromeTabsCreate).toHaveBeenCalledTimes(tab_all.length);
      tab_all.forEach((url) => {
        expect(chromeTabsCreate).toHaveBeenCalledWith({ url, active: false });
      });

      expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

      expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

      expect(chromeLocalSetSpy).not.toHaveBeenCalled();

      expect(chromeLocalRemoveSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalRemoveSpy).toHaveBeenCalledWith(["remove"], anything);

      expect(JSON.parse(sessionStorage.getItem("open_tabs"))).toStrictEqual(expect_open_tabs);
    });
  });

  describe("settings.restore !== 'keep'", () => {
    it("opens the correct tabs AND removes them - tab isn't open / single", () => {
      var stub = { remove: { newValue: ["group-0", tab_single] } };

      sessionStorage.setItem("settings", JSON.stringify({ restore: "remove" }));
      jest.clearAllMocks();

      var expected_groups = JSON.parse(localStorage.getItem("groups"));
      AppFunc.openOrRemoveTabs(stub, "local", mockSet, mockSet);
      expected_groups["group-0"].tabs.shift();

      expect(chromeTabsMove).not.toHaveBeenCalled();

      expect(chromeTabsCreate).toHaveBeenCalledTimes(1);
      expect(chromeTabsCreate).toHaveBeenCalledWith({ url: tab_single, active: false });

      expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

      expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

      expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: expected_groups }, anything);

      expect(mockSet).toHaveBeenCalledTimes(2);
      expect(mockSet).toHaveBeenNthCalledWith(1, 6);
      expect(mockSet).toHaveBeenNthCalledWith(2, JSON.stringify(expected_groups));

      expect(chromeLocalRemoveSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalRemoveSpy).toHaveBeenCalledWith(["remove"], anything);

      expect(JSON.parse(sessionStorage.getItem("open_tabs"))).toStrictEqual([...open_tabs, {url: tab_single, active: false}]) // prettier-ignore
    });

    it("opens the correct tabs AND removes them - tab isn't open / group", () => {
      var expect_open_tabs = [...open_tabs, ...tab_group.map((url) => ({ url, active: false }))];
      var stub = { remove: { newValue: ["group-0", ...tab_group] } };

      sessionStorage.setItem("settings", JSON.stringify({ restore: "remove" }));
      jest.clearAllMocks();

      var expected_groups = JSON.parse(localStorage.getItem("groups"));
      AppFunc.openOrRemoveTabs(stub, "local", mockSet, mockSet);
      expected_groups["group-0"].tabs = [];

      expect(chromeTabsMove).not.toHaveBeenCalled();

      expect(chromeTabsCreate).toHaveBeenCalledTimes(tab_group.length);
      tab_group.forEach((url) => {
        expect(chromeTabsCreate).toHaveBeenCalledWith({ url, active: false });
      });

      expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

      expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

      expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: expected_groups }, anything);

      expect(mockSet).toHaveBeenCalledTimes(2);
      expect(mockSet).toHaveBeenNthCalledWith(1, 4);
      expect(mockSet).toHaveBeenNthCalledWith(2, JSON.stringify(expected_groups));

      expect(chromeLocalRemoveSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalRemoveSpy).toHaveBeenCalledWith(["remove"], anything);

      expect(JSON.parse(sessionStorage.getItem("open_tabs"))).toStrictEqual(expect_open_tabs) // prettier-ignore
    });

    it("opens the correct tabs AND removes them - tab isn't open / all", () => {
      var expect_open_tabs = [...open_tabs, ...tab_all.map((url) => ({ url, active: false }))];
      var stub = { remove: { newValue: [null, ...tab_all] } };

      sessionStorage.setItem("settings", JSON.stringify({ restore: "remove" }));
      jest.clearAllMocks();

      var expected_groups = JSON.parse(localStorage.getItem("groups"));
      AppFunc.openOrRemoveTabs(stub, "local", mockSet, mockSet);

      Object.keys(expected_groups).forEach((key) => {
        expected_groups[key].tabs = [];
      });

      expect(chromeTabsMove).not.toHaveBeenCalled();

      expect(chromeTabsCreate).toHaveBeenCalledTimes(tab_all.length);
      tab_all.forEach((url) => {
        expect(chromeTabsCreate).toHaveBeenCalledWith({ url, active: false });
      });

      expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

      expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

      expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: expected_groups }, anything);

      expect(mockSet).toHaveBeenCalledTimes(2);
      expect(mockSet).toHaveBeenNthCalledWith(1, 0);
      expect(mockSet).toHaveBeenNthCalledWith(2, JSON.stringify(expected_groups));

      expect(chromeLocalRemoveSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalRemoveSpy).toHaveBeenCalledWith(["remove"], anything);

      expect(JSON.parse(sessionStorage.getItem("open_tabs"))).toStrictEqual(expect_open_tabs) // prettier-ignore
    });
  });

  describe("restore already open (forcing it to move)", () => {
    it("opens the correct tabs MOVING them to correct position in array", () => {
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
});

// note that duplicate removal is made in background script!
describe("checkMerging", () => {
  var chromeTabsRemove;
  const SYNC_LIMIT = 102000;
  const ITEM_LIMIT = 8000;

  var merge_all = [
    { url: location.href + "a", title: "merged tab a", id: 0 },
    { url: location.href + "b", title: "merged tab b", id: 1 },
    { url: location.href + "c", title: "merged tab c", id: 2 },
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

  test("merge all and none exist in TabMerger - no exceeding limit", () => {
    var stub = { merged_tabs: { newValue: merge_all } };
    const into_group = "group-1";

    var expected_groups = JSON.parse(localStorage.getItem("groups"));
    expected_groups[into_group].tabs = [
      ...expected_groups[into_group].tabs,
      ...merge_all.map((x) => ({ title: x.title, url: x.url })),
    ];

    localStorage.setItem("groups", JSON.stringify(init_groups));
    localStorage.setItem("into_group", into_group);
    localStorage.setItem("merged_tabs", JSON.stringify(merge_all));
    sessionStorage.setItem("open_tabs", JSON.stringify(merge_all));

    jest.clearAllMocks();

    AppFunc.checkMerging(stub, "local", SYNC_LIMIT, ITEM_LIMIT, mockSet, mockSet);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith(["merged_tabs", "into_group", "groups"], anything);

    expect(chromeTabsRemove).toHaveBeenCalledTimes(1);
    expect(chromeTabsRemove).toHaveBeenCalledWith([0, 1, 2]);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: expected_groups }, anything);

    expect(mockSet).toHaveBeenCalledTimes(2);
    expect(mockSet).toHaveBeenNthCalledWith(1, 10);
    expect(mockSet).toHaveBeenNthCalledWith(2, JSON.stringify(expected_groups));

    expect(chromeLocalRemoveSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalRemoveSpy).toHaveBeenCalledWith(["into_group", "merged_tabs"], anything);

    expect(sessionStorage.getItem("open_tabs")).toBe("[]");
  });

  test("merge all and none exist in TabMerger - exceeding SYNC limit", () => {
    var stub = { merged_tabs: { newValue: merge_all } };
    const into_group = "group-1";

    var expected_groups = JSON.parse(localStorage.getItem("groups"));
    expected_groups[into_group].tabs = [
      ...expected_groups[into_group].tabs,
      ...merge_all.map((x) => ({ title: x.title, url: x.url })),
    ];

    localStorage.setItem("groups", JSON.stringify(init_groups));
    localStorage.setItem("into_group", into_group);
    localStorage.setItem("merged_tabs", JSON.stringify(merge_all));
    sessionStorage.setItem("open_tabs", JSON.stringify(merge_all));

    jest.clearAllMocks();

    AppFunc.checkMerging(stub, "local", 100, ITEM_LIMIT, mockSet, mockSet);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith(["merged_tabs", "into_group", "groups"], anything);

    expect(chromeTabsRemove).not.toHaveBeenCalled();
    expect(chromeLocalSetSpy).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();

    expect(chromeLocalRemoveSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalRemoveSpy).toHaveBeenCalledWith(["into_group", "merged_tabs"], anything);

    expect(alert.mock.calls.pop()[0]).toContain("Total syncing capacity exceeded by");
    expect(sessionStorage.getItem("open_tabs")).toBe(JSON.stringify(merge_all));
  });

  test("merge all and none exist in TabMerger - exceeding ITEM limit", () => {
    var stub = { merged_tabs: { newValue: merge_all } };
    const into_group = "group-1";

    var expected_groups = JSON.parse(localStorage.getItem("groups"));
    expected_groups[into_group].tabs = [
      ...expected_groups[into_group].tabs,
      ...merge_all.map((x) => ({ title: x.title, url: x.url })),
    ];

    localStorage.setItem("groups", JSON.stringify(init_groups));
    localStorage.setItem("into_group", into_group);
    localStorage.setItem("merged_tabs", JSON.stringify(merge_all));
    sessionStorage.setItem("open_tabs", JSON.stringify(merge_all));

    jest.clearAllMocks();

    AppFunc.checkMerging(stub, "local", SYNC_LIMIT, 100, mockSet, mockSet);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith(["merged_tabs", "into_group", "groups"], anything);

    expect(chromeTabsRemove).not.toHaveBeenCalled();
    expect(chromeLocalSetSpy).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();

    expect(chromeLocalRemoveSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalRemoveSpy).toHaveBeenCalledWith(["into_group", "merged_tabs"], anything);

    expect(alert.mock.calls.pop()[0]).toContain("Group's syncing capacity exceeded by");
    expect(sessionStorage.getItem("open_tabs")).toBe(JSON.stringify(merge_all));
  });
});

describe("addGroup", () => {
  beforeEach(() => {
    chromeLocalGetSpy.mockClear();
    chromeLocalSetSpy.mockClear();
    chromeSyncGetSpy.mockClear();
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
    jest.useFakeTimers(); // due to setTimeout
    global.scrollTo = jest.fn();
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
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups }, anything);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(JSON.stringify(groups));

    jest.advanceTimersByTime(51); // setTimeout is 50ms, must advance it to 51ms to see the call
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(0, document.body.scrollHeight);
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
  it("adjusts local storage to a default group only", () => {
    sessionStorage.setItem("settings", JSON.stringify(default_settings));

    var new_entry = { "group-0": default_group };
    new_entry["group-0"].created = AppHelper.getTimestamp();

    jest.clearAllMocks();

    AppFunc.deleteAllGroups(mockSet, mockSet);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledTimes(2);

    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: new_entry }, anything);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

    expect(mockSet).toHaveBeenCalledWith(0);
    expect(mockSet).toHaveBeenCalledWith(JSON.stringify(new_entry));
  });
});

describe("regexSearchForTab", () => {
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
  });

  it("works for group search - NO match", () => {
    fireEvent.change(container.querySelector(".search-filter input"), { target: { value: "#c" } });

    [...document.body.querySelectorAll(".group-item")].forEach((group) => {
      expect(group.style.display).toBe("none");
    });
  });

  it("works for group search - match", () => {
    fireEvent.change(container.querySelector(".search-filter input"), { target: { value: "#a" } });

    const group_displays = [...document.body.querySelectorAll(".group-item")].map((x) => x.style.display);
    expect(group_displays).toStrictEqual(["", "none"]);
  });

  it("works for tab search - NO match", () => {
    fireEvent.change(container.querySelector(".search-filter input"), { target: { value: "c" } });

    [...document.body.querySelectorAll(".draggable")].forEach((tab) => {
      expect(tab.style.display).toBe("none");
    });
  });

  it("works for tab search - match", () => {
    fireEvent.change(container.querySelector(".search-filter input"), { target: { value: "b" } });

    const tab_displays = [...document.body.querySelectorAll(".draggable")].map((x) => x.style.display);
    expect(tab_displays).toStrictEqual(["none", ""]);
  });

  it("does nothing when no value is supplied (after backspace)", () => {
    fireEvent.change(container.querySelector(".search-filter input"), { target: { value: "a" } });
    fireEvent.change(container.querySelector(".search-filter input"), { target: { value: "" } });

    [...document.body.querySelectorAll(".group-item")].forEach((group) => {
      expect(group.style.display).toBe("");
    });
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
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: exportedVal }, anything);

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
