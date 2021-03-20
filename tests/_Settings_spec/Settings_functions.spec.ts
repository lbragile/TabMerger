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

import * as SettingsFunc from "../../public/settings/settings_functions.js";
import * as SettingsHelper from "../../public/settings/settings_helpers.js";
import * as CONSTANTS from "../../src/constants/constants";

const { chromeSyncGetSpy, chromeSyncSetSpy } = global;

const anything = expect.any(Function);

describe("restoreOptions", () => {
  // make them opposite of default to check in test if they are properly called
  const expected_sync = {
    ...CONSTANTS.DEFAULT_SETTINGS,
    badgeInfo: false,
    blacklist: "Not TabMerger",
    color: "#111111",
    dark: false,
    font: "Times New Roman",
    merge: false,
    open: false,
    pin: false,
    randomizeColor: true,
    restore: false,
    title: "Random",
    saveAsVisibility: false,
    tooltipVisibility: false,
    weight: "Bold",
  };

  beforeEach(() => {
    document.body.innerHTML =
      `<div><hr /><code /></div>` +
      `<input type="color" id="options-default-color" />` +
      `<input type="checkbox" name="randomize-group-color" />` +
      `<input type="text" id="options-default-title" />` +
      `<input type="number" name="period-backup" />` +
      `<input type="text" name="relative-path-backup" />` +
      `<input type="number" name="sync-backup" />` +
      `<input type="number" name="json-file-limit" />` +
      `<input type="radio" name="restore-tabs" value="keep" />` +
      `<input type="radio" name="restore-tabs" value="remove" />` +
      `<input type="radio" name="ext-open" value="without" />` +
      `<input type="radio" name="ext-open" value="with" />` +
      `<input type="radio" name="pin-tabs" value="include" />` +
      `<input type="radio" name="pin-tabs" value="avoid" />` +
      `<input type="radio" name="badge-view" value="display" />` +
      `<input type="radio" name="badge-view" value="hide" />` +
      `<input type="radio" name="merge-tabs" value="merge" />` +
      `<input type="radio" name="merge-tabs" value="leave" />` +
      `<input type="checkbox" id="darkMode" />` +
      `<input type="checkbox" id="saveas-visibility" />` +
      `<input type="checkbox" id="tooltip-visibility" />` +
      `<div id="tab-weight" value="Normal" />` +
      `<div id="tab-font" value="Arial" />` +
      `<nav />` +
      `<textarea id="options-blacklist" />`;
  });

  it.each([
    [true, "empty"],
    [false, "empty"],
    [true, "full"],
    [false, "full"],
  ])("calls setTabMergerLink and chrome.storage.sync.get - dark %s (settings: %s)", (test_dark, settings) => {
    if (settings === "empty") {
      sessionStorage.removeItem("settings");
    } else {
      expected_sync.dark = test_dark;
      sessionStorage.setItem("settings", JSON.stringify(expected_sync));
    }

    const { reload } = window.location;

    const setTabMergerLinkSpy = jest.spyOn(SettingsHelper, "setTabMergerLink").mockImplementation(() => undefined);
    const setSyncSpy = jest.spyOn(SettingsHelper, "setSync").mockImplementation(() => undefined);

    document.querySelector("#darkMode").addEventListener = jest.fn((_, cb: () => void) => cb()) as jest.Mock;

    Object.defineProperty(window, "location", {
      writable: true,
      value: { reload: jest.fn() },
    });

    const expect_checked = settings === "empty";
    const ss_dark = test_dark || expect_checked;
    jest.clearAllMocks();

    SettingsFunc.restoreOptions();

    expect((document.querySelector("input[name='badge-view']") as HTMLInputElement).checked).toEqual(expect_checked);
    expect((document.querySelector("input[name='ext-open']") as HTMLInputElement).checked).toEqual(expect_checked);
    expect((document.querySelector("input[name='merge-tabs']") as HTMLInputElement).checked).toEqual(expect_checked);
    expect((document.querySelector("input[name='pin-tabs']") as HTMLInputElement).checked).toEqual(expect_checked);
    expect((document.querySelector("input[name='restore-tabs']") as HTMLInputElement).checked).toEqual(expect_checked);
    expect((document.querySelector("input[name='randomize-group-color']") as HTMLInputElement).checked).toEqual(!expect_checked); // prettier-ignore
    expect((document.getElementById("tooltip-visibility") as HTMLInputElement).checked).toEqual(expect_checked);
    expect((document.getElementById("saveas-visibility") as HTMLInputElement).checked).toEqual(expect_checked);
    expect((document.getElementById("options-blacklist") as HTMLTextAreaElement).value).toBe(expect_checked ? "" : "Not TabMerger"); // prettier-ignore
    expect((document.getElementById("options-default-color") as HTMLInputElement).value).toBe(expect_checked ? "#dedede" : "#111111"); // prettier-ignore
    expect((document.getElementById("options-default-title") as HTMLInputElement).value).toBe(expect_checked ? "Title" : "Random"); // prettier-ignore
    expect((document.getElementById("tab-font") as HTMLSelectElement).value).toBe(expect_checked ? "Arial" : "Times New Roman"); // prettier-ignore
    expect((document.getElementById("tab-weight") as HTMLSelectElement).value).toBe(expect_checked ? "Normal" : "Bold");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((document.body.style as any)._values.background).toBe(ss_dark ? "rgb(52, 58, 64)" : "rgb(250, 250, 250)");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((document.body.style as any)._values.color).toBe(ss_dark ? "white" : "black");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((document.querySelector("code").style as any)._values.color).toBe(ss_dark ? "white" : "black");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((document.querySelector("code").style as any)._values.border).toBe("1px solid " + (ss_dark ? "white" : "black")); // prettier-ignore
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((document.querySelector("nav").style as any)._values.background).toBe(ss_dark ? "rgb(27, 27, 27)" : "rgb(120, 120, 120)"); // prettier-ignore

    expect(setTabMergerLinkSpy).toHaveBeenCalledTimes(1);
    expect(setTabMergerLinkSpy).not.toHaveBeenCalledWith(anything);

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

    expect(setSyncSpy).toHaveBeenCalledTimes(1);
    expect(setSyncSpy).not.toHaveBeenCalledWith(anything);

    expect(location.reload).toHaveBeenCalledTimes(1);
    expect(location.reload).not.toHaveBeenCalledWith(anything);

    expect(document.querySelector("#darkMode").addEventListener).toHaveBeenCalledWith("change", anything);

    // restore all mocks
    setTabMergerLinkSpy.mockRestore();
    setSyncSpy.mockRestore();
    (document.querySelector("#darkMode").addEventListener as jest.Mock).mockRestore();
    window.location.reload = reload;
  });
});

describe("saveOptions", () => {
  it("correctly sets the style of the save button and calls setSync", () => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    /* @ts-ignore */
    const stub = { target: { classList: { replace: jest.fn() }, innerText: "", disabled: null } };

    const classListSpy = jest.spyOn(stub.target.classList, "replace");
    const setSyncSpy = jest.spyOn(SettingsHelper, "setSync").mockImplementation(() => undefined);

    sessionStorage.setItem("settings", JSON.stringify(CONSTANTS.DEFAULT_SETTINGS));
    jest.clearAllMocks();

    jest.useFakeTimers();
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    /* @ts-ignore */
    SettingsFunc.saveOptions(stub);

    expect(stub.target.innerText).toBe("Saved");
    expect(stub.target.disabled).toBe(true);

    expect(setSyncSpy).toHaveBeenCalledTimes(1);
    expect(setSyncSpy).not.toHaveBeenCalledWith(anything);

    jest.advanceTimersByTime(1501);

    expect(classListSpy).toHaveBeenCalledTimes(2);
    expect(classListSpy).toHaveBeenNthCalledWith(1, "btn-primary", "btn-success");
    expect(classListSpy).toHaveBeenNthCalledWith(2, "btn-success", "btn-primary");

    expect(stub.target.innerText).toBe("Save");
    expect(stub.target.disabled).toBe(false);

    setSyncSpy.mockRestore();
  });
});

describe("resetOptions", () => {
  it("calls get and set sync storage correctly - same as default settings", () => {
    sessionStorage.setItem("settings", JSON.stringify(CONSTANTS.DEFAULT_SETTINGS));
    jest.clearAllMocks();

    SettingsFunc.resetOptions();

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);

    expect(chromeSyncSetSpy).not.toHaveBeenCalled();
  });

  it("calls get and set sync storage correctly - differs from default settings", () => {
    const { reload } = window.location;

    Object.defineProperty(window, "location", {
      writable: true,
      value: { reload: jest.fn() },
    });

    sessionStorage.removeItem("settings");
    jest.clearAllMocks();

    SettingsFunc.resetOptions();

    expect(chromeSyncGetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncGetSpy).toHaveBeenCalledWith("settings", anything);
    expect(chromeSyncSetSpy).toHaveBeenCalledTimes(1);
    expect(chromeSyncSetSpy).toHaveBeenCalledWith({ settings: CONSTANTS.DEFAULT_SETTINGS }, anything);
    expect(window.location.reload).toHaveBeenCalledTimes(1);

    window.location.reload = reload;
  });
});
