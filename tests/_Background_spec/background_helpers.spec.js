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

import * as BackgroundHelper from "../../public/background/background_helpers.js";

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

describe.skip("filterTabs", () => {
  it("", () => {});
});

describe.skip("findExtTabAndSwitch", () => {
  it("", () => {});
});

describe("excludeSite", () => {
  it("adjusts sync storage correctly - empty", () => {
    const url = "www.google.com";

    var expected_settings = JSON.parse(sessionStorage.getItem("settings"));
    expected_settings.blacklist = url;
    jest.clearAllMocks();

    BackgroundHelper.excludeSite({ url });

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

    expect(chromeSyncSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncSetSpy).toHaveBeenCalledWith({ settings: expected_settings }, anything);
  });

  it("adjusts sync storage correctly - NOT empty", () => {
    const original_url = "www.facebook.com";
    const url = "www.google.com";

    var current_settings = JSON.parse(sessionStorage.getItem("settings"));
    current_settings.blacklist = original_url;
    sessionStorage.setItem("settings", JSON.stringify(current_settings));

    var expected_settings = current_settings;
    current_settings.blacklist = original_url + ", " + url;
    jest.clearAllMocks();

    BackgroundHelper.excludeSite({ url });

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

    expect(chromeSyncSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncSetSpy).toHaveBeenCalledWith({ settings: expected_settings }, anything);
  });
});
