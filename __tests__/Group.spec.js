import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react";

import * as GroupFunc from "../src/Group/Group_functions";

import Group from "../src/Group/Group";
import Tab from "../src/Tab/Tab";

var init_ls_entry, init_tabs, mockSet, container;

beforeEach(() => {
  //   chrome.storage.local.set({ groups: init_groups }, () => {});
  //   init_ls_entry = JSON.parse(localStorage.getItem("groups"));
  //   init_tabs = init_ls_entry["group-0"].tabs;
  mockSet = jest.fn(); // mock for setState hooks
  container = render(
    <Group
      id="group-0"
      className="group"
      title="Title"
      color="#dedede"
      created="11/11/2020 @ 11:11:11"
      num_tabs={0}
      setGroups={mockSet}
      setTabTotal={mockSet}
      getTimestamp={jest.fn()}
      key={Math.random()}
    />
  ).container;
});

afterEach(() => {
  //   chrome.storage.local.clear();
  jest.clearAllMocks();
});

describe("setTitle", () => {
  it("highlights group's title on click and shows reload", () => {
    var group_title_node = container.querySelector(".title-edit-input");
    expect(group_title_node.firstChild.textContent).toBe("Title");

    fireEvent.click(group_title_node);
    expect(group_title_node.lastChild).toBeTruthy();

    // fireEvent.change(group_title_node.firstChild, {
    //   target: { innerHTML: "New Title" },
    // });
    // expect(group_title_node.firstChild.textContent).toBe("New Title");
    // expect(group_title_node.lastChild).toBeTruthy();

    // fireEvent.click(group_title_node.lastChild);
    // expect(group_title_node.firstChild.textContent).toBe("Title");

    // fireEvent.change(group_title_node, { target: { innerHTML: "Default" } });
    // fireEvent.blur(group_title_node);
    // chrome.storage.local.get("groups", (local) => {
    //   expect(local.groups[container.querySelector(".group").id].title).toBe(
    //     "Default"
    //   );
    // });
  });
});
