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

const anything = expect.anything();
var new_item = init_groups["group-0"];

var container, sync_node, sync_container;
beforeEach(() => {
  container = render(<App />).container;
  sync_node = container.querySelector("#sync-text span");
  sync_container = sync_node.parentNode;
});

beforeAll(() => {
  Object.keys(init_groups).forEach((key) => {
    sessionStorage.setItem(key, JSON.stringify(init_groups[key]));
  });

  localStorage.setItem("groups", JSON.stringify(init_groups));
});

describe("getTimestamp", () => {
  it("returns the correct timestamp in format dd/mm/yyyy @ hh:mm:ss", () => {
    const result = AppHelper.getTimestamp("Tue Feb 09 2021 22:07:40 GMT-0800 (Pacific Standard Time)");
    expect(result).toBe("09/02/2021 @ 22:07:40");
  });

  it("returns something if argument is empty", () => {
    const result = AppHelper.getTimestamp();
    expect(result.length).toBe(21);
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
    var localeCompareSpy = jest.spyOn(String.prototype, "localeCompare");

    var current_key_order = ["group-0", "group-1", "group-3", "group-2"];
    var current_val = Object.values(init_groups);
    expect(Object.keys(init_groups)).toEqual(current_key_order);

    // swap group-2 & group-3
    [current_val[2], current_val[3]] = [current_val[3], current_val[2]];

    jest.clearAllMocks();
    var response = AppHelper.sortByKey(init_groups);

    expect(response).toEqual(current_val);
    expect(localeCompareSpy).toHaveBeenCalledTimes(5);
    expect(localeCompareSpy).toHaveBeenCalledWith(expect.any(String), undefined, { numeric: true, sensitivity: "base" }); // prettier-ignore
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
    var tabs = init_groups["group-0"].tabs;
    var matcher = tabs[0].url;

    var response = AppHelper.findSameTab(tabs, matcher);
    expect(response).toEqual([tabs[0]]);
  });

  it("return empty array if no match is found", () => {
    var tabs = init_groups["group-0"].tabs;
    var matcher = null;

    var response = AppHelper.findSameTab(tabs, matcher);
    expect(response).toEqual([]);
  });
});

describe("outputFileName", () => {
  it("returns output filename with correct format and timestamp", () => {
    var correct_output = `TabMerger [${AppHelper.getTimestamp()}]`;
    expect(AppHelper.outputFileName()).toBe(correct_output);
  });
});

describe("getDragAfterElement", () => {
  const top = 50, height = 60, smaller_num = (top + height) / 2; // prettier-ignore
  var getBoundingClientRectSpy = jest.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({ top, height })); // prettier-ignore

  afterAll(() => {
    getBoundingClientRectSpy.mockRestore();
  });

  it.each([
    [true, smaller_num],
    [true, top + height / 2],
    [true, Number.NEGATIVE_INFINITY],
    [true, Number.NEGATIVE_INFINITY + top + height / 2],
    [false, smaller_num],
    [false, top + height / 3],
    [false, Number.NEGATIVE_INFINITY],
    [false, Number.NEGATIVE_INFINITY + top + height / 3],
  ])("dragging element is tab = %s, y_pos = %s", (tab, y_pos) => {
    const result = AppHelper.getDragAfterElement(container.querySelector(tab ? ".group" : "#tabmerger-container"), y_pos, tab ? "tab" : "group"); // prettier-ignore

    const { top, height } = getBoundingClientRectSpy();
    const adjustment = top + height / (tab ? 2 : 3);
    if (y_pos === adjustment || y_pos === Number.NEGATIVE_INFINITY + adjustment) {
      expect(result).toBeNull();
    } else {
      expect(result).toBeTruthy();
    }
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
