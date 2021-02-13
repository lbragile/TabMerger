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

const anything = expect.any(Function);

describe("restoreOptions", () => {
  var expected_sync = { badgeInfo: "display", blacklist: "Not TabMerger", color: "#111111", dark: false, merge: "merge", open: "with", pin: "include", restore: "remove", title: "Random" }; // prettier-ignore

  beforeEach(() => {
    document.body.innerHTML =
      `<div><hr/><code></code></div>` +
      `<input type="color" id="options-default-color"></input>` +
      `<input type="text" id="options-default-title"></input>` +
      `<input type="radio" name="restore-tabs" value="keep"></input>` +
      `<input type="radio" name="restore-tabs" value="remove"></input>` +
      `<input type="radio" name="ext-open" value="without"></input>` +
      `<input type="radio" name="ext-open" value="with"></input>` +
      `<input type="radio" name="pin-tabs" value="include"></input>` +
      `<input type="radio" name="pin-tabs" value="avoid"></input>` +
      `<input type="radio" name="badge-view" value="display"></input>` +
      `<input type="radio" name="badge-view" value="hide"></input>` +
      `<input type="radio" name="merge-tabs" value="merge"></input>` +
      `<input type="radio" name="merge-tabs" value="leave"></input>` +
      `<input type="checkbox" id="darkMode"></input>` +
      `<nav></nav>` +
      `<textarea id="options-blacklist"></textarea>`;
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

    var setTabMergerLinkSpy = jest.spyOn(SettingsHelper, "setTabMergerLink").mockImplementation(() => {});
    var setSyncSpy = jest.spyOn(SettingsHelper, "setSync").mockImplementation(() => {});

    document.querySelector("#darkMode").addEventListener = jest.fn((_, cb) => cb());

    Object.defineProperty(window, "location", {
      writable: true,
      value: { reload: jest.fn() },
    });

    jest.clearAllMocks();

    SettingsFunc.restoreOptions();

    expect([...document.querySelectorAll("input[name='badge-view']")].map((x) => x.checked)).toEqual([true, false]);
    expect([...document.querySelectorAll("input[name='ext-open']")].map((x) => x.checked)).toEqual(settings === "empty" ? [true, false] : [false,true]); // prettier-ignore
    expect([...document.querySelectorAll("input[name='merge-tabs']")].map((x) => x.checked)).toEqual([true, false]);
    expect([...document.querySelectorAll("input[name='pin-tabs']")].map((x) => x.checked)).toEqual([true, false]);
    expect([...document.querySelectorAll("input[name='restore-tabs']")].map((x) => x.checked)).toEqual(settings === "empty" ? [true, false] : [false,true]); // prettier-ignore
    expect(document.getElementById("options-blacklist").value).toBe(settings === "empty" ? "" : "Not TabMerger");
    expect(document.getElementById("options-default-color").value).toBe(settings === "empty" ? "#dedede" : "#111111");
    expect(document.getElementById("options-default-title").value).toBe(settings === "empty" ? "Title" : "Random");

    const ss_dark = test_dark || settings === "empty";
    expect(document.body.style._values.background).toBe(ss_dark ? "rgb(52, 58, 64)" : "white");
    expect(document.body.style._values.color).toBe(ss_dark ? "white" : "black");
    expect(document.querySelector("code").style._values.color).toBe(ss_dark ? "white" : "black");
    expect(document.querySelector("code").style._values.border).toBe("1px solid " + (ss_dark ? "white" : "black")); // prettier-ignore
    expect(document.querySelector("nav").style._values.background).toBe(ss_dark ? "rgb(27, 27, 27)" : "rgb(120, 120, 120)"); // prettier-ignore

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
    document.querySelector("#darkMode").addEventListener.mockRestore();
    window.location.reload = reload;
  });
});

describe("saveOptions", () => {
  it("correctly sets the style of the save button and calls setSync", () => {
    var stub = { target: { classList: { replace: jest.fn() }, innerText: "", disabled: null } };

    var classListSpy = jest.spyOn(stub.target.classList, "replace");
    var setSyncSpy = jest.spyOn(SettingsHelper, "setSync").mockImplementation(() => {});

    sessionStorage.setItem("settings", JSON.stringify(default_settings));
    jest.clearAllMocks();

    jest.useFakeTimers();
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
    sessionStorage.setItem("settings", JSON.stringify(default_settings));
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
    expect(chromeSyncSetSpy).toHaveBeenCalledWith({ settings: default_settings }, anything);
    expect(window.location.reload).toHaveBeenCalledTimes(1);

    window.location.reload = reload;
  });
});
