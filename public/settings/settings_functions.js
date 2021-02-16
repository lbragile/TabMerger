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

const DEFAULT_SETTINGS = { badgeInfo: "display", blacklist: "", color: "#dedede", dark: true, font: "Arial", merge: "merge", open: "without", pin: "include", restore: "keep", title: "Title", weight: "Normal" }; // prettier-ignore

/**
 * Once a user changes the settings, they are saved in sync storage and reloaded
 * each time the page refreshes using this function. This prevents the settings from
 * every changing back to default without user input.
 */
export function restoreOptions() {
  setTabMergerLink();

  var body = document.querySelector("body");
  var code_block = document.querySelector("code");
  var nav = document.querySelector("nav");

  chrome.storage.sync.get("settings", (sync) => {
    if (!sync.settings) {
      sync.settings = DEFAULT_SETTINGS;
    }

    document.getElementById("options-default-color").value = sync.settings.color;
    document.getElementById("options-default-title").value = sync.settings.title;
    document.getElementById("tab-font").value = sync.settings.font;
    document.getElementById("tab-weight").value = sync.settings.weight;

    document.querySelectorAll("input[name='badge-view']").forEach((x) => {
      x.checked = x.value === sync.settings.badgeInfo;
    });
    document.querySelectorAll("input[name='ext-open']").forEach((x) => {
      x.checked = x.value === sync.settings.open;
    });
    document.querySelectorAll("input[name='merge-tabs']").forEach((x) => {
      x.checked = x.value === sync.settings.merge;
    });
    document.querySelectorAll("input[name='pin-tabs']").forEach((x) => {
      x.checked = x.value === sync.settings.pin;
    });
    document.querySelectorAll("input[name='restore-tabs']").forEach((x) => {
      x.checked = x.value === sync.settings.restore;
    });

    document.getElementById("options-blacklist").value = sync.settings.blacklist;

    // dark mode adjustments
    body.style.background = sync.settings.dark ? "rgb(52, 58, 64)" : "white";
    body.style.color = sync.settings.dark ? "white" : "black";
    code_block.style.color = sync.settings.dark ? "white" : "black";
    code_block.style.border = "1px solid " + (sync.settings.dark ? "white" : "black");
    nav.style.background = sync.settings.dark ? "rgb(27, 27, 27)" : "rgb(120, 120, 120)";

    var darkMode = document.getElementById("darkMode");
    darkMode.checked = sync.settings.dark;
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
  chrome.storage.sync.get("settings", (sync) => {
    if (JSON.stringify(sync.settings) !== JSON.stringify(DEFAULT_SETTINGS)) {
      chrome.storage.sync.set({ settings: DEFAULT_SETTINGS }, () => {
        window.location.reload();
      });
    }
  });
}
