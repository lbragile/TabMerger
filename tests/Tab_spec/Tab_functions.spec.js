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
import { render, fireEvent, waitFor } from "@testing-library/react";

import * as TabFunc from "../../src/Tab/Tab_functions";
import Tab from "../../src/Tab/Tab";

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
  container = render(<Tab id="group-0" setTabTotal={mockSet} setGroups={mockSet} />).container;
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
      container = render(<Tab id="group-0" />).container;

      expect(container.getElementsByClassName("draggable").length).toEqual(0);
    });
  });

  describe("Title Shortening", () => {
    it("shortens the title if above the limit and adds ...", () => {
      var received_text = container.querySelector("a").textContent;
      expect(received_text.length).toEqual(73);
      expect(received_text).toContain("aaa...");
    });
  });
});

describe("dragStart", () => {
  it("adds the appropriate classes to the draggable and container", () => {
    var draggable = container.querySelector(".draggable");
    var dragStartSpy = jest.spyOn(TabFunc, "dragStart");
    addIdAndClassToGroup(container, "group-0", "group");

    fireEvent.dragStart(draggable);

    expect(dragStartSpy).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".draggable").classList).toContain("dragging");
    expect(container.querySelector(".tabs-container").parentNode.classList).toContain("drag-origin");
  });
});

// this needs to be re-worked
describe("dragEnd", () => {
  beforeEach(() => {
    window.alert = jest.fn();
  });

  // double check this
  it("works for same group", () => {
    addIdAndClassToGroup(container, "group-0", "group");

    var dragStartSpy = jest.spyOn(TabFunc, "dragStart");
    var dragEndSpy = jest.spyOn(TabFunc, "dragEnd");
    var alertSpy = jest.spyOn(window, "alert");

    var draggable = container.querySelector(".draggable");
    fireEvent.dragStart(draggable);
    fireEvent.dragEnd(draggable);

    expect(dragStartSpy).toHaveBeenCalledTimes(1);
    expect(dragEndSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledTimes(1); // ??? this seems wrong
    expect(container.querySelector(".draggable").classList).not.toContain("dragging");
    expect(container.querySelector(".tabs-container").parentNode.classList).not.toContain("drag-origin");
  });

  // needs work
  it.skip("works for different groups", () => {
    addIdAndClassToGroup(container, "group-0", "group");
    const container_0 = container;
    var { container } = render(<Tab id="group-1" />);
    addIdAndClassToGroup(container, "group-1", "group");
    const container_1 = container;
    var dragStartSpy = jest.spyOn(TabFunc, "dragStart");
    var dragEndSpy = jest.spyOn(TabFunc, "dragEnd");
    var draggable_0 = container_0.querySelector(".draggable");
    var draggable_1 = container_1.querySelector(".draggable");
    fireEvent.dragStart(draggable_0);
    fireEvent.dragEnd(draggable_1);
    expect(dragStartSpy).toHaveBeenCalledTimes(1);
    expect(dragEndSpy).toHaveBeenCalledTimes(1);
  });

  // it("fails when limit is exceeded", ()=>{})
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
