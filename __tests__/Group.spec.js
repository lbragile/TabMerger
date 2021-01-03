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
TabMerger team at <https://tabmerger.herokuapp.com/contact/>
*/

import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react";

import { getTimestamp } from "../src/App/App_functions";
import * as GroupFunc from "../src/Group/Group_functions";

import Group from "../src/Group/Group";
import Tab from "../src/Tab/Tab";

var mockSet, container;
// variables used in these tests
var chromeSyncSetSpy, chromeSyncGetSpy, chromeSyncRemoveSpy;
// prettier-ignore
var chromeLocalSetSpy, chromeLocalGetSpy, chromeLocalRemoveSpy;

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
      key={Math.random()}
    >
      <Tab></Tab>
    </Group>
  ).container;

  Object.keys(init_groups).forEach((key) => {
    sessionStorage.setItem(key, JSON.stringify(init_groups[key]));
    localStorage.setItem(key, JSON.stringify(init_groups[key]));
  });

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

describe("setTitle", () => {
  it("updates local storage", () => {
    localStorage.setItem("groups", JSON.stringify(init_groups));
    chromeLocalGetSpy.mockClear();
    chromeLocalSetSpy.mockClear();

    var target_mock = {
      target: {
        closest: jest.fn(() => {
          return { nextSibling: { id: "group-0" } };
        }),
        firstChild: {
          innerText: "Chess",
        },
        lastChild: {
          style: {
            visibility: "",
          },
        },
      },
    };

    GroupFunc.setTitle(target_mock, mockSet);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", expect.anything());
    // prettier-ignore
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: init_groups }, expect.anything());

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(JSON.stringify(init_groups));

    // fireEvent.click(group_title_node);
    // expect(group_title_node.lastChild).toBeTruthy();

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
      // prettier-ignore
      expect(chromeLocalSetSpy).toHaveBeenCalledWith({remove: ["group", "aaa", "bbb"]}, expect.anything());
    });
  });

  describe("deleteGroup", () => {
    var mock_target, any;

    beforeEach(() => {
      any = expect.anything();

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

      chromeLocalGetSpy.mockClear();
      chromeLocalSetSpy.mockClear();
      chromeSyncGetSpy.mockClear();

      GroupFunc.deleteGroup(mock_target("group-9"), mockSet, mockSet);

      expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
      expect(mockSet).toHaveBeenCalledTimes(2);

      expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", any);
      expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", any);
      expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups }, any);
      expect(mockSet).toHaveBeenNthCalledWith(1, 5);
      expect(mockSet).toHaveBeenNthCalledWith(2, JSON.stringify(groups));
    });

    it("deletes the only remaining group", () => {
      var groups = alterGroups(["group-1", "group-9", "group-10"]);
      localStorage.setItem("groups", JSON.stringify(groups));
      sessionStorage.setItem("settings", JSON.stringify(default_settings));
      groups = { "group-0": default_group };
      groups["group-0"].created = getTimestamp();

      chromeLocalGetSpy.mockClear();
      chromeLocalSetSpy.mockClear();
      chromeSyncGetSpy.mockClear();

      GroupFunc.deleteGroup(mock_target("group-0"), mockSet, mockSet);

      expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups }, any);
      expect(mockSet).toHaveBeenNthCalledWith(1, 0);
      expect(mockSet).toHaveBeenNthCalledWith(2, JSON.stringify(groups));
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

      chromeLocalGetSpy.mockClear();
      chromeLocalSetSpy.mockClear();
      chromeSyncGetSpy.mockClear();

      GroupFunc.deleteGroup(mock_target("group-1"), mockSet, mockSet);
      expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups }, any);
      expect(mockSet).toHaveBeenNthCalledWith(1, 5);
      expect(mockSet).toHaveBeenNthCalledWith(2, JSON.stringify(groups));
    });
  });
});

// can't be tested properly?
describe("toggleGroup", () => {
  var mock_target, any;

  beforeEach(() => {
    any = expect.anything();

    mock_target = {
      target: {
        closest: jest.fn(() => {
          return {
            nextSibling: {
              querySelectorAll: jest.fn(() => {
                return [
                  {
                    style: {
                      display: "",
                      removeProperty: jest.fn(() => "display"),
                    },
                  },
                ];
              }),
            },
          };
        }),
      },
    };
  });

  it("hides the group when it was showing and user pressed hide", () => {
    var tabs = mock_target.target.closest().nextSibling.querySelectorAll();
    mockSet.mockClear();
    GroupFunc.toggleGroup(mock_target, false, mockSet);
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(true);
    expect(tabs.length).toBe(1);
  });

  it("shows the group when it was hidden and user pressed show", () => {
    var tabs = mock_target.target.closest().nextSibling.querySelectorAll();
    // var spy = jest.spyOn(tabs[0].style, "removeProperty");

    mockSet.mockClear();
    GroupFunc.toggleGroup(mock_target, true, mockSet);
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(false);
    expect(tabs.length).toBe(1);
    // expect(spy).toHaveBeenCalledWith("display");
  });
});

describe("sendMessage", () => {
  it("sends a message to background script with correct parameters", async () => {
    var spy = jest.spyOn(chrome.runtime, "sendMessage");
    var id = chrome.runtime.id;

    fireEvent.click(container.querySelector(".merge-btn"));
    expect(spy).toHaveBeenCalledWith(id, { msg: "all", id: "group-0" });

    fireEvent.click(container.querySelector(".merge-left-btn"));
    expect(spy).toHaveBeenCalledWith(id, { msg: "left", id: "group-0" });

    fireEvent.click(container.querySelector(".merge-right-btn"));
    expect(spy).toHaveBeenCalledWith(id, { msg: "right", id: "group-0" });
  });
});
