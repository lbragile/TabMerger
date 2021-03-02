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

import { render, waitFor } from "@testing-library/react";
import { toast } from "react-toastify";

import * as AppFunc from "../../src/components/App/App_functions";
import * as AppHelper from "../../src/components/App/App_helpers";
import App from "../../src/components/App/App";

import axios from "axios";

const anything = expect.any(Function);
var new_item = init_groups["group-0"];

var container, sync_node, sync_container, toastSpy;

beforeAll(() => {
  Object.keys(init_groups).forEach((key) => {
    sessionStorage.setItem(key, JSON.stringify(init_groups[key]));
  });

  localStorage.setItem("groups", JSON.stringify(init_groups));

  toastSpy = toast.mockImplementation((...args) => args);
  console.info = jest.fn();
});

beforeEach(() => {
  container = render(<App />).container;
  sync_node = container.querySelector("#sync-text span");
  sync_container = sync_node.parentNode;
});

afterAll(() => {
  toastSpy.mockRestore();
});

describe("getTimestamp", () => {
  it("returns the correct timestamp in format dd/mm/yyyy @ hh:mm:ss", () => {
    const result = AppHelper.getTimestamp("Tue Mar 09 2021 22:07:40 GMT-0800 (Pacific Standard Time)");
    expect(result).toBe("09/03/2021 @ 22:07:40");
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
    const timestamp = "11/11/2011 @ 11:11:11";
    localStorage.setItem("last_sync", timestamp);
    jest.clearAllMocks();

    AppHelper.toggleSyncTimestamp(true, sync_node);

    expect(sync_node.innerText).toBe(timestamp);
    expect(sync_container.classList).not.toContain("alert-danger");
    expect(sync_container.classList).toContain("alert-success");

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("last_sync", anything);
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

describe("getTabTotal", () => {
  it("calculates the number of tabs correctly when not empty", () => {
    const result = AppHelper.getTabTotal(init_groups);
    expect(result).toBe(7);
  });

  it("calculates the number of tabs correctly when empty", () => {
    const result = AppHelper.getTabTotal({});
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
    [null, 0],
  ])("dragging element is tab = %s, y_pos = %i", (tab, y_pos) => {
    const result = AppHelper.getDragAfterElement(container.querySelector(tab ? ".group" : "#tabmerger-container"), y_pos, tab ? "tab" : tab === false ? "group" : null); // prettier-ignore

    const adjustment = top + height / (tab ? 2 : 3);
    if (tab === null || y_pos >= adjustment || y_pos <= Number.NEGATIVE_INFINITY + adjustment) {
      expect(result).toBeNull();
    } else {
      expect(result.classList).toContain(tab ? "draggable" : "group-item");
    }
  });
});

describe("storeDestructiveAction", () => {
  it.each([
    [true, "Free"],
    [false, "Basic"],
    [false, "Standard"],
    [false, "Premium"],
  ])("adjusts the states array - full = %s", (full, tier) => {
    var groups_copy = [init_groups];
    localStorage.setItem("groups_copy", JSON.stringify(groups_copy));
    jest.clearAllMocks();

    groups_copy = AppHelper.storeDestructiveAction(groups_copy, {}, { tier });

    expect(groups_copy).toStrictEqual(full ? [{}] : groups_copy);
  });
});

describe("alarmGenerator", () => {
  it.each([
    [0, 0, true],
    [0, 0, false],
    [1, 1, false],
    [1, 2, false],
  ])(
    "periodInMinutes = %s, alarm period = %s, wasCleared = %s",
    (periodInMinutes, alarm_periodInMinutes, wasCleared, alarm_name = "alarm_name") => {
      var chromeAlarmsGetSpy = jest.spyOn(chrome.alarms, "get").mockImplementation((_, cb) => cb({ periodInMinutes: alarm_periodInMinutes })); // prettier-ignore
      var chromeAlarmsClearSpy = jest.spyOn(chrome.alarms, "clear").mockImplementation((_, cb) => cb(wasCleared));
      var chromeAlarmsCreateSpy = jest.spyOn(chrome.alarms, "create");
      jest.clearAllMocks();

      AppHelper.alarmGenerator(periodInMinutes, alarm_name, [<div>test</div>, { toastId: "test" }]);

      if (periodInMinutes > 0) {
        expect(chromeAlarmsGetSpy).toHaveBeenCalledTimes(1);
        expect(chromeAlarmsGetSpy).toHaveBeenCalledWith(alarm_name, anything);
        if (alarm_periodInMinutes !== periodInMinutes) {
          expect(chromeAlarmsCreateSpy).toHaveBeenCalledTimes(1);
          expect(chromeAlarmsCreateSpy).toHaveBeenCalledWith(alarm_name, expect.any(Object));
        }
      } else {
        expect(chromeAlarmsClearSpy).toHaveBeenCalledTimes(1);
        expect(chromeAlarmsClearSpy).toHaveBeenCalledWith(alarm_name, anything);
        if (wasCleared) {
          expect(toastSpy).toHaveBeenCalledTimes(1);
          expect(toastSpy).toHaveReturnedWith([<div>test</div>, { toastId: "test" }]);
        }
      }

      chromeAlarmsGetSpy.mockRestore();
      chromeAlarmsCreateSpy.mockRestore();
    }
  );
});

describe("checkUserStatus", () => {
  it.each([[true], [false]])("sets the user details if database check passes, response = %s", async (response) => {
    const client_details = { email: "test@emal.com", password: "test_pass" };
    localStorage.setItem("client_details", JSON.stringify(client_details)); // prettier-ignore
    jest.spyOn(axios, "get").mockResolvedValueOnce({ data: response && user });
    jest.clearAllMocks();

    AppHelper.checkUserStatus(mockSet);

    await waitFor(() => {
      expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalGetSpy).toHaveBeenCalledWith("client_details", anything);

      if (response) {
        expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
        expect(chromeLocalSetSpy).toHaveBeenCalledWith({ client_details: { ...client_details, ...user } }, anything);

        expect(mockSet).toHaveBeenCalledTimes(1);
        expect(mockSet).toHaveBeenCalledWith(user);
      }
    });

    expect.hasAssertions();
  });
});

describe("performAutoBackup", () => {
  test("json alarm", () => {
    var exportJSONSpy = jest.spyOn(AppFunc, "exportJSON");
    AppHelper.performAutoBackUp({ name: "json_backup" }, sync_node);

    expect(exportJSONSpy).toHaveBeenCalledTimes(1);
    expect(exportJSONSpy).toHaveBeenCalledWith(false, false);
  });

  test("sync alarm", () => {
    var syncWriteSpy = jest.spyOn(AppFunc, "syncWrite");

    localStorage.setItem("client_details", JSON.stringify(user));
    jest.clearAllMocks();
    AppHelper.performAutoBackUp({ name: "sync_backup" }, sync_node);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("client_details", anything);

    expect(syncWriteSpy).toHaveBeenCalledTimes(1);
    expect(syncWriteSpy).toHaveBeenCalledWith({target: container.querySelector("#sync-write-btn"), autoAction: true}, sync_node, user); // prettier-ignore
  });
});
