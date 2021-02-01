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

import { fireEvent, render } from "@testing-library/react";

import * as GroupFunc from "../../src/components/Group/Group_functions";
import Group from "../../src/components/Group/Group";

import * as AppHelper from "../../src/components/App/App_helpers";
import { AppProvider } from "../../src/context/AppContext";

var mockSet, container, anything;
var chromeLocalSetSpy, chromeLocalGetSpy, chromeSyncGetSpy;

beforeAll(() => {
  global.alert = jest.fn();
});

beforeEach(() => {
  Object.keys(init_groups).forEach((key) => {
    sessionStorage.setItem(key, JSON.stringify(init_groups[key]));
  });
  localStorage.setItem("groups", JSON.stringify(init_groups));

  mockSet = jest.fn();
  anything = expect.anything();

  container = render(
    <AppProvider value={{ setTabTotal: mockSet, setGroups: mockSet }}>
      <Group
        id="group-0"
        title="GROUP A"
        color="#dedede"
        created="11/11/2020 @ 11:11:11"
        num_tabs={0}
        key={Math.random()}
      >
        <a className="a-tab" />
      </Group>
      <Group
        id="group-1"
        title="GROUP B"
        color="#c7eeff"
        created="22/22/2020 @ 22:22:22"
        num_tabs={0}
        key={Math.random()}
      >
        <a className="a-tab" />
      </Group>
    </AppProvider>
  ).container;

  chromeSyncGetSpy = jest.spyOn(chrome.storage.sync, "get");
  chromeLocalSetSpy = jest.spyOn(chrome.storage.local, "set");
  chromeLocalGetSpy = jest.spyOn(chrome.storage.local, "get");
});

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  jest.clearAllMocks();
});

afterAll(() => {
  alert.mockRestore();
});

describe("setBGColor", () => {
  var spy = jest.spyOn(GroupFunc, "setBGColor");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("opens color input on click", () => {
    fireEvent.click(container.querySelector(".input-color"));

    expect(spy).not.toHaveBeenCalled();
  });

  it("opens colorpicker on change and stores the next value appropriately", () => {
    init_groups["group-0"].color = "#000000";

    fireEvent.change(container.querySelector("input[type='color']"), { target: { value: "#000" } });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: init_groups }, anything);
  });
});

describe("updateTextColor", () => {
  it("updates local storage correctly", () => {
    localStorage.setItem("groups", JSON.stringify(init_groups));
    jest.clearAllMocks();

    GroupFunc.updateTextColor(mockSet);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ scroll: 0 }, anything);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(JSON.stringify(init_groups));
  });
});

describe("setTitle", () => {
  it("updates local storage", () => {
    localStorage.setItem("groups", JSON.stringify(init_groups));
    jest.clearAllMocks();

    var target_mock = {
      target: {
        closest: jest.fn(() => {
          return { nextSibling: { id: "group-0" } };
        }),
        nextSibling: { style: { visibility: "" } },
        value: "Chess",
      },
    };

    GroupFunc.setTitle(target_mock, mockSet);
    init_groups["group-0"].title = target_mock.target.value;

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: init_groups, scroll: 0 }, anything);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(JSON.stringify(init_groups));
  });
});

describe("addTabFromURL", () => {
  it.each([
    ["NOT", "https://www.google.com"],
    ["", "https://stackoverflow.com/"],
  ])("adds the tab to the correct group when URL does %s exist", (type, url) => {
    var stub = { target: { value: url, closest: jest.fn(() => ({ id: "group-0" })), blur: jest.fn() } };
    var chromeTabsQuerySpy = jest.spyOn(chrome.tabs, "query").mockImplementation((_, cb) => cb(init_groups[stub.target.closest().id].tabs)); // prettier-ignore

    sessionStorage.setItem("settings", JSON.stringify(default_settings));
    sessionStorage.setItem("open_tabs", JSON.stringify([]));

    localStorage.setItem("groups", JSON.stringify(init_groups));
    global.alert = jest.fn();
    jest.clearAllMocks();

    jest.useFakeTimers();
    GroupFunc.addTabFromURL(stub, mockSet, mockSet);
    jest.advanceTimersByTime(51);

    if (type === "") {
      expect(stub.target.value).toBe("");
      expect(stub.target.blur).toHaveBeenCalledTimes(1);

      expect(alert).toHaveBeenCalledTimes(1);
      expect(alert.mock.calls.pop()[0]).toContain("That tab is already in TabMerger!");
    } else {
      expect(chromeTabsQuerySpy).toHaveBeenCalledTimes(1);
      expect(chromeTabsQuerySpy).toHaveBeenCalledWith({ status: "complete" }, anything);
    }

    chromeTabsQuerySpy.mockRestore();
  });

  test.todo("ensure the above works for separate windows");
  test.todo("above works with open_tabs not empty");
});

describe("groupDragStart", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div class="group-item"></div>`;
  });
  it.each([[true], [false]])("adds class to correct element - tab dragging === %s", (val) => {
    var stub = (ret_val) => ({
      target: { closest: jest.fn((type) => (type === ".draggable" ? ret_val : document.querySelector(".group-item"))) },
    });

    GroupFunc.groupDragStart(stub(val));

    expect(document.querySelector(".group-item").classList.value).toBe("group-item" + (val ? "" : " dragging-group"));
  });
});

// describe.skip("groupDragEnd", () => {});

describe("openGroup", () => {
  it("forms an array that matches ['group-id', ..., tab_links, ...]", () => {
    chromeLocalSetSpy.mockClear();

    var stub = {
      target: {
        closest: jest.fn(() => {
          return {
            nextSibling: {
              querySelectorAll: jest.fn(() => {
                return [{ href: "aaa" }, { href: "bbb" }];
              }),
              id: "group-0",
            },
          };
        }),
      },
    };

    GroupFunc.openGroup(stub);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ remove: ["group-0", "aaa", "bbb"] }, anything);
  });
});

describe("deleteGroup", () => {
  var mock_target;

  var storeDestructiveActionSpy;
  beforeAll(() => {
    storeDestructiveActionSpy = jest.spyOn(AppHelper, "storeDestructiveAction").mockImplementation((_, groups)=> [groups]); // prettier-ignore
  });

  beforeEach(() => {
    mock_target = (group_id) => ({ target: { closest: jest.fn(() => ({ nextSibling: { id: group_id } })) } });
  });

  afterAll(() => {
    storeDestructiveActionSpy.mockRestore();
  });

  it.each([
    ["locked", "group-9", undefined],
    ["unlocked", "group-9", undefined],
    ["unlocked", "group-0", true],
  ])("%s group | id: %s | single group === %s", (locked, group_id, single_group) => {
    sessionStorage.setItem("settings", JSON.stringify(default_settings));
    var expected_groups = JSON.parse(localStorage.getItem("groups"));
    delete expected_groups["group-10"];

    if (single_group) {
      expected_groups = {};
      expected_groups[group_id] = {
        color: default_settings.color,
        created: AppHelper.getTimestamp(),
        hidden: false,
        locked: false,
        starred: false,
        tabs: [],
        title: default_settings.title,
      };
    }
    expected_groups[group_id].locked = locked === "locked";
    localStorage.setItem("groups", JSON.stringify(expected_groups));
    localStorage.setItem("groups_copy", JSON.stringify(expected_groups));
    if (!single_group) {
      delete expected_groups[group_id];
    }

    jest.clearAllMocks();

    GroupFunc.deleteGroup(mock_target(group_id), mockSet, mockSet);

    if (locked !== "locked") {
      expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
      expect(mockSet).toHaveBeenCalledTimes(2);

      expect(chromeLocalGetSpy).toHaveBeenCalledWith(["groups", "groups_copy"], anything);
      expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);
      expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: expected_groups, groups_copy: [expected_groups], scroll: 0 }, anything); // prettier-ignore
      expect(mockSet).toHaveBeenNthCalledWith(1, JSON.stringify(expected_groups));
      // expect(mockSet).toHaveBeenNthCalledWith(2, 5);
    } else {
      expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalSetSpy).not.toHaveBeenCalled();

      expect(alert).toHaveBeenCalledTimes(1);
      expect(alert.mock.calls.pop()[0]).toContain("This group is locked and thus cannot be deleted.");
    }
  });
});

describe("toggleGroup", () => {
  test.each([
    ["visibility", true],
    ["lock", true],
    ["star", true],
    ["star", false],
  ])("type === %s | value === %s", (type, value) => {
    var stub = { target: { closest: jest.fn(() => ({ nextSibling: { id: "group-0" } })) } };
    var expect_groups = JSON.parse(localStorage.getItem("groups"));
    if (type === "visibility") {
      expect_groups[stub.target.closest().nextSibling.id].hidden = value;
    } else if (type === "lock") {
      expect_groups[stub.target.closest().nextSibling.id].locked = value;
    } else {
      expect_groups[stub.target.closest().nextSibling.id].starred = !value;
      localStorage.setItem("groups", JSON.stringify(expect_groups));
      expect_groups[stub.target.closest().nextSibling.id].starred = value;

      if (value) {
        expect_groups[stub.target.closest().nextSibling.id].locked = true;
        const new_groups = JSON.stringify(expect_groups).replace("group-9", "group-2").replace("group-10", "group-3");
        expect_groups = JSON.parse(new_groups);
      }
    }

    jest.clearAllMocks();

    GroupFunc.toggleGroup(stub, type, mockSet);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: expect_groups, scroll: 0 }, anything);
  });
});

describe("sendMessage", () => {
  var spy = jest.spyOn(chrome.runtime, "sendMessage");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ["all", 0],
    ["all", 1],
    ["left", 0],
    ["left", 1],
    ["right", 0],
    ["right", 1],
  ])("sends a message to background script with correct parameters -> %s (id: %i)", (dir, id) => {
    var selector = `.merge-${dir}-btn`.replace("all-", "");
    fireEvent.click(container.querySelectorAll(selector)[id]);
    expect(spy).toHaveBeenCalledWith(chrome.runtime.id, { msg: dir, id: "group-" + id });
  });
});
