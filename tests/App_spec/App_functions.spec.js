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

import { render, waitFor, fireEvent } from "@testing-library/react";

import * as AppFunc from "../../src/components/App/App_functions";
import * as AppHelper from "../../src/components/App/App_helpers";

import App from "../../src/components/App/App";

var chromeSyncSetSpy, chromeSyncGetSpy, chromeSyncRemoveSpy;
var chromeLocalSetSpy, chromeLocalGetSpy, chromeLocalRemoveSpy;
var mockSet, container, new_item, sync_node, sync_container, any;

beforeEach(() => {
  mockSet = jest.fn(); // mock for setState hooks
  any = expect.anything();

  container = render(<App />).container;
  sync_node = container.querySelector("#sync-text span");
  sync_container = sync_node.parentNode;

  new_item = init_groups["group-0"];
  Object.keys(init_groups).forEach((key) => {
    sessionStorage.setItem(key, JSON.stringify(init_groups[key]));
    localStorage.setItem(key, JSON.stringify(init_groups[key]));
  });

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
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();

    chromeSyncGetSpy.mockClear();
    chromeSyncSetSpy.mockClear();
    chromeLocalGetSpy.mockClear();
    chromeLocalSetSpy.mockClear();
    chromeLocalRemoveSpy.mockClear();
  });

  test("sync settings are null & local groups are null", () => {
    AppFunc.storageInit(default_settings, default_group, sync_node, mockSet, mockSet);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith(null, any);

    expect(chromeSyncSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncSetSpy).toHaveBeenCalledWith({ settings: default_settings }, any);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", any);

    expect(chromeLocalRemoveSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalRemoveSpy).toHaveBeenCalledWith(["groups"], any);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: { "group-0": default_group } }, any);

    expect(mockSet).toHaveBeenCalledTimes(2);
  });

  test("sync settings exist & sync group-0 is null", () => {
    sessionStorage.setItem("settings", 1);
    chromeSyncSetSpy.mockClear();

    AppFunc.storageInit(default_settings, default_group, sync_node, mockSet, mockSet);

    expect(chromeSyncSetSpy).not.toHaveBeenCalled();
  });

  test("sync group-0 exists & local groups exist", () => {
    sessionStorage.setItem("group-0", 1);
    localStorage.setItem("groups", JSON.stringify(init_groups));

    AppFunc.storageInit(default_settings, default_group, sync_node, mockSet, mockSet);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: init_groups }, any);
    expect(mockSet).toHaveBeenCalledTimes(2);
  });
});

describe("syncWrite", () => {
  beforeEach(() => {
    localStorage.clear();
    chromeSyncSetSpy.mockClear();
  });

  it("does nothing when no groups in local storage", () => {
    AppFunc.syncWrite(sync_node);

    expect(chromeSyncSetSpy).not.toHaveBeenCalled();
  });

  it("does nothing when no tabs in TabMerger and only default group is made", () => {
    localStorage.setItem("groups", JSON.stringify({ "group-0": default_group }));

    AppFunc.syncWrite(sync_node);

    expect(chromeSyncSetSpy).not.toHaveBeenCalled();
  });

  it("calls the correct functions when less groups", async () => {
    // to simulate having to remove extras, since less groups now
    localStorage.setItem("groups", JSON.stringify({ "group-0": init_groups["group-0"] }));

    AppFunc.syncWrite(sync_node);

    await waitFor(() => {
      expect(chromeSyncGetSpy).toHaveBeenCalled();
      expect(chromeSyncGetSpy).toHaveBeenCalledWith(null, any);
      expect(chromeSyncSetSpy).not.toHaveBeenCalled();
      expect(chromeSyncRemoveSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncRemoveSpy).toHaveBeenCalledWith(Object.keys(init_groups).splice(1), any);
    });

    expect.hasAssertions();
  });

  it("calls the correct functions when more groups", async () => {
    init_groups["group-11"] = default_group;
    localStorage.setItem("groups", JSON.stringify(init_groups));

    AppFunc.syncWrite(sync_node);

    await waitFor(() => {
      expect(chromeSyncGetSpy).toHaveBeenCalled();
      expect(chromeSyncGetSpy).toHaveBeenCalledWith(null, any);
      expect(chromeSyncSetSpy).toHaveBeenCalled();
      expect(chromeSyncRemoveSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncRemoveSpy).toHaveBeenCalledWith([], any);
    });

    expect.hasAssertions();
  });
});

describe("syncRead", () => {
  it("does nothing when no groups in sync storage", () => {
    sessionStorage.clear();
    chromeSyncGetSpy.mockClear();
    AppFunc.syncRead(sync_node, mockSet, mockSet);
    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
  });

  it("calls the correct functions", () => {
    jest.clearAllMocks();
    sessionStorage.clear();

    const new_ss_item = {
      "group-0": init_groups["group-0"],
      "group-1": init_groups["group-1"],
    };

    sessionStorage.setItem("group-0", JSON.stringify(new_ss_item["group-0"]));
    sessionStorage.setItem("group-1", JSON.stringify(new_ss_item["group-1"]));

    AppFunc.syncRead(sync_node, mockSet, mockSet);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncRemoveSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncRemoveSpy).toHaveBeenCalledWith(["group-0", "group-1"], any);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalRemoveSpy).toHaveBeenCalledTimes(1);

    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: new_ss_item }, any);
    expect(chromeLocalRemoveSpy).toHaveBeenCalledWith(["groups"], any);
  });
});

// IN PROGRESS
describe("openOrRemoveTabs", () => {
  beforeEach(() => {
    chromeSyncGetSpy.mockClear();
    chromeLocalGetSpy.mockClear();
    chromeLocalSetSpy.mockClear();
  });

  it("does nothing when namespace is not 'local'", () => {
    AppFunc.openOrRemoveTabs({ remove: { newValue: ["a"] } }, "sync", mockSet, mockSet);
  });

  it("opens the correct tabs and removes them from TabMerger if needed", () => {
    AppFunc.openOrRemoveTabs({ remove: { newValue: ["a"] } }, "local", mockSet, mockSet);
    // expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    // expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    // expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);

    // expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", expect.anything());
  });
});

describe("openAllTabs", () => {
  it("sets the local storage item correctly", () => {
    // document.querySelectorAll must be stubbed or else it is not read
    document.body.innerHTML = '<div><a class="a-tab" href="www.abc.com"></a></div>';
    var expected_ls = { remove: ["all", location.href + "www.abc.com"] };

    chromeLocalSetSpy.mockClear();
    localStorage.setItem("groups", JSON.stringify(init_groups));

    AppFunc.openAllTabs();

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith(expected_ls, any);
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
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", any);

    expect(chromeSyncGetSpy).not.toHaveBeenCalled();
    expect(chromeLocalSetSpy).not.toHaveBeenCalled();
  });

  it("adjusts the groups if limit is not exceeded", () => {
    delete init_groups["group-11"];
    localStorage.setItem("groups", JSON.stringify(init_groups));

    var groups = init_groups;
    default_group.created = AppHelper.getTimestamp();
    groups["group-4"] = default_group;

    AppFunc.addGroup(100, mockSet);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", any);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups }, any);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(JSON.stringify(groups));
  });
});

describe("deleteAllGroups", () => {
  it("adjusts local storage to a default group only", () => {
    sessionStorage.setItem("settings", JSON.stringify(default_settings));

    var new_entry = {
      "group-0": {
        color: "#dedede",
        created: AppHelper.getTimestamp(),
        tabs: [],
        title: "Title",
      },
    };

    chromeSyncGetSpy.mockClear();
    chromeLocalSetSpy.mockClear();
    mockSet.mockClear();

    AppFunc.deleteAllGroups(mockSet, mockSet);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledTimes(2);

    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: new_entry }, any);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", any);

    expect(mockSet).toHaveBeenCalledWith(0);
    expect(mockSet).toHaveBeenCalledWith(JSON.stringify(new_entry));
  });
});

// IN PROGRESS
describe("regexSearchForTab", () => {
  it("works for group search", () => {
    document.body.innerHTML =
      '<div class="group-item"><input class="title-edit-input">aaaaa</input><p>aaaaa</p></div>' +
      '<div class="group-item"><input class="title-edit-input">bbbbb</input><p>bbbbb</p></div>';

    fireEvent.change(container.querySelector(".search-filter input"), { target: { value: "#a" } });
  });

  it("works for tab search", () => {
    document.body.innerHTML =
      '<div class="group-item"><input class="title-edit-input">aaaaa</input><div class="draggable"><p>a</p><a href="a">aaaaa</a></div></div>' +
      '<div class="group-item"><input class="title-edit-input">bbbbb</input><div class="draggable"><p>b</p><a href="b">bbbbb</a></div></div>';

    fireEvent.change(container.querySelector(".search-filter input"), { target: { value: "a" } });
  });

  it("does nothing when no value is supplied (after backspace)", () => {
    // need a change to happen
    fireEvent.change(container.querySelector(".search-filter input"), { target: { value: "a" } });

    fireEvent.change(container.querySelector(".search-filter input"), { target: { value: "" } });
  });
});

describe("importJSON", () => {
  it("alerts on wrong non json inupt", () => {
    global.alert = jest.fn();

    const input = {
      target: {
        files: [{ type: "application/pdf" }],
      },
    };

    fireEvent.change(container.querySelector("#import-input"), input);

    expect(alert).toHaveBeenCalledTimes(1);

    expect(alert.mock.calls.pop()[0]).toContain("You must import a JSON file (.json extension)!");
  });

  // it("updates sync and local storage on json input (valid)", () => {});
});

describe("exportJSON", () => {
  it("correctly exports a JSON file of the current configuration", () => {
    chromeLocalGetSpy.mockClear();
    chromeSyncGetSpy.mockClear();

    AppFunc.exportJSON();

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", any);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", any);
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
