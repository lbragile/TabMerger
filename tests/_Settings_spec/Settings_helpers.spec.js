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

import * as SettingsHelper from "../../public/settings/settings_helpers.js";

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

var mockSet, anything;
var chromeSyncGetSpy, chromeSyncSetSpy, chromeLocalGetSpy, chromeLocalSetSpy, chromeTabsQuerySpy;

beforeAll(() => {
  mockSet = jest.fn();
  anything = expect.anything();

  chromeSyncGetSpy = jest.spyOn(chrome.storage.sync, "get");
  chromeSyncSetSpy = jest.spyOn(chrome.storage.sync, "set");
  chromeLocalGetSpy = jest.spyOn(chrome.storage.local, "get");
  chromeLocalSetSpy = jest.spyOn(chrome.storage.local, "set");
  chromeTabsQuerySpy = jest.spyOn(chrome.tabs, "query");
});

describe("setTabMergerLink", () => {
  const chrome_url = "https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc";
  const firefox_url = "https://addons.mozilla.org/en-CA/firefox/addon/tabmerger";
  const edge_url = "https://microsoftedge.microsoft.com/addons/detail/tabmerger/eogjdfjemlgmbblgkjlcgdehbeoodbfn";

  document.body.innerHTML = `<a href="#"><img id="logo-img"></img></a>`;

  const prevChrome = global.chrome;

  afterAll(() => {
    global.chrome = prevChrome;
  });

  test.each([
    ["Edge", edge_url],
    ["Chrome", chrome_url],
    ["Firefox", firefox_url],
    ["Opera", location.href + "undefined"],
  ])("correctly sets the link of the TabMerger logo - %s", (browser, expect_link) => {
    if (["Edge", "Chrome"].includes(browser)) {
      changeUserAgent(browser === "Edge" ? "Edg" : "");
    } else if (browser === "Firefox") {
      global.InstallTrigger = "temp";
    } else {
      delete global.InstallTrigger;
      changeUserAgent("RANDOM");
      global.chrome = false;
    }

    SettingsHelper.setTabMergerLink();
    expect(document.getElementById("logo-img").parentNode.href).toBe(expect_link);
  });
});

describe("setSync", () => {
  it("sets sync storage according to the user selected values", () => {
    document.getElementById = jest.fn((id) => {
      switch (id) {
        case "options-default-color":
          return { value: "#000000" };
        case "options-default-title":
          return { value: "Default" };
        case "options-blacklist":
          return { value: "https://www.google.com" };
        case "darkMode":
          return { checked: true };
        default:
          break;
      }
    });

    document.querySelector = jest.fn((sel) => {
      if (sel.includes("restore-tabs")) {
        return { value: "remove" };
      } else if (sel.includes("ext-open")) {
        return { value: "with" };
      } else if (sel.includes("pin-tabs")) {
        return { value: "include" };
      }
    });

    const expected_sync = {blacklist: "https://www.google.com", color: "#000000", dark: true, open: "with", pin: "include", title: "Default", restore: "remove", }; // prettier-ignore

    SettingsHelper.setSync();

    expect(chromeSyncSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncSetSpy).toHaveBeenCalledWith({ settings: expected_sync }, anything);

    document.getElementById.mockRestore();
    document.querySelector.mockRestore();
  });
});
