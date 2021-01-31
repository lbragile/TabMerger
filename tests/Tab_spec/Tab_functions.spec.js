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

import { render, fireEvent } from "@testing-library/react";

import * as TabFunc from "../../src/components/Tab/Tab_functions";
import Tab from "../../src/components/Tab/Tab";

import * as AppHelper from "../../src/components/App/App_helpers";

import { AppProvider } from "../../src/context/AppContext";

var anything = expect.anything();
var mockSet = jest.fn();
var chromeLocalGetSpy = jest.spyOn(chrome.storage.local, "get");
var chromeLocalSetSpy = jest.spyOn(chrome.storage.local, "set");

var container;
beforeEach(() => {
  localStorage.setItem("groups", JSON.stringify(init_groups));
  container = render(
    <AppProvider value={{ setTabTotal: mockSet, setGroups: mockSet }}>
      <div className="group" id="group-0">
        <Tab id="group-0" item_limit={8000} hidden={false} />
      </div>
    </AppProvider>
  ).container;
});

afterEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});

describe("setInitTabs", () => {
  test.each([
    ["not empty", "group-0"],
    ["empty", "group-0"],
    ["empty", ""],
  ])("Initialize correct number of tabs - %s", (type, id) => {
    localStorage.setItem("groups", JSON.stringify(type === "empty" ? {} : init_groups));
    jest.clearAllMocks();

    TabFunc.setInitTabs(mockSet, id);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(type === "empty" ? [] : init_groups[id].tabs);
  });
});

describe("tabDragStart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each([["draggable"], ["tab link"]])(
    "adds the appropriate classes to the draggable and container -> %s click",
    (type) => {
      var elem = container.querySelector(type === "draggable" ? ".draggable" : ".move-tab");
      fireEvent.dragStart(elem);

      expect(type === "draggable" ? elem.classList : elem.parentNode.classList).toContain("dragging");
      expect(container.querySelector(".group").classList).toContain("drag-origin");
    }
  );
});

// Note that tabs are not actually dragged, need puppeteer to test this
describe("tabDragEnd", () => {
  var stub, orig_groups;
  beforeEach(() => {
    stub = {
      stopPropagation: jest.fn(),
      target: document.querySelector(".draggable"),
    };

    document.body.innerHTML =
      `<div class="group drag-origin" id="group-0">` +
      `  <div class="tabs-container">` +
      `    <div class="draggable dragging"><a href="${location.href}#a">a</a></div>` +
      `    <div class="draggable"><a href="${location.href}#b">b</a><span class="pinned"/></div>` +
      `    <div class="draggable"><a href="${location.href}#c">c</a></div>` +
      `  </div>` +
      `</div>` +
      `<div class="group" id="group-1">` +
      `  <div class="tabs-container">` +
      `    <div class="draggable"><a href="${location.href}#d">d</a></div>` +
      `    <div class="draggable"><a href="${location.href}#e">e</a></div>` +
      `    <div class="draggable"><a href="${location.href}#f">f</a><span class="pinned"/></div>` +
      `  </div>` +
      `</div>`;

    orig_groups = JSON.parse(localStorage.getItem("groups"));

    // set local storage to original
    orig_groups["group-0"].tabs = [
      { pinned: false, title: "a", url: location.href + "#a" },
      { pinned: true, title: "b", url: location.href + "#b" },
      { pinned: false, title: "c", url: location.href + "#c" },
    ];

    orig_groups["group-1"].tabs = [
      { pinned: false, title: "d", url: location.href + "#d" },
      { pinned: false, title: "e", url: location.href + "#e" },
      { pinned: true, title: "f", url: location.href + "#f" },
    ];

    localStorage.setItem("groups", JSON.stringify(orig_groups));
  });

  it("works for same group", () => {
    stub.target.closest = jest.fn(() => document.querySelector("#group-0"));
    jest.clearAllMocks();

    TabFunc.tabDragEnd(stub, 8000, mockSet);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: orig_groups, scroll: 0 }, anything);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(JSON.stringify(orig_groups));
  });

  it("works for different group", () => {
    stub.target.closest = jest.fn(() => document.querySelector("#group-1"));

    jest.clearAllMocks();

    TabFunc.tabDragEnd(stub, 8000, mockSet);

    // note that since dragOver isn't applied we just expect the tab to be removed from
    // origin group. As long as drag over works, we can be confident that this also works.
    orig_groups["group-0"].tabs = [
      { pinned: true, title: "b", url: location.href + "#b" },
      { pinned: false, title: "c", url: location.href + "#c" },
    ];

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: orig_groups, scroll: 0 }, anything);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(JSON.stringify(orig_groups));
  });

  it("fails when limit is exceeded", () => {
    const { location, alert } = window;
    delete window.location;
    delete window.alert;

    window.location = { reload: jest.fn() };
    window.alert = jest.fn();

    var stub = {
      stopPropagation: jest.fn(),
      target: container.querySelectorAll("#group-0 .draggable")[1],
    };

    // stub the document
    document.getElementsByClassName = jest.fn(() => [container.querySelector(".draggable").closest(".group")]);

    TabFunc.tabDragEnd(stub, 100, mockSet);

    expect(window.alert).toHaveBeenCalledTimes(1);
    expect(window.alert.mock.calls.pop()[0]).toContain("Group's syncing capacity exceeded");

    expect(window.location.reload).toHaveBeenCalled();

    window.location = location;
    window.alert = alert;
  });
});

describe("removeTab", () => {
  var storeDestructiveActionSpy;
  beforeEach(() => {
    storeDestructiveActionSpy = jest.spyOn(AppHelper, "storeDestructiveAction").mockImplementation((_, groups) => [groups]); // prettier-ignore
  });

  afterEach(() => {
    storeDestructiveActionSpy.mockRestore();
  });

  it("correctly adjusts storage when a tab is removed", () => {
    var expected_groups = JSON.parse(localStorage.getItem("groups"));
    localStorage.setItem("groups_copy", JSON.stringify([]));
    expected_groups["group-0"].tabs = expected_groups["group-0"].tabs.slice(1, 3);
    jest.clearAllMocks();

    fireEvent.click(container.querySelector(".close-tab"));

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith(["groups", "groups_copy"], anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: expected_groups, groups_copy: [expected_groups], scroll: 0 }, anything); // prettier-ignore

    expect(JSON.parse(localStorage.getItem("groups"))["group-0"].tabs).toStrictEqual(expected_groups["group-0"].tabs);
  });

  it("alerts if group is locked", () => {
    global.alert = jest.fn();

    var expected_groups = JSON.parse(localStorage.getItem("groups"));
    expected_groups["group-0"].locked = true;
    localStorage.setItem("groups", JSON.stringify(expected_groups));
    jest.clearAllMocks();

    fireEvent.click(container.querySelector(".close-tab"));

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls.pop()[0]).toContain("This group is locked and thus tabs inside cannot be deleted.");
  });
});

describe("handleTabClick", () => {
  const url = "https://stackoverflow.com/";
  var classList_arr = [];

  var stub = {
    preventDefault: jest.fn(),
    target: {
      closest: jest.fn(() => ({ id: "group-0" })),
      href: url,
      click: jest.fn(),
      focus: jest.fn(),
      blur: jest.fn(),
      classList: {
        contains: jest.fn((arg) => classList_arr.includes(arg)),
        add: jest.fn((arg) => classList_arr.push(arg)),
      },
    },
    button: 0,
  };

  it("adds a remove item of form ['tab', tab.href] to local storage on left click", () => {
    TabFunc.handleTabClick(stub);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ remove: [stub.target.closest().id, stub.target.href] }, anything);

    expect(stub.target.click).toHaveBeenCalledTimes(1);
    expect(stub.target.click).not.toHaveBeenCalledWith(anything);

    expect(JSON.parse(localStorage.getItem("remove"))).toStrictEqual(["group-0", url]);
  });

  it("focuses on item on middle click", () => {
    stub.button = 1;
    TabFunc.handleTabClick(stub);

    expect(chromeLocalSetSpy).not.toHaveBeenCalled();
    expect(stub.target.focus).toHaveBeenCalledTimes(1);
    expect(stub.target.focus).not.toHaveBeenCalledWith(anything);
  });

  it("does nothing on another button click", () => {
    stub.button = 2;
    TabFunc.handleTabClick(stub);

    expect(chromeLocalSetSpy).not.toHaveBeenCalled();
    expect(stub.target.click).not.toHaveBeenCalled();
    expect(stub.target.focus).not.toHaveBeenCalled();
  });
});

describe("handleTabTitleChange", () => {
  const url = "https://stackoverflow.com/";

  var stub;

  beforeEach(() => {
    stub = {
      preventDefault: jest.fn(),
      target: {
        closest: jest.fn(() => ({ id: "group-0" })),
        href: url,
        textContent: "AAA",
        classList: {
          remove: jest.fn(),
        },
      },
      which: 0,
      keyCode: 0,
    };
  });

  it.each([["which"], ["keycode"]])("does nothing if enter is pressed - %s === 13", (type) => {
    if (type === "which") {
      stub.which = 13;
    } else {
      stub.keyCode = 13;
    }

    jest.clearAllMocks();
    TabFunc.handleTabTitleChange(stub);

    expect(stub.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("changes the tab's title and sets local storage accordingly", () => {
    var expected_groups = JSON.parse(localStorage.getItem("groups"));
    expected_groups[stub.target.closest().id].tabs[0].title = stub.target.textContent;

    jest.clearAllMocks();
    TabFunc.handleTabTitleChange(stub);

    expect(stub.target.classList.remove).toHaveBeenCalledTimes(1);
    expect(stub.target.classList.remove).toHaveBeenCalledWith("edit-tab-title");

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: expected_groups }, anything);
  });

  test.todo("does nothing when title is focused but not changed");
});

describe("handlePinClick", () => {
  const url = "https://www.twitch.tv/";

  var stub;
  beforeEach(() => {
    stub = {
      target: {
        closest: jest.fn(() => ({ classList: { toggle: jest.fn() }, id: "group-1", previousSibling: { href: url } })),
        classList: { contains: jest.fn() },
      },
    };
  });

  it.each([
    ["PINNED", "NOT", true],
    ["UNPINNED", "", false],
  ])("sets the tab to be %s when it was %s pinned", (_, __, type) => {
    stub.target.classList = { contains: jest.fn(() => type) };
    var expect_groups = JSON.parse(localStorage.getItem("groups"));
    expect_groups[stub.target.closest().id].tabs[0].pinned = type;
    jest.clearAllMocks();
    TabFunc.handlePinClick(stub, mockSet);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: expect_groups, scroll: 0 }, anything);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(JSON.stringify(expect_groups));
  });
});
