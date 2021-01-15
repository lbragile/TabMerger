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

import { render, fireEvent } from "@testing-library/react";

import * as AppFunc from "../../src/components/App/App_functions";
import App from "../../src/components/App/App";

var container, mockSet, anything;
const prev_window = window.location;

beforeEach(() => {
  mockSet = jest.fn();
  useStateMock.mockImplementation((init) => [init, mockSet]);

  anything = expect.anything();

  container = render(<App />).container;

  Object.keys(init_groups).forEach((key) => {
    sessionStorage.setItem(key, JSON.stringify(init_groups[key]));
    localStorage.setItem(key, JSON.stringify(init_groups[key]));
  });

  // mock window assign
  delete window.location;

  window.location = Object.defineProperties(
    {},
    {
      ...Object.getOwnPropertyDescriptors(prev_window),
      assign: {
        configurable: true,
        value: jest.fn(),
      },
    }
  );
});

afterEach(() => {
  // restore deleted window
  window.location = prev_window;

  sessionStorage.clear();
  localStorage.clear();
  jest.clearAllMocks();
});

// describe("Storage Change Event", () => {
//   it.only("calls openOrRemoveTabs when storage item changes", () => {
//     var spy = jest.spyOn(AppFunc, "openOrRemoveTabs");
//     localStorage.setItem("random", 1);

//     expect(spy).toHaveBeenCalledTimes(1);
//     expect(spy).toHaveBeenCalledWith(anything, "local", anything, anything);
//     expect(useStateMock).toHaveBeenCalledTimes(2);
//   });
// });

describe("Tab Search", () => {
  var regexSearchForTab, resetSearch;

  beforeEach(() => {
    regexSearchForTab = jest.spyOn(AppFunc, "regexSearchForTab");
    resetSearch = jest.spyOn(AppFunc, "resetSearch");
  });

  it("calls regexSearchForTab on change -> group", () => {
    fireEvent.change(container.querySelector(".input-group input"), {
      target: { value: "#a" },
    });

    expect(regexSearchForTab).toHaveBeenCalledTimes(1);
    expect(regexSearchForTab).toHaveBeenCalledWith(anything);
    expect(resetSearch).not.toHaveBeenCalled();
  });

  it("calls regexSearchForTab on change -> tab", () => {
    fireEvent.change(container.querySelector(".input-group input"), {
      target: { value: "a" },
    });

    expect(regexSearchForTab).toHaveBeenCalledTimes(1);
    expect(regexSearchForTab).toHaveBeenCalledWith(anything);
    expect(resetSearch).not.toHaveBeenCalled();
  });

  it("calls resetSearch on blur", () => {
    fireEvent.blur(container.querySelector(".input-group input"));

    expect(regexSearchForTab).not.toHaveBeenCalled();
    expect(resetSearch).toHaveBeenCalledTimes(1);
    expect(resetSearch).toHaveBeenCalledWith(anything);
  });
});

describe("Settings Button", () => {
  it("calls window location assign with correct parameter on click", () => {
    fireEvent.click(container.querySelector("#options-btn"));

    expect(window.location.assign).toHaveBeenCalledTimes(1);
    expect(window.location.assign).toHaveBeenCalledWith("/settings/settings.html");
  });
});

describe("Open All Button", () => {
  it("calls openAllTabs on click", () => {
    var spy = jest.spyOn(AppFunc, "openAllTabs");
    fireEvent.click(container.querySelector("#open-all-btn"));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalledWith(anything);
  });
});

// describe("Export Button", () => {
//   it("calls exportJSON on click", () => {
//     var spy = jest.spyOn(AppFunc, "exportJSON");
//     fireEvent.click(container.querySelector("#export-btn"));

//     expect(spy).toHaveBeenCalledTimes(1);
//     expect(spy).toHaveBeenCalledWith(anything);
//   });
// });

describe("Sync Write Button", () => {
  it("calls syncWrite on click", () => {
    var spy = jest.spyOn(AppFunc, "syncWrite");
    fireEvent.click(container.querySelector("#sync-write-btn"));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(anything);
  });
});

describe("Delete All Button", () => {
  it("calls deleteAllGroups on click", () => {
    var spy = jest.spyOn(AppFunc, "deleteAllGroups");
    fireEvent.click(container.querySelector("#delete-all-btn"));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(anything, anything);
    expect(useStateMock).toHaveBeenCalledTimes(2);
  });
});

describe("Import JSON Input", () => {
  it("calls importJSON on change", () => {
    var spy = jest.spyOn(AppFunc, "importJSON");
    fireEvent.change(container.querySelector("#import-input"), {
      target: { files: ["TabMerger.json"] },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(anything, anything, anything);
    expect(useStateMock).toHaveBeenCalledTimes(2);
  });
});

describe("Sync Read Button", () => {
  it("calls syncRead on click", () => {
    var spy = jest.spyOn(AppFunc, "syncRead");
    fireEvent.click(container.querySelector("#sync-read-btn"));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(anything, anything, anything);
    expect(useStateMock).toHaveBeenCalledTimes(2);
  });
});

describe("Add Group Button", () => {
  it("calls addGroup on click", () => {
    var spy = jest.spyOn(AppFunc, "addGroup");
    fireEvent.click(container.querySelector("#add-group-btn"));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(100, anything);
    // expect(useStateMock).toHaveBeenCalledTimes(1);
  });
});
