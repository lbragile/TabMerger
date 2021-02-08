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

import { render } from "@testing-library/react";

import * as AppHelper from "../../src/components/App/App_helpers";

import App from "../../src/components/App/App";

var chromeSyncSetSpy, chromeSyncGetSpy, chromeSyncRemoveSpy;
var chromeLocalSetSpy, chromeLocalGetSpy, chromeLocalRemoveSpy;
var mockSet, container, new_item, current_key_order, current_val, response;
var tabs, matcher, sync_node, sync_container, anything;

beforeEach(() => {
  mockSet = jest.fn(); // mock for setState hooks
  anything = expect.anything();

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

describe("getTimestamp", () => {
  it("returns the correct timestamp in format dd/mm/yyyy @ hh:mm:ss", () => {
    const result = AppHelper.getTimestamp(["11", "12", "2021", "11:11:11"]);
    expect(result).toBe("12/11/2021 @ 11:11:11");
  });
});

describe("toggleDarkMode", () => {
  var body, sidebar;

  beforeEach(() => {
    body = container.querySelector(".container-fluid").closest("body");
    sidebar = container.querySelector("#sidebar");
  });

  test("light mode", () => {
    AppHelper.toggleDarkMode(false);

    expect(body.style.background).toEqual("white");
    expect(body.style.color).toEqual("black");
    expect(sidebar.style.background).toEqual("rgb(120, 120, 120)");
  });

  test("dark mode", () => {
    AppHelper.toggleDarkMode(true);

    expect(body.style.background).toEqual("rgb(52, 58, 64)");
    expect(body.style.color).toEqual("white");
    expect(sidebar.style.background).toEqual("rgb(27, 27, 27)");
  });
});

describe("toggleSyncTimestampHelper", () => {
  it("turns green and has right timestamp when sync is on", () => {
    const timestamp1 = AppHelper.getTimestamp();
    AppHelper.toggleSyncTimestamp(true, sync_node);
    const timestamp2 = AppHelper.getTimestamp();

    expect([timestamp1, timestamp2]).toContain(sync_node.innerText);
    expect(sync_container.classList).not.toContain("alert-danger");
    expect(sync_container.classList).toContain("alert-success");
  });

  it("turns red and has no timestamp when sync is off", () => {
    AppHelper.toggleSyncTimestamp(false, sync_node);

    expect(sync_node.innerText).toBe("--/--/---- @ --:--:--");
    expect(sync_container.classList).toContain("alert-danger");
    expect(sync_container.classList).not.toContain("alert-success");
  });
});

describe("updateGroupItem", () => {
  it("updates the sync storage when an item changed", async () => {
    jest.clearAllMocks();
    new_item.color = "#fff";

    await AppHelper.updateGroupItem("group-0", new_item);

    expect(JSON.parse(sessionStorage.getItem("group-0"))).toEqual(new_item);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("group-0", anything);

    expect(chromeSyncSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncSetSpy).toHaveBeenCalledWith({ "group-0": new_item }, anything);
  });

  it("does not update sync storage for the same input item value", async () => {
    jest.clearAllMocks();

    await AppHelper.updateGroupItem("group-0", new_item);

    expect(JSON.parse(sessionStorage.getItem("group-0"))).toEqual(new_item);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("group-0", anything);

    expect(chromeSyncSetSpy).not.toHaveBeenCalled();
  });
});

describe("sortByKey", () => {
  it("returns the input json's values, but sorted by key indicies", () => {
    current_key_order = ["group-0", "group-1", "group-10", "group-9"];
    current_val = Object.values(init_groups);
    expect(Object.keys(init_groups)).toEqual(current_key_order);

    response = AppHelper.sortByKey(init_groups);

    // swap group-9 & group-10
    [current_val[2], current_val[3]] = [current_val[3], current_val[2]];
    expect(response).toEqual(current_val);
  });
});

describe("updateTabTotal", () => {
  it("calculates the number of tabs correctly when not empty", () => {
    const result = AppHelper.updateTabTotal(init_groups);
    expect(result).toBe(7);
  });

  it("calculates the number of tabs correctly when empty", () => {
    const result = AppHelper.updateTabTotal({});
    expect(result).toBe(0);
  });
});

describe("findSameTab", () => {
  it("returns correct tab when match is found", () => {
    tabs = init_groups["group-0"].tabs;
    matcher = tabs[0].url;

    response = AppHelper.findSameTab(tabs, matcher);
    expect(response).toEqual([tabs[0]]);
  });

  it("return empty array if no match is found", () => {
    tabs = init_groups["group-0"].tabs;
    matcher = null;

    response = AppHelper.findSameTab(tabs, matcher);
    expect(response).toEqual([]);
  });
});

describe("outputFileName", () => {
  it("returns output filename with correct format and timestamp", () => {
    var correct_output = `TabMerger [${AppHelper.getTimestamp()}]`;
    expect(AppHelper.outputFileName()).toBe(correct_output);
  });
});

describe("storeDestructiveAction", () => {
  it.each([[true], [false]])("adjusts the states array - full = %s", (full) => {
    localStorage.setItem("groups_copy", JSON.stringify([init_groups]));
    jest.clearAllMocks();

    const groups_copy = AppHelper.storeDestructiveAction([init_groups], {}, full ? 1 : undefined);

    expect(groups_copy).toStrictEqual(full ? [{}] : [init_groups, {}]);
  });
});
