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

/* eslint-disable @typescript-eslint/ban-ts-comment */

import { fireEvent, render } from "@testing-library/react";
import { toast } from "react-toastify";

import * as GroupFunc from "../../src/components/Group/Group_functions";
import Group from "../../src/components/Group/Group";

import * as AppHelper from "../../src/components/App/App_helpers";
import { AppProvider } from "../../src/context/AppContext";

import React from "react";

const {
  init_groups,
  mockSet,
  user,
  CONSTANTS,
  chromeLocalGetSpy,
  chromeLocalSetSpy,
  chromeSyncGetSpy,
  chromeTabsQuerySpy,
  chromeTabsRemoveSpy,
  chromeRuntimeSendMessageSpy,
} = global;

const anything = expect.any(Function);
let container: HTMLElement;

/* @ts-ignore */
const toastSpy = toast.mockImplementation((...args) => args);

beforeEach(() => {
  Object.keys(init_groups).forEach((key) => {
    sessionStorage.setItem(key, JSON.stringify(init_groups[key]));
  });
  localStorage.setItem("groups", JSON.stringify(init_groups));

  container = render(
    <AppProvider value={{ user, setTabTotal: mockSet, setGroups: mockSet, setDialog: mockSet }}>
      <React.Fragment>
        <Group
          id="group-0"
          title="GROUP A"
          textColor="primary"
          color="#dedede"
          created="11/11/2020 @ 11:11:11"
          num_tabs={1}
          hidden={false}
          locked={false}
          starred={false}
          fontFamily="Arial"
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
          textColor="primary"
          color="#c7eeff"
          created="22/22/2020 @ 22:22:22"
          num_tabs={1}
          hidden={false}
          locked={false}
          starred={false}
          fontFamily="Arial"
          key={Math.random()}
        >
          <div className="draggable">
            <svg />
            <a className="a-tab mx-1 text-black" href="tab_b_url">
              <span className="pinned">Tab B</span>
            </a>
          </div>
        </Group>
      </React.Fragment>
    </AppProvider>
  ).container;
});

afterAll(() => {
  toastSpy.mockRestore();
});

describe("setBGColor", () => {
  const spy = jest.spyOn(GroupFunc, "setBGColor");

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
    [CONSTANTS.GROUP_COLOR_THRESHOLD, true],
    ["#FF00FF", true],
    ["#000000", false],
  ])("maintains bg color based on existing group bg color (%s) - exists = %s", (color, group_exists) => {
    const stub = {
      previousSibling: {
        querySelector: (arg: string) => arg !== "" && { value: color },
        parentNode: { children: container.querySelectorAll(".group-title, .group") },
      },
    };

    const expect_groups = JSON.parse(localStorage.getItem("groups"));
    if (group_exists) {
      expect_groups["group-0"].color = color;
    }

    jest.clearAllMocks();

    /* @ts-ignore */
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

    const target_mock = {
      target: {
        closest: (arg: string) => arg !== "" && { nextSibling: { id: "group-0" } },
        nextSibling: { style: { visibility: "" } },
        value: "Chess",
      },
    };

    /* @ts-ignore */
    GroupFunc.setTitle(target_mock);
    init_groups["group-0"].title = target_mock.target.value;

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: init_groups, scroll: 0 }, anything);
  });
});

describe("blurOnEnter", () => {
  test.each([["Enter"], ["Temp"]])("keycode === %s", (code) => {
    const stub = { target: { blur: jest.fn() }, code };
    jest.clearAllMocks();

    /* @ts-ignore */
    GroupFunc.blurOnEnter(stub);

    if (code === "Enter") {
      expect(stub.target.blur).toHaveBeenCalledTimes(1);
    } else {
      expect(stub.target.blur).not.toHaveBeenCalled();
    }
  });
});

describe("addTabFromURL", () => {
  it.each([
    ["FAIL", "www.lichess.org/", false],
    ["NOT", "https://stackoverflow.com/", true],
    ["NOT", "https://stackoverflow.com/", false],
    ["", "https://lichess.org/", true],
    ["", "https://lichess.org/", false],
  ])(
    "adds the tab to the correct group when URL does %s exist: %s (settings.merge === %s)",
    (type, url, merge_setting) => {
      const stub = {
        target: { value: url, closest: (arg: string) => arg !== "" && { id: "group-0" }, blur: jest.fn() },
      };

      // move first tab to end to get expected result
      /* @ts-ignore */
      const id = (stub.target.closest() as HTMLDivElement).id;
      const expected_group = JSON.parse(localStorage.getItem("groups"));
      const last_tab = expected_group[id].tabs.shift();
      expected_group[id].tabs.push(last_tab);

      // local must be different from chrome.tabs.query
      const current_groups = JSON.parse(localStorage.getItem("groups"));
      current_groups[id].tabs.shift();
      localStorage.setItem("groups", JSON.stringify(current_groups));

      const partial_expected_tabs = init_groups[id].tabs;
      const open_tabs = partial_expected_tabs.map((x, i) => ({ ...x, id: i }));
      sessionStorage.setItem("open_tabs", JSON.stringify(open_tabs));
      sessionStorage.setItem("settings", JSON.stringify(CONSTANTS.DEFAULT_SETTINGS));

      if (!merge_setting) {
        const current_settings = JSON.parse(sessionStorage.getItem("settings"));
        current_settings.merge = merge_setting;
        sessionStorage.setItem("settings", JSON.stringify(current_settings));
      }

      jest.clearAllMocks();

      jest.useFakeTimers();
      /* @ts-ignore */
      GroupFunc.addTabFromURL(stub, user, mockSet, mockSet);
      jest.advanceTimersByTime(51);

      expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

      expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

      if (type === "" || type === "FAIL") {
        expect(stub.target.value).toBe("");
        expect(stub.target.blur).toHaveBeenCalledTimes(1);

        expect(toastSpy).toHaveBeenCalledTimes(1);
        expect(toastSpy).toHaveReturnedWith([...CONSTANTS.ADD_TAB_FROM_URL_TOAST]);
      } else {
        expect(chromeTabsQuerySpy).toHaveBeenCalledTimes(1);
        expect(chromeTabsQuerySpy).toHaveBeenCalledWith({ status: "complete" }, anything);

        expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
        expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: expected_group, scroll: 0 }, anything);

        expect(mockSet).toHaveBeenCalledTimes(2);
        expect(mockSet).toHaveBeenNthCalledWith(1, 7);
        expect(mockSet).toHaveBeenNthCalledWith(2, JSON.stringify(expected_group));
      }

      if (merge_setting && type === "NOT") {
        expect(chromeTabsRemoveSpy).toHaveBeenCalledTimes(1);
        expect(chromeTabsRemoveSpy).toHaveBeenCalledWith(0);
      } else {
        expect(chromeTabsRemoveSpy).not.toHaveBeenCalled();
      }
    }
  );

  it("toasts if user is Free Tier", () => {
    jest.clearAllMocks();

    /* @ts-ignore */
    GroupFunc.addTabFromURL({}, { paid: false, tier: "Free" }, mockSet, mockSet);

    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveReturnedWith([...CONSTANTS.SUBSCRIPTION_TOAST]);

    expect(chromeLocalGetSpy).not.toHaveBeenCalled();
    expect(chromeSyncGetSpy).not.toHaveBeenCalled();
    expect(chromeTabsQuerySpy).not.toHaveBeenCalled();
    expect(chromeTabsRemoveSpy).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test.todo("ensure the above works for separate windows");
  test.todo("above works with open_tabs not empty");
});

describe("groupDragStart", () => {
  it.each([[true], [false]])("adds class to correct element - tab dragging === %s", (val) => {
    document.body.innerHTML = `<div class="group-item"></div>`;

    const stub = (ret_val: HTMLDivElement) => ({
      target: {
        closest: (arg: string) => {
          if (arg === ".draggable") {
            return ret_val;
          } else if (arg === ".group-item") {
            return document.querySelector(".group-item");
          }
        },
      },
    });

    /* @ts-ignore */
    GroupFunc.groupDragStart(stub(val));

    expect(document.querySelector(".group-item").classList.value).toBe("group-item" + (val ? "" : " dragging-group"));
  });
});

describe("groupDragEnd", () => {
  it.each([[true], [false]])("Drag operation is group === %s", (group_drag) => {
    const classList_arr = ["dragging-group"];
    const stub = {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      preventDefault: () => {},
      target: {
        classList: {
          contains: (arg: string) => arg !== "" && group_drag,
          remove: (arg: string) => arg !== "" && classList_arr.shift(),
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

    document.querySelectorAll = (arg: string) => container.querySelectorAll(arg);
    localStorage.setItem("groups", JSON.stringify(init_groups));
    jest.clearAllMocks();

    /* @ts-ignore */
    GroupFunc.groupDragEnd(stub);

    if (group_drag) {
      expect(classList_arr).toEqual([]);

      expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: expected_groups, scroll: 0 }, anything);

      document.querySelectorAll(".group").forEach((x, i) => expect(x.id).toBe("group-" + i));
      expect.assertions(Object.keys(expected_groups).length + 3);
    } else {
      expect(chromeLocalSetSpy).not.toHaveBeenCalled();
    }
  });
});

describe("openGroup", () => {
  it("forms an array that matches ['group-id', ..., tab_links, ...]", () => {
    /* @ts-ignore */
    chromeLocalSetSpy.mockClear();

    const stub = {
      target: {
        closest: (arg: string) =>
          arg !== "" && {
            nextSibling: {
              querySelectorAll: (arg: string) => arg !== "" && [{ href: "aaa" }, { href: "bbb" }],
              id: "group-0",
            },
          },
      },
    };

    /* @ts-ignore */
    GroupFunc.openGroup(stub);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ remove: ["group-0", "aaa", "bbb"] }, anything);
  });
});

describe("deleteGroup", () => {
  it.each([
    ["locked", "group-1", false],
    ["unlocked", "group-1", false],
    ["unlocked", "group-0", true],
  ])("%s group | id: %s | single group === %s", (locked, group_id, single_group) => {
    const storeDestructiveActionSpy = jest.spyOn(AppHelper, "storeDestructiveAction").mockImplementation((_, groups)=> [groups]); // prettier-ignore
    const mock_target = (group_id: string) => ({
      target: { closest: (arg: string) => arg !== "" && { nextSibling: { id: group_id } } },
    });

    sessionStorage.setItem("settings", JSON.stringify(CONSTANTS.DEFAULT_SETTINGS));
    let expected_groups = JSON.parse(JSON.stringify(init_groups));
    if (single_group) {
      expected_groups = {};
      expected_groups[group_id] = CONSTANTS.DEFAULT_GROUP;
      expected_groups[group_id].created = AppHelper.getTimestamp();
    }

    expected_groups[group_id].locked = locked === "locked";
    let expected_groups_copy = [JSON.parse(JSON.stringify(expected_groups))];

    localStorage.setItem("groups", JSON.stringify(expected_groups));
    localStorage.setItem("groups_copy", JSON.stringify(expected_groups));
    if (!single_group && locked === "unlocked") {
      delete expected_groups[group_id];
      expected_groups_copy = [JSON.parse(JSON.stringify(expected_groups))];
      const ordered_vals = AppHelper.sortByKey(expected_groups);
      expected_groups = {};
      ordered_vals.forEach((val, i) => (expected_groups["group-" + i] = val));
    }

    jest.clearAllMocks();

    /* @ts-ignore */
    GroupFunc.deleteGroup(mock_target(group_id), user, mockSet, mockSet);

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

      expect(toastSpy).toHaveBeenCalledTimes(1);
      expect(toastSpy).toHaveReturnedWith([...CONSTANTS.DELETE_GROUP_TOAST]);
    }

    storeDestructiveActionSpy.mockRestore();
  });
});

describe("toggleGroup", () => {
  test.each([
    ["visibility", true],
    ["lock", true],
    ["star", true],
    ["star", false],
  ])("type === %s | value === %s", (type, value) => {
    const stub = { target: { closest: (arg: string) => arg !== "" && { nextSibling: { id: "group-0" } } } };
    let expect_groups = JSON.parse(localStorage.getItem("groups"));
    /* @ts-ignore */
    const id = stub.target.closest().nextSibling.id;
    if (type === "visibility") {
      expect_groups[id].hidden = value;
    } else if (type === "lock") {
      expect_groups[id].locked = value;
    } else {
      expect_groups[id].starred = !value;
      localStorage.setItem("groups", JSON.stringify(expect_groups));
      expect_groups[id].starred = value;

      if (value) {
        expect_groups[id].locked = true;
        const new_groups = JSON.stringify(expect_groups).replace("group-9", "group-2").replace("group-10", "group-3");
        expect_groups = JSON.parse(new_groups);
      }
    }

    jest.clearAllMocks();

    /* @ts-ignore */
    GroupFunc.toggleGroup(stub, type, mockSet);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: expect_groups, scroll: 0 }, anything);

    expect(mockSet).toHaveBeenCalledTimes(1);
    /* @ts-ignore */
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
    const selector = `.merge-${dir}-btn`.replace("all-", "");
    jest.clearAllMocks();

    fireEvent.click(container.querySelectorAll(selector)[id]);

    expect(chromeRuntimeSendMessageSpy).toHaveBeenCalledWith(chrome.runtime.id, { msg: dir, id: "group-" + id });
  });
});
