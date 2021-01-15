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

import { AppProvider } from "../../src/context/AppContext";

/**
 * When rendering just <Tab /> no group component is rendered.
 * This function added the necessary id & class to the
 * ```<div></div>``` wrapper that RTL renders.
 * @param {HTMLElement} container From ```render(<Tab id="group-x"/>)```
 * @param {string} id The group-id to wrap the Tab component in
 * @param {string} class_name The class name of the wrapper
 */
function addIdAndClassToGroup(container, id, class_name) {
  var group_node = container.querySelector(".tabs-container").parentNode;
  group_node.id = id;
  group_node.classList.add(class_name);
}

var init_tabs, mockSet, container;

beforeEach(() => {
  localStorage.setItem("groups", JSON.stringify(init_groups));
  init_tabs = init_groups["group-0"].tabs;
  mockSet = jest.fn(); // mock for setState hooks
  container = render(
    <AppProvider value={{ setTabTotal: mockSet, setGroups: mockSet }}>
      <Tab id="group-0" />
    </AppProvider>
  ).container;
});

afterEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});

describe("setInitTabs", () => {
  describe("Initialize correct number of tabs", () => {
    it("works when not empty", () => {
      expect(container.getElementsByClassName("draggable").length).toEqual(3);
    });

    it("works when empty", () => {
      localStorage.setItem("groups", JSON.stringify({ "group-0": {} }));
      container = render(
        <AppProvider value={{ setTabTotal: mockSet, setGroups: mockSet }}>
          <Tab id="group-0" />
        </AppProvider>
      ).container;
      expect(container.getElementsByClassName("draggable").length).toEqual(0);
    });
  });

  // this now happens with css so the title does not physically get shortened in TabMerger (just visually)
  describe.skip("Title Shortening", () => {
    it("shortens the title if above the limit and adds ...", () => {
      var received_text = container.querySelector("a").textContent;
      expect(received_text.length).toEqual(73);
      expect(received_text).toContain("aaa...");
    });
  });
});

describe("dragStart", () => {
  var dragStartSpy, draggable;

  beforeEach(() => {
    dragStartSpy = jest.spyOn(TabFunc, "dragStart");
    addIdAndClassToGroup(container, "group-0", "group");
  });

  afterEach(() => {
    expect(dragStartSpy).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".draggable").classList).toContain("dragging");
    expect(container.querySelector(".tabs-container").parentNode.classList).toContain("drag-origin");
  });

  it("adds the appropriate classes to the draggable and container -> draggable click", () => {
    draggable = container.querySelector(".draggable");
    fireEvent.dragStart(draggable);
  });

  it("adds the appropriate classes to the draggable and container -> tab link click", () => {
    draggable = container.querySelector(".move-tab");
    fireEvent.dragStart(draggable);
  });
});

// Note that tabs are not actually dragged, need puppeteer to test this
describe("dragEnd", () => {
  var chromeLocalGetSpy, chromeLocalSetSpy;

  beforeEach(() => {
    chromeLocalGetSpy = jest.spyOn(chrome.storage.local, "get");
    chromeLocalSetSpy = jest.spyOn(chrome.storage.local, "set");
  });

  it("works for same group", () => {
    addIdAndClassToGroup(container, "group-0", "group");

    var stub = {
      stopPropagation: jest.fn(),
      target: container.querySelectorAll("#group-0 .draggable")[1],
    };

    // stub the document
    document.getElementsByClassName = jest.fn(() => [container.querySelector(".draggable").closest(".group")]);

    TabFunc.dragEnd(stub, 8000, mockSet);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", expect.anything());

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: init_groups }, expect.anything());

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(JSON.stringify(init_groups));
  });

  it("works for different group", () => {
    // make a second group
    var container2 = render(
      <AppProvider value={{ setTabTotal: mockSet, setGroups: mockSet }}>
        <Tab id="group-1" />
      </AppProvider>
    ).container;

    addIdAndClassToGroup(container, "group-0", "group");
    addIdAndClassToGroup(container2, "group-1", "group");

    var stub = {
      stopPropagation: jest.fn(),
      target: container.querySelectorAll("#group-0 .draggable")[1],
    };

    // stub the document
    document.getElementsByClassName = jest.fn(() => [container2.querySelector(".draggable").closest(".group")]);

    chromeLocalGetSpy.mockClear();
    chromeLocalSetSpy.mockClear();

    TabFunc.dragEnd(stub, 8000, mockSet);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", expect.anything());

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: init_groups }, expect.anything());

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(JSON.stringify(init_groups));
  });

  it("fails when limit is exceeded", () => {
    const { location, alert } = window;
    delete window.location;
    delete window.alert;

    window.location = { reload: jest.fn() };
    window.alert = jest.fn();

    addIdAndClassToGroup(container, "group-0", "group");

    var stub = {
      stopPropagation: jest.fn(),
      target: container.querySelectorAll("#group-0 .draggable")[1],
    };

    // stub the document
    document.getElementsByClassName = jest.fn(() => [container.querySelector(".draggable").closest(".group")]);

    TabFunc.dragEnd(stub, 100, mockSet);

    expect(window.alert).toHaveBeenCalledTimes(1);
    expect(window.alert.mock.calls.pop()[0]).toContain("Group's syncing capacity exceeded");

    expect(window.location.reload).toHaveBeenCalled();

    window.location = location;
    window.alert = alert;
  });

  // it("does not change limit for same group", ()=>{})
});

describe("removeTab", () => {
  it("correctly adjusts storage when a tab is removed", () => {
    var removeTabSpy = jest.spyOn(TabFunc, "removeTab");
    var chromeSetSpy = jest.spyOn(chrome.storage.local, "set");
    addIdAndClassToGroup(container, "group-0", "group");

    fireEvent.click(container.querySelector(".close-tab"));

    var groups = JSON.parse(localStorage.getItem("groups"));

    expect(chromeSetSpy).toHaveBeenCalled();
    expect(init_tabs.length).toEqual(3);
    expect(groups["group-0"].tabs.length).toEqual(2);
    expect(removeTabSpy).toHaveBeenCalledTimes(1);
  });
});

describe("handleTabClick", () => {
  it("adds a remove item of form ['tab', tab.href] to local storage", () => {
    var tabClickSpy = jest.spyOn(TabFunc, "handleTabClick");
    var chromeSetSpy = jest.spyOn(chrome.storage.local, "set");

    fireEvent.click(container.querySelector(".a-tab"));

    expect(chromeSetSpy).toHaveBeenCalled();
    expect(tabClickSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem("remove"))).toStrictEqual(["tab", init_tabs[0].url]);
  });
});
