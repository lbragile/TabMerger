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

import { getTimestamp } from "../../src/components/App/App_helpers";
import * as GroupFunc from "../../src/components/Group/Group_functions";
import * as GroupHelper from "../../src/components/Group/Group_helpers";

import Group from "../../src/components/Group/Group";

import { AppProvider } from "../../src/context/AppContext";

/**
 * Alter init_groups non-destructively by removing some keys
 * @param {string[]} remove the keys to remove from ```init_groups```
 *
 * @return new groups object based on ```init_groups``` without the keys
 * mentioned in the ```remove``` parameter
 */
function alterGroups(remove) {
  var groups = {};
  Object.keys(init_groups).map((key) => {
    if (!remove.includes(key)) {
      groups[key] = init_groups[key];
    }
  });
  return groups;
}

var mockSet, container, anything;
var chromeLocalSetSpy, chromeLocalGetSpy, chromeLocalRemoveSpy;
var chromeSyncSetSpy, chromeSyncGetSpy, chromeSyncRemoveSpy;

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
        title="Title"
        color="#dedede"
        created="11/11/2020 @ 11:11:11"
        num_tabs={0}
        key={Math.random()}
      ></Group>
    </AppProvider>
  ).container;

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

describe("Change Group Color", () => {
  it("opens color input on click", () => {
    var spy = jest.spyOn(GroupFunc, "setGroupBackground");
    fireEvent.click(container.querySelector(".input-color"));

    expect(spy).not.toHaveBeenCalled();
  });

  it("calls setGroupBackground on change", () => {
    var spy = jest.spyOn(GroupFunc, "setGroupBackground");
    jest.clearAllMocks();

    fireEvent.change(container.querySelector("input[type='color'"), {
      target: { value: "#000" },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    init_groups["group-0"].color = "#000000";
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: init_groups }, anything);
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
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: init_groups }, anything);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(JSON.stringify(init_groups));
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

  it("finds the correct after element -> start/middle", () => {
    jest.spyOn(GroupHelper, "getDragAfterElement").mockImplementation(() => {
      return document.querySelector(".draggable:nth-child(3)");
    });

    GroupFunc.dragOver(stub);

    const tabs_text = [...document.querySelectorAll(".draggable")].map((x) => x.textContent);
    expect(tabs_text).toEqual(["b", "a", "c"]);

    expect(global.scrollTo).toHaveBeenCalled();
    expect(global.scrollTo).toHaveBeenCalledWith(0, stub.clientY);
  });

  it("finds the correct after element -> end", () => {
    jest.spyOn(GroupHelper, "getDragAfterElement").mockImplementation(() => {
      return document.querySelector(".draggable:nth-child(4)");
    });

    // to avoid scrolling
    stub.clientY = 20;

    GroupFunc.dragOver(stub);

    const tabs_text = [...document.querySelectorAll(".draggable")].map((x) => x.textContent);
    expect(tabs_text).toEqual(["b", "c", "a"]);

    expect(global.scrollTo).not.toHaveBeenCalled();
  });

  it("does nothing if after element = dragging element", () => {
    jest.spyOn(GroupHelper, "getDragAfterElement").mockImplementation(() => {
      return document.querySelector(".draggable:nth-child(1)");
    });

    // scroll up
    stub.clientY = 0;

    GroupFunc.dragOver(stub);

    const tabs_text = [...document.querySelectorAll(".draggable")].map((x) => x.textContent);
    expect(tabs_text).toEqual(["a", "b", "c"]);

    expect(global.scrollTo).toHaveBeenCalled();
    expect(global.scrollTo).toHaveBeenCalledWith(0, stub.clientY);
  });
});

describe("openGroup", () => {
  it("forms an array that matches ['group', ..., tab_links, ...]", () => {
    chromeLocalSetSpy.mockClear();

    var mock_target = {
      target: {
        closest: jest.fn(() => {
          return {
            nextSibling: {
              querySelectorAll: jest.fn(() => {
                return [{ href: "aaa" }, { href: "bbb" }];
              }),
            },
          };
        }),
      },
    };

    GroupFunc.openGroup(mock_target);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ remove: ["group", "aaa", "bbb"] }, anything);
  });
});

describe("deleteGroup", () => {
  var mock_target;

  beforeEach(() => {
    mock_target = (group_id) => {
      return {
        target: {
          closest: jest.fn(() => {
            return {
              nextSibling: {
                id: group_id,
              },
            };
          }),
        },
      };
    };
  });

  it("removes the group and adjusts counts (last group)", () => {
    var groups = alterGroups(["group-10"]);
    localStorage.setItem("groups", JSON.stringify(groups));
    delete groups["group-9"];

    jest.clearAllMocks();

    GroupFunc.deleteGroup(mock_target("group-9"), mockSet, mockSet);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledTimes(2);

    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups }, anything);
    expect(mockSet).toHaveBeenNthCalledWith(1, JSON.stringify(groups));
    expect(mockSet).toHaveBeenNthCalledWith(2, 5);
  });

  it("deletes the only remaining group", () => {
    var groups = alterGroups(["group-1", "group-9", "group-10"]);
    localStorage.setItem("groups", JSON.stringify(groups));
    sessionStorage.setItem("settings", JSON.stringify(default_settings));
    groups = { "group-0": default_group };
    groups["group-0"].created = getTimestamp();

    jest.clearAllMocks();

    GroupFunc.deleteGroup(mock_target("group-0"), mockSet, mockSet);

    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups }, anything);
    expect(mockSet).toHaveBeenNthCalledWith(1, JSON.stringify(groups));
    expect(mockSet).toHaveBeenNthCalledWith(2, 0);
  });

  it("deletes middle group and adjusts group keys for remaining", () => {
    var groups = {};
    Object.values(init_groups).forEach((val, i) => {
      groups["group-" + i] = val;
    });

    localStorage.setItem("groups", JSON.stringify(groups));
    sessionStorage.setItem("settings", JSON.stringify(default_settings));

    delete groups["group-1"];
    groups = JSON.parse(JSON.stringify(groups).replace("group-2", "group-1"));
    groups = JSON.parse(JSON.stringify(groups).replace("group-3", "group-2"));

    jest.clearAllMocks();

    GroupFunc.deleteGroup(mock_target("group-1"), mockSet, mockSet);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups }, anything);
    expect(mockSet).toHaveBeenNthCalledWith(1, JSON.stringify(groups));
    expect(mockSet).toHaveBeenNthCalledWith(2, 5);
  });
});

describe("sendMessage", () => {
  var spy, id;

  beforeEach(() => {
    spy = jest.spyOn(chrome.runtime, "sendMessage");
    id = chrome.runtime.id;
  });

  it("sends a message to background script with correct parameters -> all", () => {
    fireEvent.click(container.querySelector(".merge-btn"));
    expect(spy).toHaveBeenCalledWith(id, { msg: "all", id: "group-0" });
  });

  it("sends a message to background script with correct parameters -> left", () => {
    fireEvent.click(container.querySelector(".merge-left-btn"));
    expect(spy).toHaveBeenCalledWith(id, { msg: "left", id: "group-0" });
  });

  it("sends a message to background script with correct parameters -> right", () => {
    fireEvent.click(container.querySelector(".merge-right-btn"));
    expect(spy).toHaveBeenCalledWith(id, { msg: "right", id: "group-0" });
  });
});
