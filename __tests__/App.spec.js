import React from "react";
window.React = React;

import { render, waitFor } from "@testing-library/react";

import * as AppFunc from "../src/App/App_functions";

// prettier-ignore
import { init_groups, default_settings, default_group } from "../__mocks__/variableMocks";

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
  jest.clearAllMocks();
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
    [...links].forEach((x) => {
      expect(x.style.color).toEqual("black");
    });
  });

  test("dark mode", () => {
    AppFunc.toggleDarkMode(true);
    expect(body.style.background).toEqual("rgb(52, 58, 64)");
    expect(body.style.color).toEqual("white");
    expect(hr.style.borderTop).toEqual("1px solid white");
    [...links].forEach((x) => {
      expect(x.style.color).toEqual("white");
    });
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

    // prettier-ignore
    expect(JSON.parse(sessionStorage.getItem("group-0"))).toStrictEqual(new_item);
    // prettier-ignore
    expect(chromeSyncSetSpy).toHaveBeenCalledWith({ "group-0": new_item }, expect.anything());
    expect(chromeSyncSetSpy).toHaveBeenCalledTimes(1);
  });

  it("does not update sync storage for the same input item value", async () => {
    expect(sessionStorage.getItem("group-0")).toBeTruthy();
    chromeSyncSetSpy.mockClear(); // settings is using set also

    await AppFunc.updateGroupItem("group-0", new_item);

    // prettier-ignore
    expect(JSON.parse(sessionStorage.getItem("group-0"))).toStrictEqual(new_item);
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

describe("findSameTab", () => {
  it("returns correct tab when match is found", () => {
    tabs = init_groups["group-0"].tabs;
    matcher = tabs[0].url;

    response = AppFunc.findSameTab(tabs, matcher);
    expect(response).toStrictEqual([tabs[0]]);
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

// describe("storageInit", () => {});

describe("updateSync", () => {
  beforeEach(() => {
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

// describe("loadSyncedData", () => {
//   beforeEach(() => {
//     jest.clearAllMocks();
//   });

//   it("does nothing when no groups in sync storage", () => {
//     sessionStorage.clear();
//     AppFunc.loadSyncedData(sync_node, mockSet, mockSet);
//     expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
//   });

//   it("calls the correct functions", () => {
//     delete init_groups["group-9"];
//     sessionStorage.setItem("groups", JSON.stringify(init_groups));

//     AppFunc.loadSyncedData(sync_node, mockSet, mockSet);

//     expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
//     expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
//     // prettier-ignore
//     // expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: init_groups }, expect.anything());
//   });
// });

describe("translate", () => {
  it("returns a translation if avaiable", () => {
    expect(AppFunc.translate("Title")).toEqual("титул");
  });

  it("returns original msg if translation is not avaialbe", () => {
    expect(AppFunc.translate("random")).toEqual("random");
  });
});
