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
 * @module Settings/Settings_functions
 */

import { setTabMergerLink, setSync } from "./settings_helpers.js";

const DEFAULT_SETTINGS = {
  badgeInfo: true,
  blacklist: "",
  color: "#dedede",
  dark: true,
  fileLimitBackup: 15,
  font: "Arial",
  merge: true,
  open: true,
  periodBackup: 0,
  pin: true,
  randomizeColor: false,
  relativePathBackup: "TabMerger/",
  restore: true,
  saveAsVisibility: true,
  syncPeriodBackup: 0,
  title: "Title",
  tooltipVisibility: true,
  weight: "Normal",
};

/**
 * Once a user changes the settings, they are saved in sync storage and reloaded
 * each time the page refreshes using this function. This prevents the settings from
 * every changing back to default without user input.
 */
export function restoreOptions(): void {
  setTabMergerLink();

  const body = document.querySelector("body");
  const code_block = document.querySelector("code");
  const nav = document.querySelector("nav");

  chrome.storage.sync.get("settings", (sync) => {
    if (!sync.settings) {
      sync.settings = DEFAULT_SETTINGS;
    }

    (document.getElementById("options-default-color") as HTMLInputElement).value = sync.settings.color;
    (document.getElementById("options-default-title") as HTMLInputElement).value = sync.settings.title;
    (document.getElementById("tab-font") as HTMLInputElement).value = sync.settings.font;
    (document.getElementById("tab-weight") as HTMLInputElement).value = sync.settings.weight;
    (document.querySelector("input[name='period-backup']") as HTMLInputElement).value = sync.settings.periodBackup;
    (document.querySelector("input[name='relative-path-backup']") as HTMLInputElement).value = sync.settings.relativePathBackup; // prettier-ignore
    (document.querySelector("input[name='sync-backup']") as HTMLInputElement).value = sync.settings.syncPeriodBackup;
    (document.querySelector("input[name='json-file-limit']") as HTMLInputElement).value = sync.settings.fileLimitBackup;
    (document.getElementById("options-blacklist") as HTMLInputElement).value = sync.settings.blacklist;

    (document.querySelector("input[name='randomize-group-color']") as HTMLInputElement).checked = sync.settings.randomizeColor; // prettier-ignore
    (document.getElementById("saveas-visibility") as HTMLInputElement).checked = sync.settings.saveAsVisibility;
    (document.getElementById("tooltip-visibility") as HTMLInputElement).checked = sync.settings.tooltipVisibility;
    (document.querySelector("input[name='badge-view']") as HTMLInputElement).checked = sync.settings.badgeInfo;
    (document.querySelector("input[name='ext-open']") as HTMLInputElement).checked = sync.settings.open;
    (document.querySelector("input[name='merge-tabs']") as HTMLInputElement).checked = sync.settings.merge;
    (document.querySelector("input[name='pin-tabs']") as HTMLInputElement).checked = sync.settings.pin;
    (document.querySelector("input[name='restore-tabs']") as HTMLInputElement).checked = sync.settings.restore;

    // dark mode adjustments
    body.style.background = sync.settings.dark ? "rgb(52, 58, 64)" : "rgb(250, 250, 250)";
    body.style.color = sync.settings.dark ? "white" : "black";
    code_block.style.color = sync.settings.dark ? "white" : "black";
    code_block.style.border = "1px solid " + (sync.settings.dark ? "white" : "black");
    nav.style.background = sync.settings.dark ? "rgb(27, 27, 27)" : "rgb(120, 120, 120)";

    const darkMode = document.getElementById("darkMode") as HTMLInputElement;
    darkMode.checked = sync.settings.dark;
    darkMode.addEventListener("change", () => {
      setSync();
      window.location.reload();
    });
  });
}

/**
 * Shows the save confrimation state by changing the buttons color
 * @param {MouseEvent} e On node representing the "Save" button at the bottom of the settings page
 */
export function saveOptions(e: MouseEvent): void {
  const target = e.target as HTMLButtonElement;
  target.classList.replace("btn-primary", "btn-success");
  target.innerText = "Saved";
  target.disabled = true;

  setSync();

  setTimeout(() => {
    target.classList.replace("btn-success", "btn-primary");
    target.innerText = "Save";
    target.disabled = false;
  }, 1500);
}

/**
 * If you want to quickly reset all the default options, this does it for you.
 */
export function resetOptions(): void {
  chrome.storage.sync.get("settings", (sync) => {
    if (JSON.stringify(sync.settings) !== JSON.stringify(DEFAULT_SETTINGS)) {
      chrome.storage.sync.set({ settings: DEFAULT_SETTINGS }, () => {
        window.location.reload();
      });
    }
  });
}
