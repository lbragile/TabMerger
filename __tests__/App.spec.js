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
TabMerger team at <https://tabmerger.herokuapp.com/contact/>
*/

import React from "react";
window.React = React;

import { render, waitFor, fireEvent } from "@testing-library/react";

import * as AppFunc from "../src/App/App_functions";

import App from "../src/App/App";

// variables used in these tests
var chromeSyncSetSpy, chromeSyncGetSpy, chromeSyncRemoveSpy;
// prettier-ignore
var chromeLocalSetSpy, chromeLocalGetSpy, chromeLocalRemoveSpy;

var mockSet, container, new_item, current_key_order, current_val, response;
var body, hr, links, tabs, matcher, sync_node, sync_container;

beforeEach(() => {
  mockSet = jest.fn(); // mock for setState hooks

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

describe("going to settings menu", () => {
  it("navigates to the correct url", () => {
    // store current window
    const oldWindowLocation = window.location;
    delete window.location;

    // mock reload function
    window.location = Object.defineProperties(
      {},
      {
        ...Object.getOwnPropertyDescriptors(oldWindowLocation),
        assign: {
          configurable: true,
          value: jest.fn(),
        },
      }
    );

    fireEvent.click(container.querySelector("#options-btn"));
    expect(window.location.assign).toHaveBeenCalledTimes(1);
    // prettier-ignore
    expect(window.location.assign).toHaveBeenCalledWith("/settings/settings.html");

    // restore window
    window.location = oldWindowLocation;
  });
});

describe("toggleDarkMode", () => {
  beforeEach(() => {
    body = container.querySelector(".container-fluid").closest("body");
    hr = container.querySelector("hr");
    links = container.getElementsByClassName("link");
  });

  test("light mode", () => {
    AppFunc.toggleDarkMode(false);
    expect(body.style.background).toEqual("white");
    expect(body.style.color).toEqual("black");
    expect(hr.style.borderTop).toEqual("1px solid rgba(0,0,0,.1)");
  });

  test("dark mode", () => {
    AppFunc.toggleDarkMode(true);
    expect(body.style.background).toEqual("rgb(52, 58, 64)");
    expect(body.style.color).toEqual("white");
    expect(hr.style.borderTop).toEqual("1px solid white");
  });
});

describe("updateGroupItem", () => {
  afterEach(() => {
    chromeSyncSetSpy.mockClear();
  });

  it("updates the sync storage when an item changed", async () => {
    new_item.color = "#fff";

    expect(sessionStorage.getItem("group-0")).toBeTruthy();
    chromeSyncSetSpy.mockClear(); // settings is using set also

    await AppFunc.updateGroupItem("group-0", new_item);

    expect(JSON.parse(sessionStorage.getItem("group-0"))).toEqual(new_item);
    // prettier-ignore
    expect(chromeSyncSetSpy).toHaveBeenCalledWith({ "group-0": new_item }, expect.anything());
    expect(chromeSyncSetSpy).toHaveBeenCalledTimes(1);
  });

  it("does not update sync storage for the same input item value", async () => {
    expect(sessionStorage.getItem("group-0")).toBeTruthy();
    chromeSyncSetSpy.mockClear(); // settings is using set also

    await AppFunc.updateGroupItem("group-0", new_item);

    // prettier-ignore
    expect(JSON.parse(sessionStorage.getItem("group-0"))).toEqual(new_item);
    expect(chromeSyncSetSpy).not.toHaveBeenCalled();
  });
});

describe("sortByKey", () => {
  it("returns the input json's values, but sorted by key indicies", () => {
    current_key_order = ["group-0", "group-1", "group-10", "group-9"];
    current_val = Object.values(init_groups);
    expect(Object.keys(init_groups)).toEqual(current_key_order);

    response = AppFunc.sortByKey(init_groups);

    // swap group-9 & group-10
    [current_val[2], current_val[3]] = [current_val[3], current_val[2]];
    expect(response).toEqual(current_val);
  });
});

describe("updateTabTotal", () => {
  it("calculates the number of tabs correctly when not empty", () => {
    mockSet.mockClear();
    AppFunc.updateTabTotal(init_groups, mockSet);
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(7);
  });

  it("calculates the number of tabs correctly when empty", () => {
    mockSet.mockClear();
    AppFunc.updateTabTotal({}, mockSet);
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(0);
  });
});

describe("findSameTab", () => {
  it("returns correct tab when match is found", () => {
    tabs = init_groups["group-0"].tabs;
    matcher = tabs[0].url;

    response = AppFunc.findSameTab(tabs, matcher);
    expect(response).toEqual([tabs[0]]);
  });

  it("return empty array if no match is found", () => {
    tabs = init_groups["group-0"].tabs;
    matcher = null;

    response = AppFunc.findSameTab(tabs, matcher);
    expect(response).toEqual([]);
  });
});

describe("outputFileName", () => {
  it("returns output filename with correct format and timestamp", () => {
    var correct_output = `TabMerger [${AppFunc.getTimestamp()}]`;
    expect(AppFunc.outputFileName()).toBe(correct_output);
  });
});

describe("toggleSyncTimestampHelper", () => {
  it("turns green and has right timestamp when sync is on", () => {
    AppFunc.toggleSyncTimestampHelper(true, sync_node);
    expect(sync_node.innerText).toBe(AppFunc.getTimestamp());
    expect(sync_container.classList).not.toContain("alert-danger");
    expect(sync_container.classList).toContain("alert-success");
  });

  it("turns red and has no timestamp when sync is off", () => {
    AppFunc.toggleSyncTimestampHelper(false, sync_node);
    expect(sync_node.innerText).toBe("--/--/---- @ --:--:--");
    expect(sync_container.classList).toContain("alert-danger");
    expect(sync_container.classList).not.toContain("alert-success");
  });
});

describe("storageInit", () => {
  const any = expect.anything();

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
    // prettier-ignore
    AppFunc.storageInit(default_settings, default_group, sync_node, mockSet, mockSet);
    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith(null, any);

    expect(chromeSyncSetSpy).toHaveBeenCalledTimes(1);
    // prettier-ignore
    expect(chromeSyncSetSpy).toHaveBeenCalledWith({settings: default_settings}, any);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", any);

    expect(chromeLocalRemoveSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalRemoveSpy).toHaveBeenCalledWith(["groups"], any);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    //prettier-ignore
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({groups: {"group-0": default_group}}, any);

    expect(mockSet).toHaveBeenCalledTimes(2);
  });

  test("sync settings exist & sync group-0 is null", () => {
    sessionStorage.setItem("settings", 1);
    chromeSyncSetSpy.mockClear();

    // prettier-ignore
    AppFunc.storageInit(default_settings, default_group, sync_node, mockSet, mockSet);
    expect(chromeSyncSetSpy).not.toHaveBeenCalled();
  });

  test("sync group-0 exists & local groups exist", () => {
    sessionStorage.setItem("group-0", 1);
    localStorage.setItem("groups", JSON.stringify(init_groups));

    // prettier-ignore
    AppFunc.storageInit(default_settings, default_group, sync_node, mockSet, mockSet);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    // prettier-ignore
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: init_groups }, expect.anything());
    expect(mockSet).toHaveBeenCalledTimes(2);
  });
});

describe("updateSync", () => {
  beforeEach(() => {
    fireEvent.click(container.querySelector("#sync-write-btn")); // test coverage

    localStorage.clear();
    chromeSyncSetSpy.mockClear();
  });

  it("does nothing when no groups in local storage", () => {
    AppFunc.updateSync(sync_node);
    expect(chromeSyncSetSpy).not.toHaveBeenCalled();
  });

  it("does nothing when no tabs in TabMerger and only default group is made", () => {
    // prettier-ignore
    localStorage.setItem("groups", JSON.stringify({"group-0": default_group}))

    AppFunc.updateSync(sync_node);
    expect(chromeSyncSetSpy).not.toHaveBeenCalled();
  });

  it("calls the correct functions when less groups", async () => {
    // to simulate having to remove extras, since less groups now
    // prettier-ignore
    localStorage.setItem("groups", JSON.stringify({ "group-0": init_groups["group-0"] }));

    AppFunc.updateSync(sync_node);

    await waitFor(() => {
      expect(chromeSyncGetSpy).toHaveBeenCalled();
      expect(chromeSyncGetSpy).toHaveBeenCalledWith(null, expect.anything());
      expect(chromeSyncSetSpy).not.toHaveBeenCalled();
      expect(chromeSyncRemoveSpy).toHaveBeenCalledTimes(1);
      // prettier-ignore
      expect(chromeSyncRemoveSpy).toHaveBeenCalledWith(Object.keys(init_groups).splice(1), expect.anything());
    });

    expect.hasAssertions();
  });

  it("calls the correct functions when more groups", async () => {
    init_groups["group-11"] = default_group;
    localStorage.setItem("groups", JSON.stringify(init_groups));

    AppFunc.updateSync(sync_node);

    await waitFor(() => {
      expect(chromeSyncGetSpy).toHaveBeenCalled();
      expect(chromeSyncGetSpy).toHaveBeenCalledWith(null, expect.anything());
      expect(chromeSyncSetSpy).toHaveBeenCalled();
      expect(chromeSyncRemoveSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncRemoveSpy).toHaveBeenCalledWith([], expect.anything());
    });

    expect.hasAssertions();
  });
});

describe("loadSyncedData", () => {
  it("does nothing when no groups in sync storage", () => {
    fireEvent.click(container.querySelector("#sync-read-btn")); // test coverage

    sessionStorage.clear();
    chromeSyncGetSpy.mockClear();
    AppFunc.loadSyncedData(sync_node, mockSet, mockSet);
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

    AppFunc.loadSyncedData(sync_node, mockSet, mockSet);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncRemoveSpy).toHaveBeenCalledTimes(1);
    // prettier-ignore
    expect(chromeSyncRemoveSpy).toHaveBeenCalledWith(["group-0", "group-1"], expect.anything());

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalRemoveSpy).toHaveBeenCalledTimes(1);

    // prettier-ignore
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: new_ss_item }, expect.anything());
    // prettier-ignore
    expect(chromeLocalRemoveSpy).toHaveBeenCalledWith(["groups"], expect.anything());
  });
});

// IN PROGRESS
describe("openOrRemoveTabsHelper", () => {
  beforeEach(() => {
    chromeSyncGetSpy.mockClear();
    chromeLocalGetSpy.mockClear();
    chromeLocalSetSpy.mockClear();
  });

  it("does nothing when namespace is not 'local'", () => {
    // prettier-ignore
    AppFunc.openOrRemoveTabsHelper({ remove: { newValue: ["a"] } }, "sync", mockSet, mockSet);
  });

  it("opens the correct tabs and removes them from TabMerger if needed", () => {
    // prettier-ignore
    AppFunc.openOrRemoveTabsHelper({ remove: { newValue: ["a"] } }, "local", mockSet, mockSet);
    // expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    // expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    // expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);

    // // prettier-ignore
    // expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", expect.anything());
  });
});

describe("openAllTabs", () => {
  it("sets the local storage item correctly", () => {
    // document.querySelectorAll must be stubbed or else it is not read
    document.body.innerHTML =
      '<div><a class="a-tab" href="www.abc.com"></a></div>';

    var expected_ls = { remove: ["all", location.href + "www.abc.com"] };
    chromeLocalSetSpy.mockClear();
    localStorage.setItem("groups", JSON.stringify(init_groups));
    fireEvent.click(container.querySelector("#open-all-btn"));
    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);

    // prettier-ignore
    expect(chromeLocalSetSpy).toHaveBeenCalledWith(expected_ls, expect.anything());
  });
});

describe("addGroup", () => {
  beforeEach(() => {
    fireEvent.click(container.querySelector("#add-group-btn")); // test coverage

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
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", expect.anything());

    expect(chromeSyncGetSpy).not.toHaveBeenCalled();
    expect(chromeLocalSetSpy).not.toHaveBeenCalled();
  });

  it("adjusts the groups if limit is not exceeded", () => {
    delete init_groups["group-11"];
    localStorage.setItem("groups", JSON.stringify(init_groups));

    var groups = init_groups;
    default_group.created = AppFunc.getTimestamp();
    groups["group-4"] = default_group;

    AppFunc.addGroup(100, mockSet);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    // prettier-ignore
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", expect.anything());

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    // prettier-ignore
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups }, expect.anything());

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(JSON.stringify(groups));
  });
});

describe("deleteAllGroups", () => {
  it("adjusts local storage to a default group only", () => {
    fireEvent.click(container.querySelector("#delete-all-btn")); // for coverage

    sessionStorage.setItem("settings", JSON.stringify(default_settings));

    var new_entry = {
      "group-0": {
        color: "#dedede",
        created: AppFunc.getTimestamp(),
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

    // prettier-ignore
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({groups: new_entry}, expect.anything());
    // prettier-ignore
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", expect.anything());

    expect(mockSet).toHaveBeenCalledWith(0);
    expect(mockSet).toHaveBeenCalledWith(JSON.stringify(new_entry));
  });
});

// IN PROGRESS
describe("filterRegEx", () => {
  it("works for group search", () => {
    document.body.innerHTML =
      '<div class="group-item"><input>aaaaa</input><p>aaaaa</p></div>' +
      '<div class="group-item"><input>bbbbb</input><p>bbbbb</p></div>';

    // prettier-ignore
    fireEvent.change(container.querySelector(".search-filter input"), { target: { value: "#a" } })
  });

  it("works for tab search", () => {
    document.body.innerHTML =
      '<div class="group-item"><input>aaaaa</input><div class="draggable"><p>a</p><a href="a">aaaaa</a></div></div>' +
      '<div class="group-item"><input>bbbbb</input><div class="draggable"><p>b</p><a href="b">bbbbb</a></div></div>';

    // prettier-ignore
    fireEvent.change(container.querySelector(".search-filter input"), { target: { value: "a" } });
  });

  it("does nothing when no value is supplied (after backspace)", () => {
    // need a change to happen
    // prettier-ignore
    fireEvent.change(container.querySelector(".search-filter input"), { target: { value: "a" } });

    // prettier-ignore
    fireEvent.change(container.querySelector(".search-filter input"), { target: { value: "" } });
  });
});

describe("readImportedFile", () => {
  it("alerts on wrong non json inupt", () => {
    global.alert = jest.fn();

    const input = {
      target: {
        files: [{ type: "application/pdf" }],
      },
    };

    fireEvent.change(container.querySelector("#import-input"), input);

    expect(alert).toHaveBeenCalledTimes(1);

    // prettier-ignore
    expect(alert.mock.calls.pop()[0]).toContain("You must import a JSON file (.json extension)!");
  });

  // it("updates sync and local storage on json input (valid)", () => {});
});

describe("exportJSON", () => {
  it("correctly exports a JSON file of the current configuration", () => {
    chromeLocalGetSpy.mockClear();
    chromeSyncGetSpy.mockClear();

    const any = expect.anything();
    fireEvent.click(container.querySelector("#export-btn"));

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
