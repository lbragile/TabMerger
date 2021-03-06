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

import React from "react";
import { render, waitFor, act } from "@testing-library/react";
import { toast } from "react-toastify";

import App from "@App/App";
import * as AppFunc from "@App/App_functions";
import * as AppHelper from "@App/App_helpers";
import * as GroupFunc from "@Group/Group_functions";

import { DefaultGroup, userType } from "@Typings/common";
import { TabState } from "@Typings/Tab";

const {
  init_groups,
  mockSet,
  user,
  CONSTANTS,
  TUTORIAL_GROUP,
  exportedJSON,
  toggleDarkModeSpy,
  toggleSyncTimestampSpy,
  chromeLocalGetSpy,
  chromeLocalSetSpy,
  chromeSyncGetSpy,
  chromeSyncSetSpy,
  chromeLocalRemoveSpy,
  chromeSyncRemoveSpy,
  chromeTabsRemoveSpy,
  chromeTabsQuerySpy,
  chromeTabsCreateSpy,
  chromeTabsMoveSpy,
  chromeBrowserActionSetTitleSpy,
  chromeBrowserActionSetBadgeTextSpy,
  chromeBrowserActionSetBadgeBackgroundColorSpy,
} = global;

const anything = expect.any(Function);
let container: HTMLElement, sync_node: HTMLSpanElement, toastSpy: () => void;

const mutationMockFn = (_: unknown, cb: (mutation: unknown) => void): void => {
  const mutation = { type: { attributes: false, childList: true, subtree: false } };
  cb(mutation);
};

beforeAll(() => {
  jest.spyOn(Math, "random").mockReturnValue(0.5);
  jest.spyOn(GroupFunc, "setBGColor").mockImplementation(() => undefined);
  jest.spyOn(AppFunc, "syncLimitIndication").mockImplementation(() => undefined);
  /* @ts-ignore */
  toastSpy = toast.mockImplementation((...args) => args);
  console.info = jest.fn();
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
  (toastSpy as jest.Mock).mockRestore();
  jest.spyOn(AppFunc, "syncLimitIndication").mockRestore();
});

describe("setUserStatus", () => {
  const dialogMock = jest.fn();
  AppFunc.setUserStatus(mockSet, dialogMock);

  expect(dialogMock).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(dialogMock.mock.calls.pop()[0])).toBe(JSON.stringify(CONSTANTS.SET_USER_STATUS_DIALOG(mockSet, dialogMock))); // prettier-ignore
});

describe("storeUserDetailsPriorToCheck", () => {
  const dialogMock = jest.fn();
  const [email, password] = ["temp@gmail.com", "temp_pass"];
  const checkUserStatusSpy = jest.spyOn(AppHelper, "checkUserStatus").mockImplementationOnce(() => undefined);

  const stub = {
    target: {
      querySelectorAll: (arg: string) => arg === "input" && [{ value: email }, { value: password }],
    },
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    preventDefault: () => {},
  };

  /* @ts-ignore */
  AppFunc.storeUserDetailsPriorToCheck(stub, mockSet, dialogMock);

  expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
  expect(chromeLocalSetSpy).toHaveBeenCalledWith({ client_details: { email, password } }, anything);

  expect(checkUserStatusSpy).toHaveBeenCalledTimes(1);
  expect(checkUserStatusSpy).toHaveBeenCalledWith(mockSet);

  expect(dialogMock).toHaveBeenCalledTimes(1);
  expect(dialogMock).toHaveBeenCalledWith({ show: false });
});

describe("syncLimitIndication", () => {
  test.each([
    [null, 10000],
    [100, 10000],
    [439, 10000],
    [1000, 10000],
    [1000, 100],
    [1000, 1452],
    [1000, 10000],
  ])("item limt = %s, sync limit = %s", (itemLimit, syncLimit) => {
    jest.spyOn(AppFunc, "syncLimitIndication").mockRestore();

    const querySelector = document.querySelector;
    const prevItemLimit = CONSTANTS.ITEM_STORAGE_LIMIT;
    const prevTotalLimit = CONSTANTS.SYNC_STORAGE_LIMIT;

    localStorage.setItem("groups", JSON.stringify(init_groups));
    localStorage.setItem("client_details", JSON.stringify({ paid: itemLimit && true }));
    if (itemLimit < 1000) {
      localStorage.setItem("scroll", "10");
    } else {
      localStorage.removeItem("scroll");
    }

    CONSTANTS.ITEM_STORAGE_LIMIT = itemLimit;
    CONSTANTS.SYNC_STORAGE_LIMIT = syncLimit;
    jest.clearAllMocks();

    jest.useFakeTimers();
    AppFunc.syncLimitIndication();
    jest.advanceTimersByTime(101);

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith(["groups", "scroll", "client_details"], anything);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

    expect(container).toMatchSnapshot();

    expect(document.documentElement.scrollTop).toEqual(itemLimit < 1000 ? 10 : 0);

    document.querySelector = querySelector;
    CONSTANTS.ITEM_STORAGE_LIMIT = prevItemLimit;
    CONSTANTS.SYNC_STORAGE_LIMIT = prevTotalLimit;
    jest.spyOn(AppFunc, "syncLimitIndication").mockImplementation(() => undefined);
  });
});

describe("toggleHiddenOrEmptyGroups", () => {
  test.each([
    ["before", { paid: false, tier: "Free" }],
    ["after", { paid: "paid", tier: "Basic" }],
    ["before", { paid: "paid", tier: "Standard" }],
    ["after", { paid: "paid", tier: "Premium" }],
  ])("%s user - %s", (when: string, user_type: userType) => {
    document.body.innerHTML = "<div id='sidebar'/>";
    jest.clearAllMocks();

    AppFunc.toggleHiddenOrEmptyGroups(
      when,
      JSON.stringify(user_type).includes("Free") ? { paid: "paid", tier: "Free" } : user
    );

    expect((document.querySelector("#sidebar") as HTMLDivElement).style.visibility).toBe(when === "before" && !JSON.stringify(user_type).includes("Free") ? "hidden" : ""); // prettier-ignore
  });
});

describe("createAutoBackUpAlarm", () => {
  it("creates the sync and json alarms for premium members", () => {
    const alarmGeneratorSpy = jest.spyOn(AppHelper, "alarmGenerator");

    sessionStorage.setItem("settings", JSON.stringify({ periodBackup: 5, syncPeriodBackup: 10 }));
    localStorage.setItem("client_details", JSON.stringify({ tier: "Premium" }));
    jest.clearAllMocks();

    AppFunc.createAutoBackUpAlarm();

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("client_details", anything);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

    expect(alarmGeneratorSpy).toHaveBeenCalledTimes(2);
    expect(alarmGeneratorSpy).toHaveBeenNthCalledWith(1, 5, "json_backup", CONSTANTS.JSON_AUTOBACKUP_OFF_TOAST);
    expect(alarmGeneratorSpy).toHaveBeenNthCalledWith(2, 10, "sync_backup", CONSTANTS.SYNC_AUTOBACKUP_OFF_TOAST);
  });

  it("does nothing for non-premium members", () => {
    const alarmGeneratorSpy = jest.spyOn(AppHelper, "alarmGenerator");

    localStorage.setItem("client_details", null);
    jest.clearAllMocks();

    AppFunc.createAutoBackUpAlarm();

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("client_details", anything);

    expect(chromeSyncGetSpy).not.toHaveBeenCalled();
    expect(alarmGeneratorSpy).not.toHaveBeenCalled();
  });
});

describe("handleUpdate", () => {
  test.each([
    [true, "2.0.0"],
    [false, undefined],
    [false, "0.0.0"],
  ])("production=%s, previousVersion=%s", (production, previousVersion) => {
    localStorage.setItem("ext_version", previousVersion);
    const currentVersion = chrome.runtime.getManifest().version;
    process.env.REACT_APP_PRODUCTION = production.toString();
    jest.clearAllMocks();

    AppFunc.handleUpdate();

    expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalGetSpy).toHaveBeenCalledWith("ext_version", anything);

    if (previousVersion < currentVersion && currentVersion === "2.0.0") {
      expect(toastSpy).toHaveBeenCalledTimes(1);
      expect(toastSpy).toHaveReturnedWith(CONSTANTS.UPDATE_TOAST(previousVersion, currentVersion));
    } else {
      expect(toastSpy).not.toHaveBeenCalled();
    }

    expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeLocalSetSpy).toHaveBeenCalledWith({ ext_version: currentVersion }, anything);
  });
});

describe("storageInit", () => {
  test("sync settings are null & local groups are null", () => {
    sessionStorage.clear();
    localStorage.clear();
    localStorage.setItem("tour_needed", "true");
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
    localStorage.setItem("tour_needed", "false");
    jest.clearAllMocks();

    AppFunc.storageInit(sync_node, mockSet, mockSet, mockSet);
    localStorage.setItem("tour_needed", "true");

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
    sessionStorage.setItem("group-0", "1");
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
  it.each([[true], [false], [null]])(
    "sets the tour state properly or opens official homepage correctly - response === %s",
    async (response) => {
      document.body.innerHTML = `<div id="need-btn" response=${response ? "negative" : "positive"}/div>`;
      const element = document.querySelector("#need-btn");
      const stub = { target: { closest: (arg: string) => arg !== "" && element } };
      const url = "TabMerger_Site";
      const mockSetTour = jest.fn(), mockSetDialog = jest.fn(); // prettier-ignore
      global.open = jest.fn();

      // if user clicks the modal's "x" then there is no response, in this case need to switch mutation type to avoid calling cb logical statement
      if (response === null) {
        (jest.spyOn(AppHelper, "elementMutationListener") as jest.Mock).mockImplementationOnce(mutationMockFn);
      }

      jest.clearAllMocks();
      /* @ts-ignore */
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

      expect.assertions(response ? 5 : response === false ? 7 : 3);
    }
  );
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
    sessionStorage.setItem("settings", JSON.stringify({ badgeInfo: display }));
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

describe("syncWrite", () => {
  const stub = (ret_val: boolean) => ({
    target: {
      closest: (arg: string) =>
        arg === "#sync-write-btn" && { classList: { contains: (arg: string) => arg === "disabled-btn" && ret_val } },
    },
  });

  it("toasts if user subscription is Free Tier", () => {
    jest.clearAllMocks();

    /* @ts-ignore */
    AppFunc.syncWrite(stub(false), sync_node, { paid: false, tier: "Free" });

    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveReturnedWith([...CONSTANTS.SUBSCRIPTION_TOAST]);
  });

  it("toasts if either sync limit is exceeded", () => {
    jest.clearAllMocks();

    /* @ts-ignore */
    AppFunc.syncWrite(stub(true), sync_node, user);

    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveReturnedWith([...CONSTANTS.SYNC_WRITE_TOAST]);
  });

  it("does nothing when no groups in local storage", () => {
    jest.clearAllMocks();

    /* @ts-ignore */
    AppFunc.syncWrite(stub(false), sync_node, user);

    expect(chromeSyncSetSpy).not.toHaveBeenCalled();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("does nothing when no tabs in TabMerger and only default group is made", () => {
    localStorage.setItem("groups", JSON.stringify({ "group-0": CONSTANTS.DEFAULT_GROUP }));
    jest.clearAllMocks();

    /* @ts-ignore */
    AppFunc.syncWrite(stub(false), sync_node, user);

    expect(chromeSyncSetSpy).not.toHaveBeenCalled();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it.each([["less"], ["more"]])("calls the correct functions when %s groups", async (num_groups) => {
    if (num_groups === "more") {
      const current_groups = JSON.parse(localStorage.getItem("groups"));
      current_groups["group-4"] = CONSTANTS.DEFAULT_GROUP;
      localStorage.setItem("groups", JSON.stringify(current_groups));
    } else {
      // to simulate having to remove extras, since less groups now
      localStorage.setItem("groups", JSON.stringify({ "group-0": init_groups["group-0"] }));
    }
    jest.clearAllMocks();

    /* @ts-ignore */
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
  it.each([["no groups in sync storage"], ["free user"]])("does nothing when %s", (test_type) => {
    sessionStorage.clear();
    jest.clearAllMocks();

    AppFunc.syncRead(sync_node, test_type.includes("sync") ? user : { paid: false, tier: "Free" }, mockSet, mockSet);

    if (test_type.includes("sync")) {
      expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncGetSpy).toHaveBeenCalledWith(null, anything);
    } else {
      expect(chromeSyncGetSpy).not.toHaveBeenCalled();
      expect(toastSpy).toHaveBeenCalledTimes(1);
      expect(toastSpy).toHaveReturnedWith(CONSTANTS.SUBSCRIPTION_TOAST);
    }

    expect(chromeLocalRemoveSpy).not.toHaveBeenCalled();
    expect(chromeLocalSetSpy).not.toHaveBeenCalled();
    expect(chromeSyncRemoveSpy).not.toHaveBeenCalled();

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

    AppFunc.syncRead(sync_node, user, mockSet, mockSet);

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
  const tab_single = ["https://stackoverflow.com/"];
  const tab_group = [...tab_single, "https://lichess.org/", "https://www.chess.com/"];
  const tab_all = [...tab_group, "https://www.twitch.tv/", "https://www.reddit.com/", "https://www.a.com/", "https://www.b.com/"]; // prettier-ignore
  const tab_arr_map: { [key: string]: string[] } = { SINGLE: tab_single, GROUP: tab_group, ALL: tab_all };

  let open_tabs: TabState[];
  beforeEach(() => {
    open_tabs = [
      { active: true, id: 0, pinned: false, url: location.href + "a", title: "A" },
      { active: false, id: 1, pinned: false, url: location.href + "b", title: "B" },
      { active: false, id: 2, pinned: false, url: location.href + "c", title: "C" },
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
    [true, "WITHOUT", "UNLOCKED", "SINGLE", 7],
    [true, "WITHOUT", "UNLOCKED", "GROUP", 7],
    [true, "WITHOUT", "UNLOCKED", "ALL", 7],
    [false, "WITH", "LOCKED", "SINGLE", 7],
    [false, "WITH", "LOCKED", "GROUP", 7],
    [false, "WITH", "LOCKED", "ALL", 3],
    [false, "WITH", "UNLOCKED", "SINGLE", 6],
    [false, "WITH", "UNLOCKED", "GROUP", 4],
    [false, "WITH", "UNLOCKED", "ALL", 0],
  ])(
    "opens the correct tab (not open) | restore = %s | %s removing | locked = %s | %s",
    (keepOrRemove, _, locked, type, expected_tabs_left) => {
      // ARRANGE
      const stub = { remove: { newValue: [type !== "ALL" ? "group-0" : null, ...tab_arr_map[type]] } };
      const expect_open_tabs = [
        ...open_tabs,
        ...tab_arr_map[type].map((url: string) => ({ active: false, pinned: false, url })),
      ];

      sessionStorage.setItem("settings", JSON.stringify({ restore: keepOrRemove, tooltipVisibility: false })); // prettier-ignore

      const expected_groups = JSON.parse(localStorage.getItem("groups")); // only used in remove case
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
      tab_arr_map[type].forEach((url: string) => {
        expect(chromeTabsCreateSpy).toHaveBeenCalledWith({ active: false, pinned: false, url }, anything); // prettier-ignore
      });

      expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

      expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalGetSpy).toHaveBeenCalledWith("groups", anything);

      expect(chromeTabsQuerySpy).toHaveBeenCalledTimes(1);
      expect(chromeTabsQuerySpy).toHaveBeenCalledWith({ currentWindow: true }, anything);

      if (keepOrRemove) {
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
    const expect_open_tabs = [open_tabs[2], open_tabs[0], open_tabs[1]];
    const stub = { remove: { newValue: ["group-0", open_tabs[0].url, open_tabs[1].url] } };

    sessionStorage.setItem("settings", JSON.stringify({ restore: false }));

    // add new tabs that are also open
    const current_groups = JSON.parse(localStorage.getItem("groups"));
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
  const merge_all = [
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
    [false, true, "group-1", "full"],
    [false, false, "group-1", "full"],
    [false, false, "context", "full"],
    [false, false, "context", "empty"],
    [true, true, "group-1", "full"],
    [true, true, "group-1", "full"],
  ])(
    "merge all and none exist in TabMerger - exceeding: %s, merge: %s, into: %s, group-0: %s",
    (exceeding, merge_setting, into_group, top_group) => {
      const stub = { merged_tabs: { newValue: merge_all } };

      const current_groups = JSON.parse(JSON.stringify(init_groups));
      if (top_group === "empty") {
        current_groups["group-0"].tabs = [];
      }

      // need to have at least 15 tabs to exceed Free Tier
      if (exceeding) {
        const tabs_to_exceed = [];
        for (let i = 0; i < 10; i++) {
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

      const expected_groups = JSON.parse(localStorage.getItem("groups"));
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

      const expected_tabs_num = AppHelper.getTabTotal(expected_groups);

      const current_settings = JSON.parse(sessionStorage.getItem("settings"));
      current_settings.merge = merge_setting;
      sessionStorage.setItem("settings", JSON.stringify(current_settings));

      jest.clearAllMocks();

      AppFunc.checkMerging(stub, "local", mockSet, mockSet);

      expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

      expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalGetSpy).toHaveBeenCalledWith(["merged_tabs", "into_group", "groups", "client_details"], anything); // prettier-ignore

      if (!exceeding) {
        if (merge_setting) {
          expect(chromeTabsRemoveSpy).toHaveBeenCalledTimes(1);
          expect(chromeTabsRemoveSpy).toHaveBeenCalledWith([0, 1, 2]);
        }

        expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
        expect(chromeLocalSetSpy).toHaveBeenCalledWith({ groups: expected_groups, scroll: 0 }, anything);

        expect(mockSet).toHaveBeenCalledTimes(2);
        expect(mockSet).toHaveBeenNthCalledWith(1, expected_tabs_num);
        expect(mockSet).toHaveBeenNthCalledWith(2, JSON.stringify(expected_groups));

        expect(sessionStorage.getItem("open_tabs")).toBe(merge_setting ? "[]" : JSON.stringify(merge_all));
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

describe("addGroup", () => {
  it.each([["equal"], ["more"]])("warns if group limit exceeded - %s", (type) => {
    // free tier has group limit of 5
    const groups = JSON.parse(JSON.stringify(init_groups));
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

  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])("adjusts the groups if limit is not exceeded - premium=%s, randomize=%s", (premium, randomize) => {
    if (premium && randomize) {
      jest.spyOn(global.Math, "random").mockReturnValue(0.5);
    }

    sessionStorage.setItem("settings", JSON.stringify({ color: randomize ? "#FFE4B5": "#dedede", randomizeColor: randomize, title: "Title" })); // prettier-ignore

    Object.defineProperty(document.body, "scrollHeight", { writable: true, configurable: true, value: 1000 });

    localStorage.setItem("groups", JSON.stringify(init_groups));
    localStorage.setItem("client_details", JSON.stringify({ tier: premium ? "Premium" : "Standard" }));

    const groups = JSON.parse(JSON.stringify(init_groups));
    groups["group-4"] = CONSTANTS.DEFAULT_GROUP;
    groups["group-4"].created = AppHelper.getTimestamp();
    groups["group-4"].color = randomize ? "#FFE4B5" : "#dedede";
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
  it.each([[true], [false], [null]])("sets the local storage item correctly - response === %s", async (response) => {
    document.body.innerHTML =
      `<div id="open-all-btn" response=${response ? "negative" : "positive"}>` +
      `  <a class="a-tab" href="www.abc.com"/>` +
      `</div>`;
    const element = document.querySelector("#open-all-btn");
    const stub = { target: { closest: (arg: string) => arg !== "" && element } };

    const expected_ls = { remove: [null, location.href + "www.abc.com"] };

    localStorage.setItem("groups", JSON.stringify(init_groups));

    // if user clicks the modal's "x" then there is no response, in this case need to switch mutation type to avoid calling cb logical statement
    if (response === null) {
      (jest.spyOn(AppHelper, "elementMutationListener") as jest.Mock).mockImplementationOnce(mutationMockFn);
    }

    jest.clearAllMocks();

    /* @ts-ignore */
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

    expect.assertions(response ? 6 : 3);
  });
});

describe("deleteAllGroups", () => {
  const dialogObj = (element: HTMLButtonElement) => CONSTANTS.DELETE_ALL_DIALOG(element);

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

      const expected_groups = JSON.parse(localStorage.getItem("groups"));
      if (locked) {
        expected_groups["group-0"].locked;
        delete expected_groups["group-10"];
        delete expected_groups["group-9"];
      }
      localStorage.setItem("groups", JSON.stringify(expected_groups));

      const new_entry: { [key: string]: DefaultGroup } = locked
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

      const element = document.querySelector("#delete-all-btn") as HTMLButtonElement;
      const stub = { target: { closest: (arg: string) => arg !== "" && element } };

      // if user clicks the modal's "x" then there is no response, in this case need to switch mutation type to avoid calling cb logical statement
      if (locked === null) {
        (jest.spyOn(AppHelper, "elementMutationListener") as jest.Mock).mockImplementationOnce(mutationMockFn);
      }

      new_entry["group-" + +locked].created = AppHelper.getTimestamp();
      jest.clearAllMocks();

      /* @ts-ignore */
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
    const element = document.querySelector("#delete-all-btn") as HTMLButtonElement;
    const stub = { target: { closest: jest.fn(() => element) } };
    jest.clearAllMocks();

    /* @ts-ignore */
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

    const getDragAfterElementSpy = jest.spyOn(AppHelper, "getDragAfterElement").mockImplementation(() => {
      return where !== "AFTER"
        ? (document.querySelectorAll(type === "GROUP" ? ".group" : ".draggable")[tab_num] as HTMLDivElement)
        : null;
    });

    const stub = {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      preventDefault: () => {},
      clientY: scroll,
      target: document.querySelector(type === "GROUP" ? ".group" : ".draggable"),
    };

    const expected_drag_container = stub.target.closest(type === "GROUP" ? "#tabmerger-container" : ".group");

    jest.clearAllMocks();

    /* @ts-ignore */
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
        /* @ts-ignore */
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
    [true, "group", "NO", "#c", ["none", "none"]],
    [false, "group", "NO", "#c", ["none", "none"]],
    [true, "group", "YES", "#GROUP a", ["", "none"]],
    [true, "group", "YES", "#group b", ["none", ""]],
    [true, "group", "YES", "#group", ["", ""]],
    [true, "tab", "NO", "x", ["none", "", "", "none", "", ""]],
    [true, "tab", "YES", "tab A", ["", "", "none", "none", "", ""]],
    [true, "tab", "YES", "tab B", ["", "none", "", "none", "", ""]],
    [true, "tab", "YES", "tab C", ["none", "", "", "", "", "none"]],
    [true, "tab", "YES", "tab D", ["none", "", "", "", "none", ""]],
    [true, "tab", "YES", "tab", ["", "", "", "", "", ""]],
    [true, "blank", "BACKSPACE_BLANK", "", ["", ""]],
    [true, "improper", "IMPORPER_SYMBOL", "!", ["none", "none"]],
  ])("works for %s search - %s match (value %s)", (paid, type, _, value, expect_arr) => {
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
      /* @ts-ignore */
      AppFunc.regexSearchForTab({ target: { value: "random" } }, paid ? user : { paid });
      jest.clearAllMocks();
    }
    /* @ts-ignore */
    AppFunc.regexSearchForTab({ target: { value } }, paid ? user : { paid });

    if (paid) {
      const targets = [...document.body.querySelectorAll(type === "tab" ? ".draggable, .group-item" : ".group-item")];
      expect(targets.map((x) => (x as HTMLElement).style.display)).toStrictEqual(expect_arr);
    } else {
      expect(toastSpy).toHaveBeenCalledTimes(1);
      expect(toastSpy).toHaveReturnedWith(CONSTANTS.SUBSCRIPTION_TOAST);
    }
  });
});

describe("resetSearch", () => {
  it("calls timeout and resets the target's value before calling regexSearchForTab", () => {
    const stub = { target: { value: "NOT EMPTY" } };

    jest.useFakeTimers();
    /* @ts-ignore */
    AppFunc.resetSearch(stub);
    jest.advanceTimersByTime(101);

    expect(stub.target.value).toBe("");
  });
});

describe("exportJSON", () => {
  it.each([[null], ["Free"], ["Basic"]])("shows toast for user=%s", (user_type) => {
    localStorage.setItem("client_details", user_type && JSON.stringify({ tier: user_type }));

    jest.clearAllMocks();
    AppFunc.exportJSON(false, false);

    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveReturnedWith([...CONSTANTS.SUBSCRIPTION_TOAST]);
  });

  it.each([
    [1, true, true],
    [1, false, false],
    [1, false, true],
    [15, true, true],
    [15, false, false],
    [15, false, true],
  ])(
    "correctly exports a JSON file of the current configuration, fileLimit=%s, lastError=%s, showShelf=%s",
    (fileLimit, lastError, showShelf) => {
      const chromeDownloadsSetShelfEnabledSpy = jest.spyOn(chrome.downloads, "setShelfEnabled");
      const chromeDownloadsDownloadSpy = jest.spyOn(chrome.downloads, "download");
      const chromeDownloadsRemoveFileSpy = jest.spyOn(chrome.downloads, "removeFile");
      chrome.runtime.lastError = lastError && jest.fn().mockImplementationOnce(() => ({message: "TabMerger Message"})) as unknown; // prettier-ignore

      localStorage.setItem("groups", JSON.stringify(init_groups));
      localStorage.setItem("client_details", JSON.stringify(user));
      localStorage.setItem("file_ids", JSON.stringify(fileLimit === 1 ? [1] : []));

      const groups = JSON.parse(localStorage.getItem("groups"));
      groups["settings"] = { ...JSON.parse(sessionStorage.getItem("settings")), relativePathBackup: "Test/", fileLimitBackup: fileLimit }; // prettier-ignore
      sessionStorage.setItem("settings", JSON.stringify(groups["settings"]));

      const expect_download_opts = {
        url: new Blob([JSON.stringify(groups, null, 2)], { type: "text/json;charset=utf-8" }),
        filename: "Test/" + AppHelper.outputFileName().replace(/:|\//g, "_") + ".json",
        conflictAction: "uniquify",
        saveAs: false,
      };

      jest.clearAllMocks();

      AppFunc.exportJSON(showShelf, false);

      expect(chromeLocalGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeLocalGetSpy).toHaveBeenCalledWith(["groups", "client_details", "file_ids"], anything);

      expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
      expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

      expect(chromeDownloadsSetShelfEnabledSpy).toHaveBeenCalledTimes(1);
      expect(chromeDownloadsSetShelfEnabledSpy).toHaveBeenCalledWith(showShelf);

      if (!lastError) {
        if (!showShelf) {
          expect(chromeDownloadsDownloadSpy).toHaveBeenCalledTimes(1);
          expect(chromeDownloadsDownloadSpy).toHaveBeenCalledWith(expect_download_opts, anything);

          if (fileLimit > 1) {
            expect(chromeDownloadsRemoveFileSpy).not.toHaveBeenCalled();
          }

          expect(chromeLocalSetSpy).toHaveBeenCalledTimes(1);
          expect(chromeLocalSetSpy).toHaveBeenCalledWith({ file_ids: [2] }, anything);
        }
      } else {
        expect(toastSpy).toHaveBeenCalledTimes(1);
        expect(toastSpy).toHaveReturnedWith([...CONSTANTS.DOWNLOAD_ERROR_TOAST]);
      }
    }
  );
});

describe("importJSON", () => {
  it("alerts on wrong non json input", () => {
    const input = { target: { files: [{ type: "application/pdf" }] } };
    jest.clearAllMocks();

    /* @ts-ignore */
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

    /* @ts-ignore */
    jest.spyOn(global, "FileReader").mockImplementation(function () {
      this.readAsText = jest.fn(() => (this.result = JSON.stringify(exportedJSON)));
    });

    const storeDestructiveActionSpy = jest.spyOn(AppHelper, "storeDestructiveAction").mockImplementation(() => [init_groups]); // prettier-ignore

    jest.clearAllMocks();

    /* @ts-ignore */
    AppFunc.importJSON(input, user, mockSet, mockSet);

    expect(FileReader).toHaveBeenCalledTimes(1);
    /* @ts-ignore */
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

    /* @ts-ignore */
    expect(input.target.value).toBe("");

    storeDestructiveActionSpy.mockRestore();
  });
});

describe("getTabMergerLink", () => {
  const chrome_url = "https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc";
  const firefox_url = "https://addons.mozilla.org/en-CA/firefox/addon/tabmerger";
  const edge_url = "https://microsoftedge.microsoft.com/addons/detail/tabmerger/eogjdfjemlgmbblgkjlcgdehbeoodbfn";

  console.error = jest.fn() as jest.Mock; // will get error that chrome.storage cannot be called since chrome is set to undefined, but this is expected in this test
  const prevChrome = global.chrome;

  afterAll(() => (global.chrome = prevChrome));

  /**
   * Allows to change "browser" by specifying the correct userAgent string.
   * @param {string} return_val The value which navigator.userAgent string will be set to.
   */
  function changeUserAgent(return_val: string): void {
    /* @ts-ignore */
    navigator.__defineGetter__("userAgent", () => return_val);
  }

  test.each([
    ["Edge", edge_url],
    ["Chrome", chrome_url],
    ["Firefox", firefox_url],
  ])("correctly sets the link of the TabMerger logo - %s", (browser, expect_link) => {
    if (["Edge", "Chrome"].includes(browser)) {
      changeUserAgent(browser === "Edge" ? "Edg" : "");
    } else if (browser === "Firefox") {
      global.InstallTrigger = "temp";
    } else {
      delete global.InstallTrigger;
      changeUserAgent("RANDOM");
      global.chrome = undefined;
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
