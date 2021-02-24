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

import { render, waitFor, act } from "@testing-library/react";
import { toast } from "react-toastify";

import * as AppFunc from "../../src/components/App/App_functions";
import * as AppHelper from "../../src/components/App/App_helpers";
import * as GroupFunc from "../../src/components/Group/Group_functions";

import App from "../../src/components/App/App";
import Group from "../../src/components/Group/Group";
import Tab from "../../src/components/Tab/Tab";

const anything = expect.any(Function);
var container, sync_node, syncLimitIndicationSpy, toastSpy;

beforeAll(() => {
  jest.spyOn(GroupFunc, "setBGColor").mockImplementation(() => {});
  syncLimitIndicationSpy = jest.spyOn(AppFunc, "syncLimitIndication").mockImplementation(() => {});
  toastSpy = toast.mockImplementation((...args) => args);
});

beforeEach(() => {
  Object.keys(init_groups).forEach((key) => {
    sessionStorage.setItem(key, JSON.stringify(init_groups[key]));
  });

  localStorage.setItem("groups", JSON.stringify(init_groups));

  container = render(<App />).container;
  sync_node = container.querySelector("#sync-text span");

  jest.clearAllMocks();
});

afterAll(() => {
  syncLimitIndicationSpy.mockRestore();
  toastSpy.mockRestore();
});

describe("badgeIconInfo", () => {
  const COLORS = { green: "#060", yellow: "#CC0", orange: "#C70", red: "#C00" };

  test.each([
    [0, COLORS.green, false, false],
    [0, COLORS.green, false, true],
    [1, COLORS.green, false, false],
    [20, COLORS.green, false, false],
    [25, COLORS.yellow, false, false],
    [40, COLORS.yellow, false, false],
    [50, COLORS.orange, false, false],
    [60, COLORS.orange, false, false],
    [75, COLORS.red, false, false],
    [80, COLORS.red, false, true],
    [80, COLORS.red, true, false],
  ])("color, text, and title are correct for %s tabs", (num_tabs, color, one_group, display) => {
    const expected_text = display && num_tabs > 0 ? `${num_tabs}|${one_group ? 1 : 4}` : "";
    const expected_title = num_tabs > 0 ? `You currently have ${num_tabs} ${num_tabs === 1 ? "tab" : "tabs"} in ${one_group ? 1 + " group" : 4 + " groups"}`: "Merge your tabs into groups"; // prettier-ignore

    if (one_group) {
      localStorage.setItem("groups", JSON.stringify({ "group-0": CONSTANTS.DEFAULT_GROUP }));
    }
    sessionStorage.setItem("settings", JSON.stringify({ badgeInfo: display ? "display" : "hide" }));
    jest.clearAllMocks();

    AppFunc.badgeIconInfo(num_tabs, user);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(chromeBrowserActionSetBadgeTextSpy).toHaveBeenCalledTimes(1);
    expect(chromeBrowserActionSetBadgeTextSpy).toHaveBeenCalledWith({ text: expected_text }, anything);

    expect(chromeBrowserActionSetBadgeBackgroundColorSpy).toHaveBeenCalledTimes(1);
    expect(chromeBrowserActionSetBadgeBackgroundColorSpy).toHaveBeenCalledWith({ color }, anything);

    expect(chromeBrowserActionSetTitleSpy).toHaveBeenCalledTimes(1);
    expect(chromeBrowserActionSetTitleSpy).toHaveBeenCalledWith({ title: expected_title }, anything);
  });

  it("does nothing if there are no groups in local storage", () => {
    localStorage.removeItem("groups");
    jest.clearAllMocks();

    AppFunc.badgeIconInfo(10, user);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

    expect(chromeBrowserActionSetBadgeTextSpy).toHaveBeenCalledTimes(1);
    expect(chromeBrowserActionSetBadgeTextSpy).toHaveBeenCalledWith({ text: "" }, anything);

    expect(chromeBrowserActionSetTitleSpy).toHaveBeenCalledTimes(1);
    expect(chromeBrowserActionSetTitleSpy).toHaveBeenCalledWith({ title: "Merge your tabs into groups" }, anything);

    expect(chromeBrowserActionSetBadgeBackgroundColorSpy).not.toHaveBeenCalled();
  });
});

describe("storageInit", () => {
  test("sync settings are null & local groups are null", () => {
    sessionStorage.clear();
    localStorage.clear();
    localStorage.setItem("tour_needed", true);
    jest.clearAllMocks();

    AppFunc.storageInit(sync_node, mockSet, mockSet, mockSet);
    localStorage.removeItem("tour_needed");

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith(null, anything);

    expect(chromeSyncSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncSetSpy).toHaveBeenCalledWith({ settings: CONSTANTS.DEFAULT_SETTINGS }, anything);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith(["groups", "tour_needed"], anything);

    expect(chromeLocalRemoveSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalRemoveSpy).toHaveBeenCalledWith(["groups"], anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: { "group-0": CONSTANTS.DEFAULT_GROUP }, groups_copy: [], scroll: 0, tour_needed: false }, anything); // prettier-ignore

    expect(mockSet).toHaveBeenCalledTimes(3);

    expect(toggleDarkModeSpy).toHaveBeenCalledTimes(1);
    expect(toggleDarkModeSpy).toHaveBeenCalledWith(true);
  });

  test("tour is needed", () => {
    localStorage.removeItem("groups");
    localStorage.setItem("tour_needed", false);
    jest.clearAllMocks();

    AppFunc.storageInit(sync_node, mockSet, mockSet, mockSet);
    localStorage.setItem("tour_needed", true);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: TUTORIAL_GROUP, groups_copy: [], scroll: 0, tour_needed: true }, anything); // prettier-ignore
  });

  test("sync settings exist & sync group-0 is null", () => {
    sessionStorage.setItem("group-0", null);
    sessionStorage.setItem("settings", JSON.stringify({ dark: true }));
    jest.clearAllMocks();

    AppFunc.storageInit(sync_node, mockSet, mockSet, mockSet);

    expect(chromeSyncSetSpy).not.toHaveBeenCalled();

    expect(toggleDarkModeSpy).toHaveBeenCalledTimes(1);
    expect(toggleDarkModeSpy).toHaveBeenCalledWith(true);

    expect(toggleSyncTimestampSpy).not.toHaveBeenCalled();
  });

  test("sync group-0 exists & local groups exist", () => {
    sessionStorage.setItem("group-0", 1);
    localStorage.setItem("groups", JSON.stringify(init_groups));
    jest.clearAllMocks();

    AppFunc.storageInit(sync_node, mockSet, mockSet, mockSet);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: init_groups, groups_copy: [], scroll: 0, tour_needed: false}, anything); // prettier-ignore
    expect(mockSet).toHaveBeenCalledTimes(3);

    expect(toggleSyncTimestampSpy).toHaveBeenCalledTimes(1);
    expect(toggleSyncTimestampSpy).toHaveBeenCalledWith(true, sync_node);
  });
});

describe("resetTutorialChoice", () => {
  var elementMutationListenerSpy;
  afterAll(() => elementMutationListenerSpy.mockRestore());

  it.each([[true], [false], [null]])(
    "sets the tour state properly or opens official homepage correctly - response === %s",
    async (response) => {
      document.body.innerHTML = `<div id="need-btn" response=${response ? "negative" : "positive"}/div>`;
      var element = document.querySelector("#need-btn");
      var stub = { target: { closest: (arg) => arg !== "" && element } };
      const url = "TabMerger_Site";
      const mockSetTour = jest.fn(), mockSetDialog = jest.fn(); // prettier-ignore
      global.open = jest.fn();

      // if user clicks the modal's "x" then there is no response, in this case need to switch mutation type to avoid calling cb logical statement
      if (response === null) {
        elementMutationListenerSpy = jest.spyOn(AppHelper, "elementMutationListener").mockImplementation((_, cb) => {
          var mutation = {};
          mutation.type = { attributes: false, childList: true, subtree: false };
          cb(mutation);
        });
      }

      AppFunc.resetTutorialChoice(stub, url, mockSetTour, mockSetDialog);
      if (response !== null) {
        element.setAttribute("response", response ? "positive" : "negative");
      }

      expect(mockSetDialog).toHaveBeenCalledWith(CONSTANTS.RESET_TUTORIAL_CHOICE_DIALOG(element));

      await waitFor(() => {
        if (element.getAttribute("response") === "positive") {
          expect(mockSetTour).toHaveBeenCalledWith(true);
          expect(open).not.toHaveBeenCalled();
        } else if (response !== null) {
          expect(mockSetTour).not.toHaveBeenCalled();
          expect(open).toHaveBeenCalledWith(url, "_blank", "noreferrer");
        } else {
          expect(mockSetTour).not.toHaveBeenCalled();
          expect(open).not.toHaveBeenCalled();
        }
      });

      expect.assertions(response ? 4 : response === false ? 5 : 3);
    }
  );
});

describe("syncWrite", () => {
  var stub = (ret_val) => ({
    target: {
      closest: (arg) =>
        arg === "#sync-write-btn" && { classList: { contains: (arg) => arg === "disabled-btn" && ret_val } },
    },
  });

  it("toasts if user subscription is Free Tier", () => {
    jest.clearAllMocks();

    AppFunc.syncWrite(stub(false), sync_node, { paid: false });

    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveReturnedWith([...CONSTANTS.SUBSCRIPTION_TOAST]);
  });

  it("toasts if either sync limit is exceeded", () => {
    jest.clearAllMocks();

    AppFunc.syncWrite(stub(true), sync_node, user);

    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveReturnedWith([...CONSTANTS.SYNC_WRITE_TOAST]);
  });

  it("does nothing when no groups in local storage", () => {
    jest.clearAllMocks();

    AppFunc.syncWrite(stub(false), sync_node, user);

    expect(chromeSyncSetSpy).not.toHaveBeenCalled();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("does nothing when no tabs in TabMerger and only default group is made", () => {
    localStorage.setItem("groups", JSON.stringify({ "group-0": CONSTANTS.DEFAULT_GROUP }));
    jest.clearAllMocks();

    AppFunc.syncWrite(stub(false), sync_node, user);

    expect(chromeSyncSetSpy).not.toHaveBeenCalled();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it.each([["less"], ["more"]])("calls the correct functions when %s groups", async (num_groups) => {
    if (num_groups === "more") {
      var current_groups = JSON.parse(localStorage.getItem("groups"));
      current_groups["group-4"] = CONSTANTS.DEFAULT_GROUP;
      localStorage.setItem("groups", JSON.stringify(current_groups));
    } else {
      // to simulate having to remove extras, since less groups now
      localStorage.setItem("groups", JSON.stringify({ "group-0": init_groups["group-0"] }));
    }
    jest.clearAllMocks();

    AppFunc.syncWrite(stub(false), sync_node, user);

    await waitFor(() => {
      expect(chromeLocalGetSpy).toHaveBeenCalledTimes(2);
      expect(chromeLocalGetSpy).toHaveBeenNthCalledWith(1, "groups", anything);
      expect(chromeLocalGetSpy).toHaveBeenNthCalledWith(2, "last_sync", anything); // from App_helpers.js (toggleSyncTimestamp)

      expect(chromeSyncGetSpy).toHaveBeenCalledTimes(num_groups === "more" ? 6 : 2);
      expect(chromeSyncGetSpy).toHaveBeenNthCalledWith(1, "group-0", anything);
      expect(chromeSyncGetSpy).toHaveBeenNthCalledWith(num_groups === "more" ? 6 : 2, null, anything);

      num_groups === "more" ? expect(chromeSyncSetSpy).toHaveBeenCalledTimes(1): expect(chromeSyncSetSpy).not.toHaveBeenCalled(); // prettier-ignore

      expect(chromeSyncRemoveSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncRemoveSpy).toHaveBeenCalledWith(num_groups === "more" ? [] : Object.keys(init_groups).splice(1), anything); // prettier-ignore

      expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalSetSpy).toHaveBeenCalledWith({ last_sync: expect.any(String) }, anything);

      expect(toggleSyncTimestampSpy).toHaveBeenCalledTimes(1);
      expect(toggleSyncTimestampSpy).toHaveBeenCalledWith(true, sync_node);

      expect(toastSpy).not.toHaveBeenCalled();
    });

    expect.hasAssertions();
  });
});

describe("syncRead", () => {
  it("does nothing when no groups in sync storage", () => {
    sessionStorage.clear();
    jest.clearAllMocks();

    AppFunc.syncRead(sync_node, user, mockSet, mockSet, mockSet);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith(null, anything);

    expect(mockSet).not.toHaveBeenCalled();
    expect(toggleSyncTimestampSpy).not.toHaveBeenCalled();
  });

  it("calls the correct functions", () => {
    const new_ss_item = {
      "group-0": init_groups["group-0"],
      "group-1": init_groups["group-1"],
    };

    sessionStorage.clear();
    sessionStorage.setItem("group-0", JSON.stringify(init_groups["group-0"]));
    sessionStorage.setItem("group-1", JSON.stringify(init_groups["group-1"]));
    jest.clearAllMocks();

    AppFunc.syncRead(sync_node, user, mockSet, mockSet, mockSet);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncRemoveSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncRemoveSpy).toHaveBeenCalledWith(["group-0", "group-1"], anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalRemoveSpy).toHaveBeenCalledTimes(1);

    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: new_ss_item, scroll: 0 }, anything);
    expect(chromeLocalRemoveSpy).toHaveBeenCalledWith(["groups"], anything);

    expect(toggleSyncTimestampSpy).toHaveBeenCalledTimes(1);
    expect(toggleSyncTimestampSpy).toHaveBeenCalledWith(false, sync_node);

    expect(mockSet).toHaveBeenCalledTimes(2);
    expect(mockSet).toHaveBeenNthCalledWith(1, JSON.stringify(new_ss_item));
    expect(mockSet).toHaveBeenNthCalledWith(2, AppHelper.getTabTotal(new_ss_item));
  });
});

describe("openOrRemoveTabs", () => {
  var tab_single = ["https://stackoverflow.com/"];
  var tab_group = [...tab_single, "https://lichess.org/", "https://www.chess.com/"];
  var tab_all = [...tab_group, "https://www.twitch.tv/", "https://www.reddit.com/", "https://www.a.com/", "https://www.b.com/"]; // prettier-ignore
  const tab_arr_map = { SINGLE: tab_single, GROUP: tab_group, ALL: tab_all };

  var open_tabs;
  beforeEach(() => {
    open_tabs = [
      { active: true, id: 0, pinned: false, url: location.href + "a" },
      { active: false, id: 1, pinned: false, url: location.href + "b" },
      { active: false, id: 2, pinned: false, url: location.href + "c" },
    ];
    sessionStorage.setItem("open_tabs", JSON.stringify(open_tabs));

    jest.clearAllMocks();
  });

  afterEach(() => {
    sessionStorage.removeItem("open_tabs");
  });

  it("does nothing when namespace is not 'local'", () => {
    AppFunc.openOrRemoveTabs({}, "sync", mockSet, mockSet);

    expect(chromeTabsMoveSpy).not.toHaveBeenCalled();
    expect(chromeTabsCreateSpy).not.toHaveBeenCalled();
    expect(chromeSyncGetSpy).not.toHaveBeenCalled();
    expect(chromeLocalGetSpy).not.toHaveBeenCalled();
    expect(chromeLocalSetSpy).not.toHaveBeenCalled();
    expect(chromeLocalRemoveSpy).not.toHaveBeenCalled();
  });

  test.each([
    ["KEEP", "WITHOUT", "UNLOCKED", "SINGLE", 7],
    ["KEEP", "WITHOUT", "UNLOCKED", "GROUP", 7],
    ["KEEP", "WITHOUT", "UNLOCKED", "ALL", 7],
    ["REMOVE", "WITH", "LOCKED", "SINGLE", 7],
    ["REMOVE", "WITH", "LOCKED", "GROUP", 7],
    ["REMOVE", "WITH", "LOCKED", "ALL", 3],
    ["REMOVE", "WITH", "UNLOCKED", "SINGLE", 6],
    ["REMOVE", "WITH", "UNLOCKED", "GROUP", 4],
    ["REMOVE", "WITH", "UNLOCKED", "ALL", 0],
  ])(
    "opens the correct tab (not open) | restore = %s | %s removing | locked = %s | %s",
    (keepOrRemove, _, locked, type, expected_tabs_left) => {
      // ARRANGE
      var stub = { remove: { newValue: [type !== "ALL" ? "group-0" : null, ...tab_arr_map[type]] } };
      var expect_open_tabs = [...open_tabs, ...tab_arr_map[type].map((url) => ({ active: false, pinned: false, url }))];

      sessionStorage.setItem("settings", JSON.stringify({ restore: keepOrRemove.toLowerCase(), tooltipVisibility: false })); // prettier-ignore

      var expected_groups = JSON.parse(localStorage.getItem("groups")); // only used in remove case
      expected_groups["group-0"].locked = locked === "LOCKED";
      localStorage.setItem("groups", JSON.stringify(expected_groups));
      if (locked === "UNLOCKED") {
        if (type === "SINGLE") {
          expected_groups["group-0"].tabs.shift();
        } else if (type === "GROUP") {
          expected_groups["group-0"].tabs = [];
        } else {
          Object.keys(expected_groups).forEach((key) => {
            expected_groups[key].tabs = [];
          });
        }
      } else {
        // only group-0 is locked
        if (type === "ALL") {
          Object.keys(expected_groups).forEach((key) => {
            if (key !== "group-0") {
              expected_groups[key].tabs = [];
            }
          });
        }
      }

      jest.clearAllMocks();

      // ACT
      AppFunc.openOrRemoveTabs(stub, "local", mockSet, mockSet);

      // ASSERT
      expect(chromeTabsMoveSpy).not.toHaveBeenCalled();

      expect(chromeTabsCreateSpy).toHaveBeenCalledTimes(tab_arr_map[type].length);
      tab_arr_map[type].forEach((url) => {
        expect(chromeTabsCreateSpy).toHaveBeenCalledWith({ active: false, pinned: false, url }, anything);
      });

      expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

      expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

      expect(chromeTabsQuerySpy).toHaveBeenCalledTimes(1);
      expect(chromeTabsQuerySpy).toHaveBeenCalledWith({ currentWindow: true }, anything);

      if (keepOrRemove === "KEEP") {
        expect(chromeLocalSetSpy).not.toHaveBeenCalled();
      } else {
        expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
        expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: expected_groups, scroll: 0 }, anything);

        expect(mockSet).toHaveBeenCalledTimes(2);
        expect(mockSet).toHaveBeenNthCalledWith(1, expected_tabs_left);
        expect(mockSet).toHaveBeenNthCalledWith(2, JSON.stringify(expected_groups));
      }

      expect(chromeLocalRemoveSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalRemoveSpy).toHaveBeenCalledWith(["remove"], anything);

      expect(JSON.parse(sessionStorage.getItem("open_tabs"))).toStrictEqual(expect_open_tabs);
    }
  );

  test("restore already open - opens the correct tabs MOVING them to correct position in array", () => {
    var expect_open_tabs = [open_tabs[2], open_tabs[0], open_tabs[1]];
    var stub = { remove: { newValue: ["group-0", open_tabs[0].url, open_tabs[1].url] } };

    sessionStorage.setItem("settings", JSON.stringify({ restore: "remove" }));

    // add new tabs that are also open
    var current_groups = JSON.parse(localStorage.getItem("groups"));
    current_groups["group-0"].tabs.push({ url: open_tabs[0].url, title: "already open a" });
    current_groups["group-0"].tabs.push({ url: open_tabs[1].url, title: "already open b" });
    localStorage.setItem("groups", JSON.stringify(current_groups));

    jest.clearAllMocks();

    AppFunc.openOrRemoveTabs(stub, "local", mockSet, mockSet);

    expect(chromeTabsMoveSpy).toHaveBeenCalledTimes(2);
    expect(chromeTabsMoveSpy).toHaveBeenNthCalledWith(1, 0, { index: -1 });
    expect(chromeTabsMoveSpy).toHaveBeenNthCalledWith(2, 1, { index: -1 });

    expect(JSON.parse(sessionStorage.getItem("open_tabs"))).toStrictEqual(expect_open_tabs) // prettier-ignore
  });

  it.each([
    ["✅", "❌", true],
    ["❌", "✅", false],
  ])("does nothing for namespace %s, changes length %s violation", (_, __, namespace_violation) => {
    jest.clearAllMocks();

    if (namespace_violation) {
      AppFunc.openOrRemoveTabs({ remove: { newValue: [1] } }, "sync", mockSet, mockSet);
    } else {
      AppFunc.openOrRemoveTabs({ remove: { newValue: [] } }, "local", mockSet, mockSet);
    }

    expect(chromeSyncGetSpy).not.toHaveBeenCalled();
    expect(chromeLocalGetSpy).not.toHaveBeenCalled();
    expect(chromeTabsQuerySpy).not.toHaveBeenCalled();
    expect(chromeTabsMoveSpy).not.toHaveBeenCalled();
    expect(chromeTabsCreateSpy).not.toHaveBeenCalled();
    expect(chromeLocalSetSpy).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
    expect(chromeLocalRemoveSpy).not.toHaveBeenCalled();
  });
});

// note that duplicate removal is made in background script!
describe("checkMerging", () => {
  var merge_all = [
    { id: 0, pinned: false, title: "merged tab a", url: location.href + "a" },
    { id: 1, pinned: false, title: "merged tab b", url: location.href + "b" },
    { id: 2, pinned: false, title: "merged tab c", url: location.href + "c" },
  ];

  it.each([
    ["✅", "❌", true],
    ["❌", "✅", false],
  ])("does nothing for namespace %s, changes length %s violation", (_, __, namespace_violation) => {
    localStorage.setItem("client_details", JSON.stringify(user));
    jest.clearAllMocks();

    if (namespace_violation) {
      AppFunc.checkMerging({ merged_tabs: { newValue: [1] } }, "sync", mockSet, mockSet);
    } else {
      AppFunc.checkMerging({ merged_tabs: { newValue: [] } }, "local", mockSet, mockSet);
    }

    expect(chromeLocalGetSpy).not.toHaveBeenCalled();
    expect(chromeLocalSetSpy).not.toHaveBeenCalled();
    expect(chromeTabsRemoveSpy).not.toHaveBeenCalled();
    expect(chromeLocalRemoveSpy).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  test.each([
    [false, "merge", "group-1", "full"],
    [false, "leave", "group-1", "full"],
    [false, "leave", "context", "full"],
    [false, "leave", "context", "empty"],
    [true, "merge", "group-1", "full"],
    [true, "merge", "group-1", "full"],
  ])(
    "merge all and none exist in TabMerger - exceeding: %s, merge: %s, into: %s, group-0: %s",
    (exceeding, merge_setting, into_group, top_group) => {
      var stub = { merged_tabs: { newValue: merge_all } };

      var current_groups = JSON.parse(JSON.stringify(init_groups));
      if (top_group === "empty") {
        current_groups["group-0"].tabs = [];
      }

      // need to have at least 15 tabs to exceed Free Tier
      if (exceeding) {
        var tabs_to_exceed = [];
        for (var i = 0; i < 10; i++) {
          tabs_to_exceed.push({ pinned: false, title: "Extra Tab", url: "http://www.example.com" });
        }
        current_groups["group-1"].tabs = tabs_to_exceed;
      }

      localStorage.setItem("groups", JSON.stringify(current_groups));
      localStorage.setItem("into_group", into_group);
      localStorage.setItem("merged_tabs", JSON.stringify(merge_all));
      sessionStorage.setItem("open_tabs", JSON.stringify(merge_all));
      localStorage.setItem("client_details", JSON.stringify(!exceeding ? user : { tier: "Free" }));
      sessionStorage.setItem("settings", JSON.stringify({ color: CONSTANTS.DEFAULT_GROUP_COLOR, title: CONSTANTS.DEFAULT_GROUP_TITLE, merge: merge_setting })); // prettier-ignore

      var expected_groups = JSON.parse(localStorage.getItem("groups"));
      if (into_group.includes("group")) {
        expected_groups[into_group].tabs = [
          ...expected_groups[into_group].tabs,
          ...merge_all.map((x) => ({ pinned: false, title: x.title, url: x.url })),
        ];
      } else {
        into_group = "group-0";
        if (top_group !== "empty") {
          const group_values = AppHelper.sortByKey(expected_groups);
          expected_groups[into_group] = {
            color: CONSTANTS.DEFAULT_GROUP_COLOR,
            created: AppHelper.getTimestamp(),
            hidden: false,
            locked: false,
            starred: false,
            tabs: merge_all.map((x) => ({ pinned: x.pinned, title: x.title, url: x.url })),
            title: CONSTANTS.DEFAULT_GROUP_TITLE,
          };

          group_values.forEach((val, i) => {
            expected_groups["group-" + (i + 1)] = val;
          });
        } else {
          expected_groups["group-0"].tabs = merge_all.map((x) => ({ pinned: x.pinned, title: x.title, url: x.url }));
        }
      }

      var expected_tabs_num = 0;
      Object.values(expected_groups).forEach((val) => {
        expected_tabs_num += val.tabs.length;
      });

      var current_settings = JSON.parse(sessionStorage.getItem("settings"));
      current_settings.merge = merge_setting;
      sessionStorage.setItem("settings", JSON.stringify(current_settings));

      jest.clearAllMocks();

      AppFunc.checkMerging(stub, "local", mockSet, mockSet);

      expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

      expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalGetSpy).toHaveBeenCalledWith(["merged_tabs", "into_group", "groups", "client_details"], anything); // prettier-ignore

      if (!exceeding) {
        if (merge_setting === "merge") {
          expect(chromeTabsRemoveSpy).toHaveBeenCalledTimes(1);
          expect(chromeTabsRemoveSpy).toHaveBeenCalledWith([0, 1, 2]);
        }

        expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
        expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: expected_groups, scroll: 0 }, anything);

        expect(mockSet).toHaveBeenCalledTimes(2);
        expect(mockSet).toHaveBeenNthCalledWith(1, expected_tabs_num);
        expect(mockSet).toHaveBeenNthCalledWith(2, JSON.stringify(expected_groups));

        expect(sessionStorage.getItem("open_tabs")).toBe(merge_setting === "merge" ? "[]" : JSON.stringify(merge_all));
      } else {
        expect(chromeTabsRemoveSpy).not.toHaveBeenCalled();
        expect(chromeLocalSetSpy).not.toHaveBeenCalled();
        expect(mockSet).not.toHaveBeenCalled();

        expect(sessionStorage.getItem("open_tabs")).toBe(JSON.stringify(merge_all));

        expect(toastSpy).toHaveBeenCalledTimes(1);
        expect(toastSpy).toHaveReturnedWith(CONSTANTS.CHECK_MERGING_TOAST(!exceeding ? user.tier : "Free"));
      }

      expect(chromeLocalRemoveSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalRemoveSpy).toHaveBeenCalledWith(["into_group", "merged_tabs"], anything);
    }
  );
});

describe("groupFormation", () => {
  it("returns null when group is undefined", () => {
    const result = AppFunc.groupFormation(undefined);

    expect(result).toBeNull();
  });

  it.each([
    ["start", 15],
    ["middle", 15],
    ["end", 15],
    ["start", 10],
    [null, 4],
  ])(
    "return the correct group components when inputs are defined - defaults exist = %s (num_groups = %s)",
    (defaults_available, num_groups) => {
      Math.random = jest.fn(() => 0.5);
      var result, current_groups;
      if (num_groups >= 10) {
        current_groups = JSON.parse(localStorage.getItem("groups"));
        for (var i = 4; i < num_groups; i++) {
          var new_default_group = JSON.parse(JSON.stringify(CONSTANTS.DEFAULT_GROUP));
          new_default_group.created = AppHelper.getTimestamp();
          if (defaults_available === "start") {
            new_default_group.title = "start";
            new_default_group.color = CONSTANTS.GROUP_COLOR_THRESHOLD;
            new_default_group.created = "11/11/2011 @ 12:12:12";
            new_default_group.tabs = [1];
            new_default_group.name = null;
          } else if (defaults_available === "middle") {
            new_default_group.title = null;
            new_default_group.name = "middle";
          } else {
            new_default_group.title = null;
            new_default_group.name = null;
            new_default_group.color = null;
          }
          current_groups["group-" + i] = new_default_group;
        }
      } else {
        current_groups = JSON.parse(JSON.stringify(init_groups));
      }

      result = AppFunc.groupFormation(JSON.stringify(current_groups));

      const expected_result = [
        /* prettier-ignore */
        <Group id="group-0" title="Chess" textColor="primary" color="#d6ffe0" created="11/12/2020 @ 22:13:24" num_tabs={3} hidden={false} locked={false} starred={false} key={Math.random()}>
          <Tab id="group-0" hidden={false} textColor="primary" />
        </Group>,
        /* prettier-ignore */
        <Group id="group-1" title="Social" textColor="primary" color="#c7eeff" created="11/12/2020 @ 22:15:11" num_tabs={2} hidden={false} locked={false} starred={false} key={Math.random()}>
          <Tab id="group-1" hidden={false} textColor="primary" />
        </Group>,
        /* prettier-ignore */
        <Group id="group-2" title={num_groups > 10 ? "B" : "A"} textColor="light" color={num_groups > 10 ? "#456456" : "#123123"} created={num_groups > 10 ? "10/09/2021 @ 12:11:10" : "01/01/2021 @ 12:34:56"} num_tabs={1} hidden={false} locked={false} starred={false} key={Math.random()}>
          <Tab id="group-2" hidden={false} textColor="light" />
        </Group>,
        /* prettier-ignore */
        <Group id="group-3" title={num_groups > 10 ? "A" : "B"} textColor="light" color={num_groups > 10 ? "#123123" : "#456456"} created={num_groups > 10 ? "01/01/2021 @ 12:34:56" : "10/09/2021 @ 12:11:10"} num_tabs={1} hidden={false} locked={false} starred={false} key={Math.random()}> 
          <Tab id="group-3" hidden={false} textColor="light" />
        </Group>,
      ];

      if (num_groups >= 10) {
        for (var i = 4; i < num_groups; i++) {
          const textColor = ["start", "end"].includes(defaults_available) ? "light" : "primary";
          expected_result.push(
            <Group
              id={"group-" + i}
              title={defaults_available !== "end" ? defaults_available : "Title"}
              textColor={textColor}
              color={defaults_available === "start" ? CONSTANTS.GROUP_COLOR_THRESHOLD : CONSTANTS.DEFAULT_GROUP_COLOR}
              created={defaults_available === "start" ? "11/11/2011 @ 12:12:12" : AppHelper.getTimestamp()}
              num_tabs={defaults_available === "start" ? 1 : 0}
              hidden={false}
              locked={false}
              starred={false}
              key={Math.random()}
            >
              <Tab id={"group-" + i} hidden={false} textColor={textColor} />
            </Group>
          );
        }
      }

      expect(result.length).toBe(num_groups);
      expect(JSON.stringify(result)).toBe(JSON.stringify(expected_result));
    }
  );
});

describe("addGroup", () => {
  it.each([["equal"], ["more"]])("warns if group limit exceeded - %s", (type) => {
    // free tier has group limit of 5
    var groups = JSON.parse(JSON.stringify(init_groups));
    groups["group-4"] = CONSTANTS.DEFAULT_GROUP;
    if (type === "more") {
      groups["group-5"] = CONSTANTS.DEFAULT_GROUP;
    }
    localStorage.setItem("groups", JSON.stringify(groups));
    localStorage.setItem("client_details", JSON.stringify({ tier: "Free" }));
    jest.clearAllMocks();

    AppFunc.addGroup(mockSet);

    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveReturnedWith([...CONSTANTS.ADD_GROUP_TOAST(CONSTANTS.USER.Free.NUM_GROUP_LIMIT)]);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith(["groups", "client_details"], anything);

    expect(chromeSyncGetSpy).not.toHaveBeenCalled();
    expect(chromeLocalSetSpy).not.toHaveBeenCalled();
  });

  it("adjusts the groups if limit is not exceeded", () => {
    Object.defineProperty(document.body, "scrollHeight", { writable: true, configurable: true, value: 1000 });

    localStorage.setItem("groups", JSON.stringify(init_groups));
    localStorage.setItem("client_details", JSON.stringify({ tier: "Premium" }));

    var groups = JSON.parse(JSON.stringify(init_groups));
    groups["group-4"] = CONSTANTS.DEFAULT_GROUP;
    groups["group-4"].created = AppHelper.getTimestamp();
    jest.clearAllMocks();

    AppFunc.addGroup(mockSet);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups, scroll: document.body.scrollHeight }, anything);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(JSON.stringify(groups));

    expect(toastSpy).not.toHaveBeenCalled();
  });
});

describe("openAllTabs", () => {
  var elementMutationListenerSpy;
  afterAll(() => elementMutationListenerSpy.mockRestore());

  it.each([[true], [false], [null]])("sets the local storage item correctly - response === %s", async (response) => {
    document.body.innerHTML =
      `<div id="open-all-btn" response=${response ? "negative" : "positive"}>` +
      `  <a class="a-tab" href="www.abc.com"/>` +
      `</div>`;
    var element = document.querySelector("#open-all-btn");
    var stub = { target: { closest: (arg) => arg !== "" && element } };

    var expected_ls = { remove: [null, location.href + "www.abc.com"] };

    localStorage.setItem("groups", JSON.stringify(init_groups));

    // if user clicks the modal's "x" then there is no response, in this case need to switch mutation type to avoid calling cb logical statement
    if (response === null) {
      elementMutationListenerSpy = jest.spyOn(AppHelper, "elementMutationListener").mockImplementation((_, cb) => {
        var mutation = {};
        mutation.type = { attributes: false, childList: true, subtree: false };
        cb(mutation);
      });
    }

    jest.clearAllMocks();

    AppFunc.openAllTabs(stub, mockSet);
    if (response !== null) {
      element.setAttribute("response", response ? "positive" : "negative"); // cause a mutation on the element
    }

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(CONSTANTS.OPEN_ALL_DIALOG(element));

    await waitFor(() => {
      if (response !== null && element.getAttribute("response") === "positive") {
        expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
        expect(chromeLocalSetSpy).toHaveBeenCalledWith(expected_ls, anything);
      } else {
        expect(chromeLocalSetSpy).not.toHaveBeenCalled();
      }
    });

    expect.assertions(response ? 5 : 3);
  });
});

describe("deleteAllGroups", () => {
  const dialogObj = (element) => CONSTANTS.DELETE_ALL_DIALOG(element);

  var elementMutationListenerSpy;
  afterAll(() => elementMutationListenerSpy.mockRestore());

  it.each([[true], [false], [null]])(
    "adjusts local storage to only have locked group and default group underneath if user accepts - groups locked = %s",
    async (locked) => {
      document.body.innerHTML =
        `<div id="delete-all-btn" class="group-item" response="negative">` +
        `  <div class="lock-group-btn" data-tip='${locked ? "unlock" : "lock"}' />` +
        `  <input type='color' value='#000000'/>` +
        `  <div class="created"><span>11/11/2011 @ 11:11:11</span></div>` +
        `  <div class="star-group-btn" data-tip="Star" />` +
        `  <div class="draggable">` +
        `    <a href="https://www.github.com/lbragile/TabMerger">TabMerger</a>` +
        `  </div>` +
        `  <input class="title-edit-input" value='Group Title'/>` +
        `</div>`;

      sessionStorage.setItem("settings", JSON.stringify(CONSTANTS.DEFAULT_SETTINGS));
      localStorage.setItem("groups_copy", JSON.stringify([]));

      var expected_groups = JSON.parse(localStorage.getItem("groups"));
      if (locked) {
        expected_groups["group-0"].locked;
        delete expected_groups["group-10"];
        delete expected_groups["group-9"];
      }
      localStorage.setItem("groups", JSON.stringify(expected_groups));

      var new_entry = locked
        ? {
            "group-0": {
              color: "#000000",
              created: "11/11/2011 @ 11:11:11",
              hidden: false,
              locked: true,
              starred: false,
              tabs: [{ pinned: false, title: "TabMerger", url: "https://www.github.com/lbragile/TabMerger" }],
              title: "Group Title",
            },
            "group-1": CONSTANTS.DEFAULT_GROUP,
          }
        : { "group-0": CONSTANTS.DEFAULT_GROUP };

      var element = document.querySelector("#delete-all-btn");
      var stub = { target: { closest: (arg) => arg !== "" && element } };

      // if user clicks the modal's "x" then there is no response, in this case need to switch mutation type to avoid calling cb logical statement
      if (locked === null) {
        elementMutationListenerSpy = jest.spyOn(AppHelper, "elementMutationListener").mockImplementation((_, cb) => {
          var mutation = {};
          mutation.type = { attributes: false, childList: true, subtree: false };
          cb(mutation);
        });
      }

      new_entry["group-" + +locked].created = AppHelper.getTimestamp();
      jest.clearAllMocks();

      AppFunc.deleteAllGroups(stub, user, mockSet, mockSet, mockSet);
      if (locked !== null) {
        element.setAttribute("response", "positive"); // cause mutation change on element
      }

      // helps prevent flaky tests
      const new_timestamp = AppHelper.getTimestamp();
      if (new_entry["group-" + +locked].created !== new_timestamp) {
        new_entry["group-" + +locked].created = new_timestamp;
      }

      if (locked !== null) {
        await waitFor(() => {
          expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
          expect(chromeLocalGetSpy).toHaveBeenCalledWith(["groups", "groups_copy"], anything);

          expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
          expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

          expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
          expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: new_entry, groups_copy: [expected_groups], scroll: 0 }, anything); // prettier-ignore

          expect(mockSet).toHaveBeenCalledTimes(3);
          expect(mockSet).toHaveBeenNthCalledWith(1, dialogObj(element));
          expect(mockSet).toHaveBeenNthCalledWith(2, +locked);
          expect(mockSet).toHaveBeenNthCalledWith(3, JSON.stringify(new_entry));
        });
      } else {
        await waitFor(() => {
          expect(chromeLocalGetSpy).not.toHaveBeenCalled();
          expect(chromeSyncGetSpy).not.toHaveBeenCalled();
          expect(chromeLocalSetSpy).not.toHaveBeenCalled();

          expect(mockSet).toHaveBeenCalledTimes(1);
          expect(mockSet).toHaveBeenCalledWith(dialogObj(element));
        });
      }

      expect.hasAssertions();
    }
  );

  it("does nothing if user rejects", async () => {
    document.body.innerHTML = `<div id="delete-all-btn" class="group-item" response="positive"/>`;
    var element = document.querySelector("#delete-all-btn");
    var stub = { target: { closest: jest.fn(() => element) } };
    jest.clearAllMocks();

    AppFunc.deleteAllGroups(stub, user, mockSet, mockSet, mockSet);
    element.setAttribute("response", "negative");

    await waitFor(() => {
      expect(chromeSyncGetSpy).not.toHaveBeenCalled();
      expect(chromeLocalSetSpy).not.toHaveBeenCalled();

      expect(mockSet).toHaveBeenCalledTimes(1);
      expect(mockSet).toHaveBeenCalledWith(dialogObj(element));
    });

    expect.hasAssertions();
  });
});

describe("undoDestructiveAction", () => {
  beforeEach(() => {
    localStorage.setItem("groups", JSON.stringify(init_groups));
  });

  test("can undo a state", () => {
    localStorage.setItem("groups_copy", JSON.stringify([init_groups]));
    jest.clearAllMocks();

    AppFunc.undoDestructiveAction(mockSet, mockSet);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith(["groups", "groups_copy"], anything);

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: init_groups, groups_copy: [], scroll: 0 }, anything); // prettier-ignore

    expect(mockSet).toHaveBeenCalledTimes(2);
    expect(mockSet).toHaveBeenNthCalledWith(1, AppHelper.getTabTotal(init_groups));
    expect(mockSet).toHaveBeenNthCalledWith(2, JSON.stringify(init_groups));
  });

  test("can NOT undo a state", () => {
    localStorage.setItem("groups_copy", JSON.stringify([]));
    jest.clearAllMocks();

    AppFunc.undoDestructiveAction(mockSet, mockSet);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith(["groups", "groups_copy"], anything);

    expect(chromeLocalSetSpy).not.toHaveBeenCalled();

    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveReturnedWith([...CONSTANTS.UNDO_DESTRUCTIVE_ACTION_TOAST]);
  });
});

describe("dragOver", () => {
  const offset = 10;
  it.each([
    ["URL_BAR", "URL", 1, window.innerHeight],
    ["START_MIDDLE", "GROUP", 1, window.innerHeight],
    ["END", "GROUP", 2, window.innerHeight / 2],
    ["AFTER", "GROUP", 0, 0],
    ["START_MIDDLE", "TAB", 1, window.innerHeight],
    ["END", "TAB", 2, window.innerHeight / 2],
    ["AFTER", "TAB", 0, 0],
    ["END", "TAB", 0, offset],
    ["END", "TAB", 0, window.innerHeight - offset],
    ["START_MIDDLE", "TAB", 0, null],
  ])("finds the correct after element -> %s, %s", (where, type, tab_num, scroll) => {
    document.body.innerHTML =
      `<div id="tabmerger-container">` +
      `  <div class="group ${type === "GROUP" ? "dragging-group" : ""} id="group-0">` +
      `    <div class="tabs-container">` +
      `      <div class="draggable ${type === "TAB" ? "dragging" : ""}">a</div>` +
      `      <div class="draggable">b</div>` +
      `      <div class="draggable">c</div>` +
      `    </div>` +
      `  </div>` +
      `  <div class="group" id="group-1">` +
      `    <div class="tabs-container">` +
      `      <div class="draggable">d</div>` +
      `      <div class="draggable">e</div>` +
      `      <div class="draggable">f</div>` +
      `    </div>` +
      `  </div>` +
      `  <div class="group" id="group-2">` +
      `    <div class="tabs-container">` +
      `      <div class="draggable">g</div>` +
      `      <div class="draggable">h</div>` +
      `      <div class="draggable">i</div>` +
      `    </div>` +
      `  </div>` +
      `</div>`;

    global.scrollTo = jest.fn();

    var getDragAfterElementSpy = jest.spyOn(AppHelper, "getDragAfterElement").mockImplementation(() => {
      return where !== "AFTER" ? document.querySelectorAll(type === "GROUP" ? ".group" : ".draggable")[tab_num] : null;
    });

    var stub = {
      preventDefault: () => {},
      clientY: scroll,
      target: document.querySelector(type === "GROUP" ? ".group" : ".draggable"),
    };

    const expected_drag_container = stub.target.closest(type === "GROUP" ? "#tabmerger-container" : ".group");

    jest.clearAllMocks();

    AppFunc.dragOver(stub, type.toLowerCase(), scroll ? offset : undefined);

    if (type !== "URL") {
      if (where === "END") {
        expect(scrollTo).not.toHaveBeenCalled();
      } else {
        expect(scrollTo).toHaveBeenCalled();
        expect(scrollTo).toHaveBeenCalledWith(0, stub.clientY);
      }
      expect(getDragAfterElementSpy).toHaveBeenCalledWith(expected_drag_container, stub.clientY, type.toLowerCase());
      if (where !== "AFTER") {
        expect(getDragAfterElementSpy().classList).toContain(type === "GROUP" ? "group" : "draggable");
      } else {
        expect(getDragAfterElementSpy).toHaveReturnedWith(null);
      }
    } else {
      expect(scrollTo).not.toHaveBeenCalled();
      expect(getDragAfterElementSpy).not.toHaveBeenCalled();
    }

    getDragAfterElementSpy.mockRestore();
  });

  test.todo("check ofr actual tab and group manipulation");
});

describe("regexSearchForTab", () => {
  it.each([
    ["group", "NO", "#c", ["none", "none"]],
    ["group", "YES", "#GROUP a", ["", "none"]],
    ["group", "YES", "#group b", ["none", ""]],
    ["group", "YES", "#group", ["", ""]],
    ["tab", "NO", "x", ["none", "", "", "none", "", ""]],
    ["tab", "YES", "tab A", ["", "", "none", "none", "", ""]],
    ["tab", "YES", "tab B", ["", "none", "", "none", "", ""]],
    ["tab", "YES", "tab C", ["none", "", "", "", "", "none"]],
    ["tab", "YES", "tab D", ["none", "", "", "", "none", ""]],
    ["tab", "YES", "tab", ["", "", "", "", "", ""]],
    ["blank", "BACKSPACE_BLANK", "", ["", ""]],
    ["improper", "IMPORPER_SYMBOL", "!", ["none", "none"]],
  ])("works for %s search - %s match (value %s)", (type, _, value, expect_arr) => {
    document.body.innerHTML =
      `<div class="group-item">` +
      `  <input class="title-edit-input" value="GROUP A"/>` +
      `  <div class="draggable"><a href="#" class="a-tab">TAB A</a></div>` +
      `  <div class="draggable"><a href="#" class="a-tab">TAB B</a></div>` +
      `</div>` +
      `<div class="group-item">` +
      `  <input class="title-edit-input" value="GROUP B"/>` +
      `  <div class="draggable"><a href="#" class="a-tab">TAB C</a></div>` +
      `  <div class="draggable"><a href="#" class="a-tab">TAB D</a></div>` +
      `</div>`;

    // need to type first to have the input change
    if (type === "blank") {
      AppFunc.regexSearchForTab({ target: { value: "random" } }, user);
    }
    AppFunc.regexSearchForTab({ target: { value } }, user);

    const targets = [...document.body.querySelectorAll(type === "tab" ? ".draggable, .group-item" : ".group-item")];
    expect(targets.map((x) => x.style.display)).toStrictEqual(expect_arr);
  });
});

describe("resetSearch", () => {
  it("calls timeout and resets the target's value before calling regexSearchForTab", () => {
    var stub = { target: { value: "NOT EMPTY" } };
    jest.useFakeTimers();

    AppFunc.resetSearch(stub);
    jest.advanceTimersByTime(101);

    expect(stub.target.value).toBe("");
  });
});

describe("importJSON", () => {
  it("alerts on wrong non json input", () => {
    const input = { target: { files: [{ type: "application/pdf" }] } };
    jest.clearAllMocks();

    AppFunc.importJSON(input, user, mockSet, mockSet);

    expect(chromeSyncSetSpy).not.toHaveBeenCalled();
    expect(chromeLocalSetSpy).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();

    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveReturnedWith([...CONSTANTS.IMPORT_JSON_TOAST]);
  });

  it("updates sync and local storage on valid input", () => {
    const fakeFile = new File([JSON.stringify(exportedJSON)], "file.json", { type: "application/json" });
    const input = { target: { files: [fakeFile] } };

    jest.spyOn(global, "FileReader").mockImplementation(function () {
      this.readAsText = jest.fn(() => (this.result = JSON.stringify(exportedJSON)));
    });

    var storeDestructiveActionSpy = jest.spyOn(AppHelper, "storeDestructiveAction").mockImplementation(function () {
      return [init_groups];
    });

    jest.clearAllMocks();

    AppFunc.importJSON(input, user, mockSet, mockSet);

    expect(FileReader).toHaveBeenCalledTimes(1);
    const reader = FileReader.mock.instances[0];
    act(() => reader.onload());

    expect(reader.readAsText).toHaveBeenCalledTimes(1);
    expect(reader.readAsText).toHaveBeenCalledWith(fakeFile);
    expect(reader.onload).toEqual(expect.any(Function));

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith(["groups", "groups_copy"], anything);

    expect(chromeSyncSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncSetSpy).toHaveBeenCalledWith({ settings: exportedJSON.settings }, anything);

    delete exportedJSON.settings;

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: exportedJSON, groups_copy: [init_groups], scroll: 0 }, anything); // prettier-ignore

    expect(mockSet).toHaveBeenCalledTimes(2);
    expect(mockSet).toHaveBeenNthCalledWith(1, JSON.stringify(exportedJSON));
    expect(mockSet).toHaveBeenNthCalledWith(2, 20);

    expect(toastSpy).not.toHaveBeenCalled();

    expect(input.target.value).toBe("");

    storeDestructiveActionSpy.mockRestore();
  });
});

describe("exportJSON", () => {
  it("correctly exports a JSON file of the current configuration", () => {
    var chromeDownloadsSetShelfEnabledSpy = jest.spyOn(chrome.downloads, "setShelfEnabled");
    var chromeDownloadsDownloadSpy = jest.spyOn(chrome.downloads, "download");

    var groups = JSON.parse(localStorage.getItem("groups"));
    groups["settings"] = { ...JSON.parse(sessionStorage.getItem("settings")), relativePathBackup: "Test/" };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(groups, null, 2));
    sessionStorage.setItem("settings", JSON.stringify(groups["settings"]));

    const expect_download_opts = {
      url: dataStr,
      filename: "Test/" + AppHelper.outputFileName().replace(/\:|\//g, "_") + ".json",
      conflictAction: "uniquify",
      saveAs: false,
    };

    jest.clearAllMocks();

    AppFunc.exportJSON(false, false);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith(["groups", "client_details"], anything);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

    expect(chromeDownloadsSetShelfEnabledSpy).toHaveBeenCalledTimes(1);
    expect(chromeDownloadsSetShelfEnabledSpy).toHaveBeenCalledWith(false);

    expect(chromeDownloadsDownloadSpy).toHaveBeenCalledTimes(1);
    expect(chromeDownloadsDownloadSpy).toHaveBeenCalledWith(expect_download_opts, anything);
  });
});

describe("getTabMergerLink", () => {
  const chrome_url = "https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc";
  const firefox_url = "https://addons.mozilla.org/en-CA/firefox/addon/tabmerger";
  const edge_url = "https://microsoftedge.microsoft.com/addons/detail/tabmerger/eogjdfjemlgmbblgkjlcgdehbeoodbfn";

  console.error = jest.fn(); // will get error that chrome.storage cannot be called since chrome is set to undefined, but this is expected in this test
  const prevChrome = chrome;

  afterAll(() => {
    chrome = prevChrome;
    console.error.restoreMock();
  });

  /**
   * Allows to change "browser" by specifying the correct userAgent string.
   * @param {string} return_val The value which navigator.userAgent string will be set to.
   * @return navigator.userAgent = return_val
   */
  function changeUserAgent(return_val) {
    navigator.__defineGetter__("userAgent", function () {
      return return_val;
    });
  }

  test.each([
    ["Edge", edge_url],
    ["Chrome", chrome_url],
    ["Firefox", firefox_url],
    ["Opera", undefined],
  ])("correctly sets the link of the TabMerger logo - %s", (browser, expect_link) => {
    if (["Edge", "Chrome"].includes(browser)) {
      changeUserAgent(browser === "Edge" ? "Edg" : "");
    } else if (browser === "Firefox") {
      global.InstallTrigger = "temp";
    } else {
      delete global.InstallTrigger;
      changeUserAgent("RANDOM");
      chrome = undefined;
    }

    expect(AppFunc.getTabMergerLink(false)).toBe(expect_link);
    expect(AppFunc.getTabMergerLink(true)).toBe(expect_link + (browser !== "Firefox" ? "/reviews/" : ""));
  });
});

describe("translate", () => {
  it("returns a translation if avaiable", () => {
    expect(AppFunc.translate("Title")).toEqual("титул");
  });

  it("returns original msg if translation is not available", () => {
    expect(AppFunc.translate("random")).toEqual("random");
  });
});
