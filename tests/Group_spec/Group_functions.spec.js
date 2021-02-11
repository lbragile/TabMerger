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

import * as GroupFunc from "../../src/components/Group/Group_functions";
import Group from "../../src/components/Group/Group";

import * as AppHelper from "../../src/components/App/App_helpers";
import { AppProvider } from "../../src/context/AppContext";

var container;

const anything = expect.anything();
beforeEach(() => {
  Object.keys(init_groups).forEach((key) => {
    sessionStorage.setItem(key, JSON.stringify(init_groups[key]));
  });
  localStorage.setItem("groups", JSON.stringify(init_groups));

  container = render(
    <AppProvider value={{ setTabTotal: mockSet, setGroups: mockSet }}>
      <Group
        id="group-0"
        title="GROUP A"
        color="#dedede"
        created="11/11/2020 @ 11:11:11"
        num_tabs={1}
        key={Math.random()}
      >
        <div className="draggable">
          <svg />
          <a className="a-tab mx-1 text-black" href="tab_a_url">
            <span>Tab A</span>
          </a>
        </div>
      </Group>
      <Group
        id="group-1"
        title="GROUP B"
        color="#c7eeff"
        created="22/22/2020 @ 22:22:22"
        num_tabs={1}
        key={Math.random()}
      >
        <div className="draggable">
          <svg />
          <a className="a-tab mx-1 text-black" href="tab_b_url">
            <span className="pinned">Tab B</span>
          </a>
        </div>
      </Group>
    </AppProvider>
  ).container;
});

describe("setBGColor", () => {
  var spy = jest.spyOn(GroupFunc, "setBGColor");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("opens color input on click", () => {
    fireEvent.click(container.querySelector(".input-color"));

    expect(spy).not.toHaveBeenCalled();
  });

  it("opens colorpicker on change and stores the next value appropriately", () => {
    init_groups["group-0"].color = "#000000";

    fireEvent.change(container.querySelector("input[type='color']"), { target: { value: "#000" } });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: init_groups }, anything);
  });

  it.each([
    ["#00FF00", true],
    ["#777777", true],
    ["#FF00FF", true],
    ["#000000", false],
  ])("maintains bg color based on existing group bg color (%s) - exists = %s", (color, group_exists) => {
    var stub = {
      previousSibling: {
        querySelector: (arg) => arg !== "" && { value: color },
        parentNode: { children: container.querySelectorAll(".group-title, .group") },
      },
    };

    var expect_groups = JSON.parse(localStorage.getItem("groups"));
    if (group_exists) {
      expect_groups["group-0"].color = color;
    }

    jest.clearAllMocks();

    GroupFunc.setBGColor(stub, group_exists ? "group-0" : "group-11");

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    if (group_exists) {
      expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: expect_groups }, anything);
    } else {
      expect(chromeLocalSetSpy).not.toHaveBeenCalled();
    }

    expect(container).toMatchSnapshot();
  });
});

describe("updateTextColor", () => {
  it("updates local storage correctly", () => {
    localStorage.setItem("groups", JSON.stringify(init_groups));
    jest.clearAllMocks();

    GroupFunc.updateTextColor(mockSet);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ scroll: 0 }, anything);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(JSON.stringify(init_groups));
  });
});

describe("setTitle", () => {
  it("updates local storage", () => {
    localStorage.setItem("groups", JSON.stringify(init_groups));
    jest.clearAllMocks();

    var target_mock = {
      target: {
        closest: (arg) => arg !== "" && { nextSibling: { id: "group-0" } },
        nextSibling: { style: { visibility: "" } },
        value: "Chess",
      },
    };

    GroupFunc.setTitle(target_mock, mockSet);
    init_groups["group-0"].title = target_mock.target.value;

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: init_groups, scroll: 0 }, anything);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(JSON.stringify(init_groups));
  });
});

describe("blurOnEnter", () => {
  test.each([[13], [1]])("keycode === %s", (keyCode) => {
    var stub = { target: { blur: jest.fn() }, keyCode };
    jest.clearAllMocks();

    GroupFunc.blurOnEnter(stub);

    if (keyCode === 13) {
      expect(stub.target.blur).toHaveBeenCalledTimes(1);
    } else {
      expect(stub.target.blur).not.toHaveBeenCalled();
    }
  });
});

describe("addTabFromURL", () => {
  it.each([
    ["FAIL", "www.lichess.org/", "leave"],
    ["NOT", "https://stackoverflow.com/", "merge"],
    ["NOT", "https://stackoverflow.com/", "leave"],
    ["", "https://lichess.org/", "merge"],
    ["", "https://lichess.org/", "leave"],
  ])(
    "adds the tab to the correct group when URL does %s exist: %s (settings.merge === %s)",
    (type, url, merge_setting) => {
      var stub = { target: { value: url, closest: (arg) => arg !== "" && { id: "group-0" }, blur: jest.fn() } };

      // move first tab to end to get expected result
      var expected_group = JSON.parse(localStorage.getItem("groups"));
      const last_tab = expected_group[stub.target.closest().id].tabs.shift();
      expected_group[stub.target.closest().id].tabs.push(last_tab);

      // local must be different from chrome.tabs.query
      var current_groups = JSON.parse(localStorage.getItem("groups"));
      current_groups[stub.target.closest().id].tabs.shift();
      localStorage.setItem("groups", JSON.stringify(current_groups));

      const partial_expected_tabs = init_groups[stub.target.closest().id].tabs;
      const open_tabs = partial_expected_tabs.map((x, i) => ({ ...x, id: i }));
      sessionStorage.setItem("open_tabs", JSON.stringify(open_tabs));
      sessionStorage.setItem("settings", JSON.stringify(default_settings));

      if (merge_setting !== "merge") {
        var current_settings = JSON.parse(sessionStorage.getItem("settings"));
        current_settings.merge = merge_setting;
        sessionStorage.setItem("settings", JSON.stringify(current_settings));
      }

      global.alert = jest.fn();
      jest.clearAllMocks();

      jest.useFakeTimers();
      GroupFunc.addTabFromURL(stub, mockSet, mockSet, mockSet);
      jest.advanceTimersByTime(51);

      expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

      expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

      if (type === "" || type === "FAIL") {
        expect(stub.target.value).toBe("");
        expect(stub.target.blur).toHaveBeenCalledTimes(1);

        expect(mockSet).toHaveBeenCalledTimes(1);
        expect(mockSet.mock.calls.pop()[0]).toEqual(
          expect.objectContaining({
            show: true,
            title: "❕ TabMerger Information ❕",
            accept_btn_text: "OK",
            reject_btn_text: null,
          })
        );
      } else {
        expect(chromeTabsQuerySpy).toHaveBeenCalledTimes(1);
        expect(chromeTabsQuerySpy).toHaveBeenCalledWith({ status: "complete" }, anything);

        expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
        expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: expected_group, scroll: 0 }, anything);

        expect(mockSet).toHaveBeenCalledTimes(2);
        expect(mockSet).toHaveBeenNthCalledWith(1, 7);
        expect(mockSet).toHaveBeenNthCalledWith(2, JSON.stringify(expected_group));
      }

      if (merge_setting === "merge" && type === "NOT") {
        expect(chromeTabsRemoveSpy).toHaveBeenCalledTimes(1);
        expect(chromeTabsRemoveSpy).toHaveBeenCalledWith(0);
      } else {
        expect(chromeTabsRemoveSpy).not.toHaveBeenCalled();
      }
    }
  );

  test.todo("ensure the above works for separate windows");
  test.todo("above works with open_tabs not empty");
});

describe("groupDragStart", () => {
  it.each([[true], [false]])("adds class to correct element - tab dragging === %s", (val) => {
    document.body.innerHTML = `<div class="group-item"></div>`;

    var stub = (ret_val) => ({
      target: {
        closest: (arg) => {
          if (arg === ".draggable") {
            return ret_val;
          } else if (arg === ".group-item") {
            return document.querySelector(".group-item");
          }
        },
      },
    });

    GroupFunc.groupDragStart(stub(val));

    expect(document.querySelector(".group-item").classList.value).toBe("group-item" + (val ? "" : " dragging-group"));
  });
});

describe("groupDragEnd", () => {
  it.each([[true], [false]])("Drag operation is group === %s", (group_drag) => {
    var classList_arr = ["dragging-group"];
    const stub = {
      preventDefault: () => {},
      target: {
        classList: {
          contains: (arg) => arg !== "" && group_drag,
          remove: (arg) => arg !== "" && classList_arr.shift(),
        },
      },
    };

    const expected_groups = {
      "group-0": {
        color: "#dedede",
        created: "11/11/2020 @ 11:11:11",
        hidden: false,
        locked: false,
        starred: false,
        tabs: [{ pinned: false, title: "Tab A", url: location.href + "tab_a_url" }],
        title: "GROUP A",
      },
      "group-1": {
        color: "#c7eeff",
        created: "22/22/2020 @ 22:22:22",
        hidden: false,
        locked: false,
        starred: false,
        tabs: [{ pinned: true, title: "Tab B", url: location.href + "tab_b_url" }],
        title: "GROUP B",
      },
    };

    document.querySelectorAll = (arg) => container.querySelectorAll(arg);
    localStorage.setItem("groups", JSON.stringify(init_groups));
    jest.clearAllMocks();

    GroupFunc.groupDragEnd(stub, mockSet);

    if (group_drag) {
      expect(classList_arr).toEqual([]);

      expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: expected_groups, scroll: 0 }, anything);

      expect(mockSet).toHaveBeenCalledTimes(1);
      expect(mockSet).toHaveBeenCalledWith(JSON.stringify(expected_groups));
    } else {
      expect(chromeLocalSetSpy).not.toHaveBeenCalled();
      expect(mockSet).not.toHaveBeenCalled();
    }
  });
});

describe("openGroup", () => {
  it("forms an array that matches ['group-id', ..., tab_links, ...]", () => {
    chromeLocalSetSpy.mockClear();

    var stub = {
      target: {
        closest: (arg) =>
          arg !== "" && {
            nextSibling: { querySelectorAll: (arg) => arg !== "" && [{ href: "aaa" }, { href: "bbb" }], id: "group-0" },
          },
      },
    };

    GroupFunc.openGroup(stub);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ remove: ["group-0", "aaa", "bbb"] }, anything);
  });
});

describe("deleteGroup", () => {
  var storeDestructiveActionSpy = jest.spyOn(AppHelper, "storeDestructiveAction").mockImplementation((_, groups)=> [groups]); // prettier-ignore

  afterAll(() => {
    storeDestructiveActionSpy.mockRestore();
  });

  it.each([
    ["locked", "group-1", false],
    ["unlocked", "group-1", false],
    ["unlocked", "group-0", true],
  ])("%s group | id: %s | single group === %s", (locked, group_id, single_group) => {
    var mock_target = (group_id) => ({ target: { closest: (arg) => arg !== "" && { nextSibling: { id: group_id } } } });

    sessionStorage.setItem("settings", JSON.stringify(default_settings));
    var expected_groups = JSON.parse(JSON.stringify(init_groups));
    if (single_group) {
      expected_groups = {};
      expected_groups[group_id] = {
        color: default_settings.color,
        created: AppHelper.getTimestamp(),
        hidden: false,
        locked: false,
        starred: false,
        tabs: [],
        title: default_settings.title,
      };
    }

    expected_groups[group_id].locked = locked === "locked";
    var expected_groups_copy = [JSON.parse(JSON.stringify(expected_groups))];

    localStorage.setItem("groups", JSON.stringify(expected_groups));
    localStorage.setItem("groups_copy", JSON.stringify(expected_groups));
    if (!single_group && locked === "unlocked") {
      delete expected_groups[group_id];
      expected_groups_copy = [JSON.parse(JSON.stringify(expected_groups))];
      const ordered_vals = AppHelper.sortByKey(expected_groups);
      expected_groups = {};
      ordered_vals.forEach((val, i) => {
        expected_groups["group-" + i] = val;
      });
    }

    jest.clearAllMocks();

    GroupFunc.deleteGroup(mock_target(group_id), mockSet, mockSet, mockSet);

    if (locked !== "locked") {
      expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
      expect(mockSet).toHaveBeenCalledTimes(2);

      expect(chromeLocalGetSpy).toHaveBeenCalledWith(["groups", "groups_copy"], anything);
      expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);
      expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: expected_groups, groups_copy: expected_groups_copy, scroll: 0 }, anything); // prettier-ignore
      expect(mockSet).toHaveBeenNthCalledWith(1, JSON.stringify(expected_groups));
    } else {
      expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalSetSpy).not.toHaveBeenCalled();

      expect(mockSet).toHaveBeenCalledTimes(1);
      expect(mockSet.mock.calls.pop()[0]).toEqual(
        expect.objectContaining({
          show: true,
          title: "❕ TabMerger Information ❕",
          accept_btn_text: "OK",
          reject_btn_text: null,
        })
      );
    }
  });
});

describe("toggleGroup", () => {
  test.each([
    ["visibility", true],
    ["lock", true],
    ["star", true],
    ["star", false],
  ])("type === %s | value === %s", (type, value) => {
    var stub = { target: { closest: (arg) => arg !== "" && { nextSibling: { id: "group-0" } } } };
    var expect_groups = JSON.parse(localStorage.getItem("groups"));
    if (type === "visibility") {
      expect_groups[stub.target.closest().nextSibling.id].hidden = value;
    } else if (type === "lock") {
      expect_groups[stub.target.closest().nextSibling.id].locked = value;
    } else {
      expect_groups[stub.target.closest().nextSibling.id].starred = !value;
      localStorage.setItem("groups", JSON.stringify(expect_groups));
      expect_groups[stub.target.closest().nextSibling.id].starred = value;

      if (value) {
        expect_groups[stub.target.closest().nextSibling.id].locked = true;
        const new_groups = JSON.stringify(expect_groups).replace("group-9", "group-2").replace("group-10", "group-3");
        expect_groups = JSON.parse(new_groups);
      }
    }

    jest.clearAllMocks();

    GroupFunc.toggleGroup(stub, type, mockSet);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: expect_groups, scroll: 0 }, anything);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockSet.mock.calls.pop()[0])).toStrictEqual(expect_groups);
  });
});

describe("sendMessage", () => {
  it.each([
    ["all", 0],
    ["all", 1],
    ["left", 0],
    ["left", 1],
    ["right", 0],
    ["right", 1],
  ])("sends a message to background script with correct parameters -> %s (id: %i)", (dir, id) => {
    var selector = `.merge-${dir}-btn`.replace("all-", "");
    jest.clearAllMocks();

    fireEvent.click(container.querySelectorAll(selector)[id]);

    expect(chromeRuntimeSendMessageSpy).toHaveBeenCalledWith(chrome.runtime.id, { msg: dir, id: "group-" + id });
  });
});
