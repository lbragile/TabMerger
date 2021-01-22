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

/**
 * @module __Script/Settings_functions
 */

import { setTabMergerLink, setSync } from "./settings_helpers.js";

/**
 * Once a user changes the settings, they are saved in sync storage and reloaded
 * each time the page refreshes using this function. This prevents the settings from
 * every changing back to default without user input.
 */
export function restoreOptions() {
  setTabMergerLink();

  var body = document.querySelector("body");
  var hr = document.querySelector("hr");
  var code_block = document.querySelector("code");

  chrome.storage.sync.get("settings", (result) => {
    var settings = result.settings;
    document.getElementById("options-default-color").value = settings.color;
    document.getElementById("options-default-title").value = settings.title;
    document.querySelectorAll("input[name='restore-tabs']").forEach((x) => {
      x.checked = x.value === settings.restore;
    });
    document.querySelectorAll("input[name='ext-open']").forEach((x) => {
      x.checked = x.value === settings.open;
    });
    document.getElementById("options-blacklist").value = settings.blacklist;

    // dark mode adjustments
    body.style.background = settings.dark ? "rgb(52, 58, 64)" : "white";
    body.style.color = settings.dark ? "white" : "black";
    hr.style.borderTop = settings.dark ? "1px white solid" : "1px rgba(0,0,0,.1) solid";
    code_block.style.color = settings.dark ? "white" : "black";
    code_block.style.border = settings.dark ? "1px white solid" : "1px black solid";

    var darkMode = document.getElementById("darkMode");
    darkMode.checked = settings.dark;
    darkMode.addEventListener("change", () => {
      setSync();
      window.location.reload();
    });
  });
}

/**
 *
 * @param {HTMLElement} e Node representing the "Save" button at the bottom of the settings page
 */
export function saveOptions(e) {
  e.target.classList.replace("btn-primary", "btn-success");
  e.target.innerText = "Saved";
  e.target.disabled = true;

  setSync();

  setTimeout(() => {
    e.target.classList.replace("btn-success", "btn-primary");
    e.target.innerText = "Save";
    e.target.disabled = false;
  }, 1500);
}

/**
 * If you want to quickly reset all the default options, this does it for you.
 */
export function resetOptions() {
  var default_settings = { blacklist: "", color: "#dedede", dark: true, open: "without", restore: "keep", title: "Title" }; // prettier-ignore

  chrome.storage.sync.get("settings", (sync) => {
    if (JSON.stringify(sync.settings) !== JSON.stringify(default_settings)) {
      chrome.storage.sync.set({ settings: default_settings }, () => {
        window.location.reload();
      });
    }
  });
}
