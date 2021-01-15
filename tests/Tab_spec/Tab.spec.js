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

import Tab from "../../src/components/Tab/Tab";
import * as TabFunc from "../../src/components/Tab/Tab_functions";

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

var mockSet, container, anything;

beforeEach(() => {
  localStorage.setItem("groups", JSON.stringify(init_groups));
  mockSet = jest.fn(); // mock for setState hooks
  container = render(
    <AppProvider value={{ setTabTotal: mockSet, setGroups: mockSet }}>
      <Tab id="group-0" item_limit={8000} />
    </AppProvider>
  ).container;

  addIdAndClassToGroup(container, "group-0", "group");

  anything = expect.anything();
});

describe("Drag Events", () => {
  it("calls dragStart", () => {
    var spy = jest.spyOn(TabFunc, "dragStart");
    fireEvent.dragStart(container.querySelector(".draggable"));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(anything);
  });

  it("calls dragEnd", () => {
    // stub the document
    document.getElementsByClassName = jest.fn(() => [container.querySelector(".draggable").closest(".group")]);

    var spy = jest.spyOn(TabFunc, "dragEnd");
    fireEvent.dragEnd(container.querySelector(".draggable"));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(anything, 8000, mockSet);
  });
});

describe("Remove", () => {
  it("calls removeTab on click", () => {
    var spy = jest.spyOn(TabFunc, "removeTab");
    fireEvent.click(container.querySelector(".draggable .close-tab"));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(anything, anything, anything, mockSet, mockSet); // mockSet third argument fails
  });
});

describe("Open/Restore", () => {
  it("calls handleTabClick on click", () => {
    var spy = jest.spyOn(TabFunc, "handleTabClick");
    fireEvent.click(container.querySelector(".draggable .a-tab"));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(anything);
  });
});
