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

import * as BackgroundFunc from "../../public/background/background_functions.js";
import * as BackgroundHelper from "../../public/background/background_helpers.js";

import { waitFor } from "@testing-library/react";

var mockSet, anything;
var chromeSyncGetSpy, chromeSyncSetSpy;

beforeAll(() => {
  mockSet = jest.fn();
  anything = expect.anything();

  chromeSyncGetSpy = jest.spyOn(chrome.storage.sync, "get");
  chromeSyncSetSpy = jest.spyOn(chrome.storage.sync, "set");
});

beforeEach(() => {
  sessionStorage.setItem("settings", JSON.stringify(default_settings));
});

describe("handleBrowserIconClick", () => {
  it("calls findExtTabAndSwitch => without", () => {
    var chromeSyncGetSpy = jest.spyOn(chrome.storage.sync, "get");
    var findExtTabAndSwitchSpy = jest.spyOn(BackgroundHelper, "findExtTabAndSwitch").mockImplementation(() => {});

    sessionStorage.setItem("settings", JSON.stringify({ open: "without" }));
    jest.clearAllMocks();

    BackgroundFunc.handleBrowserIconClick();

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", expect.anything());

    expect(findExtTabAndSwitchSpy).toHaveBeenCalledTimes(1);
    expect(findExtTabAndSwitchSpy).not.toHaveBeenCalledWith(expect.anything());

    findExtTabAndSwitchSpy.mockRestore();
  });

  // needs work
  it.skip("calls findExtTabAndSwitch => undefined", () => {
    var chromeSyncGetSpy = jest.spyOn(chrome.storage.sync, "get");
    var findExtTabAndSwitchSpy = jest.spyOn(BackgroundHelper, "findExtTabAndSwitch").mockImplementation(() => {});

    sessionStorage.setItem("settings", undefined);
    jest.clearAllMocks();

    BackgroundFunc.handleBrowserIconClick();

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", expect.anything());

    expect(findExtTabAndSwitchSpy).toHaveBeenCalledTimes(1);
    expect(findExtTabAndSwitchSpy).not.toHaveBeenCalledWith(expect.anything());

    findExtTabAndSwitchSpy.mockRestore();
  });

  it("calls filterTabs", () => {
    var chromeSyncGetSpy = jest.spyOn(chrome.storage.sync, "get");
    var findExtTabAndSwitchSpy = jest.spyOn(BackgroundHelper, "filterTabs").mockImplementation(() => {});

    sessionStorage.setItem("settings", JSON.stringify({ open: "with" }));
    jest.clearAllMocks();

    BackgroundFunc.handleBrowserIconClick();

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", expect.anything());

    expect(findExtTabAndSwitchSpy).toHaveBeenCalledTimes(1);
    expect(findExtTabAndSwitchSpy).toHaveBeenCalledWith({ which: "all" }, { index: 0 });

    findExtTabAndSwitchSpy.mockRestore();
  });
});

// NEEDS WORK
describe("extensionMessage", () => {
  it("queries current tabs and filters them as needed", async () => {
    const request = { msg: "TabMerger is awesome!", id: 100 };
    const tab = { title: "TabMerger", url: "https://github.com/lbragile/TabMerger" };

    // cannot really mock this and expect to see filterTabs be called. Need to implement in chrome mock.
    var chromeTabsQuerySpy = jest.spyOn(chrome.tabs, "query").mockResolvedValue([tab]);
    var filterTabs = jest.spyOn(BackgroundHelper, "filterTabs").mockImplementation(() => {});
    jest.clearAllMocks();

    BackgroundFunc.extensionMessage(request);

    expect(chromeTabsQuerySpy).toHaveBeenCalledTimes(1);
    expect(chromeTabsQuerySpy).toHaveBeenCalledWith({ currentWindow: true, active: true }, expect.any(Function));

    // await waitFor(() => {
    //   expect(filterTabs).toHaveBeenCalledTimes(1);
    //   expect(filterTabs).toHaveBeenCalledWith({ which: request.msg }, chromeTabsQuerySpy(), request.id);
    // });

    // expect.assertions(4);

    chromeTabsQuerySpy.mockRestore();
    filterTabs.mockRestore();
  });
});

describe("createContextMenu", () => {
  it("calls the chrome.contextMenus.create API with correct parameters", () => {
    var spy = jest.spyOn(chrome.contextMenus, "create").mockImplementation(() => {});
    jest.clearAllMocks();

    BackgroundFunc.createContextMenu(0, "TabMerger", "normal");

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ id: 0, title: "TabMerger", type: "normal" });

    spy.mockRestore();
  });
});

describe("contextMenuOrShortCut", () => {
  const tab = { index: 0 };
  var findExtTabAndSwitchSpy, filterTabsSpy, excludeSiteSpy, chromeTabCreateSpy;

  beforeAll(() => {
    findExtTabAndSwitchSpy = jest.spyOn(BackgroundHelper, "findExtTabAndSwitch").mockImplementation(() => {});
    filterTabsSpy = jest.spyOn(BackgroundHelper, "filterTabs").mockImplementation(() => {});
    excludeSiteSpy = jest.spyOn(BackgroundHelper, "excludeSite").mockImplementation(() => {});
    chromeTabCreateSpy = jest.spyOn(chrome.tabs, "create").mockImplementation(() => {});
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    findExtTabAndSwitchSpy.mockRestore();
    filterTabsSpy.mockRestore();
    excludeSiteSpy.mockRestore();
    chromeTabCreateSpy.mockRestore();
  });

  test.each([
    ["aopen-tabmerger", ""],
    ["merge-left-menu", "left"],
    ["merge-right-menu", "right"],
    ["merge-xcluding-menu", "excluding"],
    ["merge-snly-menu", "only"],
    ["remove-visibility", ""],
    ["zdl-instructions", ""],
    ["dl-contact", ""],
    ["merge-all-menu", "all"],
  ])("%s", (menuItemId, which) => {
    BackgroundFunc.contextMenuOrShortCut({ menuItemId }, tab);

    if (menuItemId === "aopen-tabmerger") {
      expect(findExtTabAndSwitchSpy).toHaveBeenCalledTimes(1);
      expect(findExtTabAndSwitchSpy).not.toHaveBeenCalledWith(expect.anything());
    } else if (menuItemId.includes("merge")) {
      expect(filterTabsSpy).toHaveBeenCalledTimes(1);
      expect(filterTabsSpy).toHaveBeenCalledWith({ which, menuItemId }, tab);
    } else if (menuItemId === "remove-visibility") {
      expect(excludeSiteSpy).toHaveBeenCalledTimes(1);
      expect(excludeSiteSpy).toHaveBeenCalledWith(tab);
    } else if (menuItemId.includes("dl-")) {
      const inst_url = "https://lbragile.github.io/TabMerger-Extension/instructions";
      const contact_url = "https://lbragile.github.io/TabMerger-Extension/contact";
      expect(chromeTabCreateSpy).toHaveBeenCalledTimes(1);
      expect(chromeTabCreateSpy).toHaveBeenCalledWith({
        active: true,
        url: menuItemId.includes("instructions") ? inst_url : contact_url,
      });
    }

    expect.hasAssertions();
  });

  test("typeof info === string", () => {
    const info = "merge-left-menu";
    BackgroundFunc.contextMenuOrShortCut(info, tab);

    expect(filterTabsSpy).toHaveBeenCalledTimes(1);
    expect(filterTabsSpy).toHaveBeenCalledWith({ which: "left", command: info }, tab);
  });
});
