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

import * as SettingsHelper from "../../public/settings/settings_helpers.js";
import * as CONSTANTS from "../../src/constants/constants";

const GLOBAL_OBJECT = (global as unknown) as {
  chromeSyncSetSpy: Function;
};

const { chromeSyncSetSpy } = GLOBAL_OBJECT;

/**
 * Allows to change "browser" by specifying the correct userAgent string.
 * @param {string} return_val The value which navigator.userAgent string will be set to.
 */
function changeUserAgent(return_val: string): void {
  /* @ts-ignore */
  navigator.__defineGetter__("userAgent", () => return_val);
}

const anything = expect.any(Function);

describe("setTabMergerLink", () => {
  const chrome_url = "https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc";
  const firefox_url = "https://addons.mozilla.org/en-CA/firefox/addon/tabmerger";
  const edge_url = "https://microsoftedge.microsoft.com/addons/detail/tabmerger/eogjdfjemlgmbblgkjlcgdehbeoodbfn";

  document.body.innerHTML = `<a href="#"><img id="logo-img"/></a>`;

  const prevChrome = chrome;

  afterAll(() => {
    /* @ts-ignore */
    chrome = prevChrome;
  });

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
      /* @ts-ignore */
      chrome = undefined;
    }

    SettingsHelper.setTabMergerLink();
    expect((document.getElementById("logo-img").parentNode as HTMLAnchorElement).href).toBe(expect_link);
  });
});

describe("setSync", () => {
  it("sets sync storage according to the user selected values", () => {
    const expected_sync = {
      ...CONSTANTS.DEFAULT_SETTINGS,
      blacklist: "https://www.google.com",
      color: "#000000",
      fileLimitBackup: 100,
      periodBackup: 5,
      title: "Default",
      relativePathBackup: "Test/",
      syncPeriodBackup: 10,
    };

    const { getElementById, querySelector } = document;

    /* @ts-ignore */
    document.getElementById = (id) => {
      switch (id) {
        case "options-default-color":
          return { value: expected_sync.color };
        case "options-default-title":
          return { value: expected_sync.title };
        case "options-blacklist":
          return { value: expected_sync.blacklist };
        case "darkMode":
          return { checked: expected_sync.dark };
        case "tab-font":
          return { value: expected_sync.font };
        case "tab-weight":
          return { value: expected_sync.weight };
        case "saveas-visibility":
          return { checked: expected_sync.saveAsVisibility };
        case "tooltip-visibility":
          return { checked: expected_sync.tooltipVisibility };
      }
    };

    document.querySelector = (sel: string) => {
      if (sel.includes("restore-tabs")) {
        return { checked: expected_sync.restore };
      } else if (sel.includes("ext-open")) {
        return { checked: expected_sync.open };
      } else if (sel.includes("pin-tabs")) {
        return { checked: expected_sync.pin };
      } else if (sel.includes("merge-tabs")) {
        return { checked: expected_sync.merge };
      } else if (sel.includes("badge-view")) {
        return { checked: expected_sync.badgeInfo };
      } else if (sel.includes("randomize-group-color")) {
        return { checked: expected_sync.randomizeColor };
      } else if (sel.includes("period-backup")) {
        return { value: expected_sync.periodBackup };
      } else if (sel.includes("sync-backup")) {
        return { value: expected_sync.syncPeriodBackup };
      } else if (sel.includes("relative-path-backup")) {
        return { value: expected_sync.relativePathBackup };
      } else if (sel.includes("json-file-limit")) {
        return { value: expected_sync.fileLimitBackup };
      }
    };

    SettingsHelper.setSync();

    expect(chromeSyncSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncSetSpy).toHaveBeenCalledWith({ settings: expected_sync }, anything);

    document.querySelector = querySelector;
    document.getElementById = getElementById;
  });
});
