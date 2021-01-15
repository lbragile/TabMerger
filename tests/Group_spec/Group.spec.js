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

import React, { useState as useStateMock } from "react";
window.React = React;

jest.mock("react", () => ({
  ...jest.requireActual("react"),
  useState: jest.fn(),
}));

import { render, fireEvent, waitFor } from "@testing-library/react";

import * as GroupFunc from "../../src/components/Group/Group_functions";
import Group from "../../src/components/Group/Group";

import { AppProvider } from "../../src/context/AppContext";

var container, mockSet, anything;

beforeEach(() => {
  mockSet = jest.fn();
  useStateMock.mockImplementation((init) => [init, mockSet]);

  anything = expect.anything();

  container = render(
    <AppProvider value={{ setTabTotal: mockSet, setGroups: mockSet }}>
      <Group
        id="group-0"
        className="group"
        title="Title"
        color="#dedede"
        created="11/11/2020 @ 11:11:11"
        num_tabs={0}
        key={Math.random()}
      />
    </AppProvider>
  ).container;

  Object.keys(init_groups).forEach((key) => {
    sessionStorage.setItem(key, JSON.stringify(init_groups[key]));
    localStorage.setItem(key, JSON.stringify(init_groups[key]));
  });
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
    spy.mockClear();

    fireEvent.change(container.querySelector("input[type='color'"), {
      target: { value: "#000" },
    });

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("Group Title", () => {
  var titleSpy, blurSpy, elem;
  beforeEach(() => {
    titleSpy = jest.spyOn(GroupFunc, "setTitle");
    blurSpy = jest.spyOn(GroupFunc, "blurOnEnter");
    elem = container.querySelector(".title-edit-input");
  });

  // not working properly
  it.skip("selects title on Focus", () => {
    fireEvent.focus(elem);
    expect(container.activeElement).toBe(elem);
  });

  it("set title on blur", () => {
    localStorage.setItem("groups", JSON.stringify(init_groups));
    fireEvent.focus(elem);
    fireEvent.blur(elem);
    expect(titleSpy).toHaveBeenCalledTimes(1);
    expect(titleSpy).toHaveBeenCalledWith(anything, anything, "Title");
    expect(mockSet).toHaveBeenCalledTimes(1);
  });

  it("blurs on Enter key press", () => {
    var spy = jest.spyOn(GroupFunc, "blurOnEnter");
    fireEvent.focus(elem);
    fireEvent.keyDown(elem, { keyCode: 13 });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(anything);
  });
});

describe("Toggle Group (Hide/Show)", () => {
  it("calls toggleGroup on click -> show", () => {
    var spy = jest.spyOn(GroupFunc, "toggleGroup");
    fireEvent.click(container.querySelector(".show-hide-btn"));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(anything, false, anything);
  });

  // not working
  it.skip("calls toggleGroup on click -> hide", async () => {
    var spy = jest.spyOn(GroupFunc, "toggleGroup");
    fireEvent.click(container.querySelector(".show-hide-btn"));
    spy.mockClear();

    await waitFor(() => {
      expect(container.querySelector(".show-hide-btn")).toBeTruthy();
    });

    fireEvent.click(container.querySelector(".show-hide-btn"));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(anything, true, anything);
  });
});

describe("Open Group", () => {
  it("calls openGroup on click", () => {
    var spy = jest.spyOn(GroupFunc, "openGroup");
    fireEvent.click(container.querySelector(".open-group-btn"));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(anything);
  });
});

describe("Delete Group", () => {
  it("calls deleteGroup on click", () => {
    localStorage.setItem("groups", JSON.stringify(init_groups));
    sessionStorage.setItem("settings", JSON.stringify(default_settings));

    var spy = jest.spyOn(GroupFunc, "deleteGroup");
    fireEvent.click(container.querySelector(".delete-group-btn"));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(anything, anything, anything);
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
