import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react";

import * as TabFunc from "../src/Tab/Tab_functions";
import { init_groups } from "../__mocks__/variableMocks.js";

import Tab from "../src/Tab/Tab";

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

var init_tabs, mockSet;

beforeEach(() => {
  localStorage.setItem("groups", JSON.stringify(init_groups));
  init_tabs = init_groups["group-0"].tabs;
  mockSet = jest.fn(); // mock for setState hooks
});

afterEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});

describe("setInitTabs", () => {
  describe("Initialize correct number of tabs", () => {
    it("works when not empty", () => {
      const { container } = render(<Tab id="group-0" />);
      expect(container.getElementsByClassName("draggable").length).toEqual(3);
    });

    it("works when empty", () => {
      // set the tabs to be empty
      localStorage.setItem("groups", JSON.stringify({ "group-0": {} }));

      const { container } = render(<Tab id="group-0" />);
      expect(container.getElementsByClassName("draggable").length).toEqual(0);
      expect.assertions(1);
    });
  });

  describe("Title Shortening", () => {
    it("shortens the title if above the limit and adds ...", () => {
      const { container } = render(<Tab id="group-0" />);
      var received_text = container.querySelector("a").textContent;
      expect(received_text.length).toEqual(83);
      expect(received_text).toBe(
        "Stack Overflow - Where Developers Learn, Share, & Build Careersaaaaaaaaaaaaaaaaa..."
      );
    });
  });
});

describe("dragStart", () => {
  it("adds the appropriate classes to the draggable and container", () => {
    const { container } = render(<Tab id="group-0" />);
    addIdAndClassToGroup(container, "group-0", "group");

    var draggable = container.querySelector(".draggable");
    var dragStartSpy = jest.spyOn(TabFunc, "dragStart");

    fireEvent.dragStart(draggable);
    expect(dragStartSpy).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".draggable").classList).toContain(
      "dragging"
    );
    expect(
      container.querySelector(".tabs-container").parentNode.classList
    ).toContain("drag-origin");
  });
});

// this needs to be re-worked
describe("dragEnd", () => {
  beforeEach(() => {
    window.alert = jest.fn();
  });

  // double check this
  it("works for same group", () => {
    const { container } = render(<Tab id="group-0" />);
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
    expect(container.querySelector(".draggable").classList).not.toContain(
      "dragging"
    );
    expect(
      container.querySelector(".tabs-container").parentNode.classList
    ).not.toContain("drag-origin");
  });

  // needs work
  it("works for different groups", () => {
    var { container } = render(<Tab id="group-0" />);
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
    // expect(container_0.querySelector(".draggable").classList).not.toContain(
    //   "dragging"
    // );
    // expect(
    //   container_0.querySelector(".tabs-container").parentNode.classList
    // ).not.toContain("drag-origin");
  });

  // it("fails when limit is exceeded", ()=>{})
  // it("does not change limit for same group", ()=>{})
});

describe("removeTab", () => {
  it("correctly adjusts storage when a tab is removed", async () => {
    const { container } = render(
      <Tab id="group-0" setTabTotal={mockSet} setGroups={mockSet} />
    );

    addIdAndClassToGroup(container, "group-0", "group");

    var removeTabSpy = jest.spyOn(TabFunc, "removeTab");
    var chromeSetSpy = jest.spyOn(chrome.storage.local, "set");

    fireEvent.click(container.querySelector(".close-tab"));

    await waitFor(() => {
      expect(chromeSetSpy).toHaveBeenCalled();
    });

    var groups = JSON.parse(localStorage.getItem("groups"));
    expect(init_tabs.length).toEqual(3);
    expect(groups["group-0"].tabs.length).toEqual(2);
    expect(removeTabSpy).toHaveBeenCalledTimes(1);

    expect.assertions(4);
  });
});

describe("handleTabClick", () => {
  it("adds a remove item of form ['tab', tab.href] to local storage", async () => {
    const { container } = render(<Tab id="group-0" />);

    var tabClickSpy = jest.spyOn(TabFunc, "handleTabClick");
    var chromeSetSpy = jest.spyOn(chrome.storage.local, "set");

    fireEvent.click(container.querySelector(".a-tab"));

    await waitFor(() => {
      expect(chromeSetSpy).toHaveBeenCalled();
    });

    chrome.storage.local.get("remove", (local) => {
      expect(tabClickSpy).toHaveBeenCalledTimes(1);
      expect(local.remove).toStrictEqual(["tab", init_tabs[0].url]);
    });

    expect.assertions(3);
  });
});

describe("getFavIconURL", () => {
  it("returns the API call with just domain name", () => {
    var base = "http://www.google.com/s2/favicons?domain=";
    var url = "https://www.google.com/";
    var domain = "www.google.com";
    expect(TabFunc.getFavIconURL(url)).toBe(base + domain);
  });
});
