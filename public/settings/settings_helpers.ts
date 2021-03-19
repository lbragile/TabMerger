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
 * @module Settings/Settings_helpers
 */

/**
 * On different browsers, this generates the corresponding link to the browser's webstore
 * where TabMerger can be downloaded.
 */
export function setTabMergerLink() {
  var isFirefox = "InstallTrigger" in window;
  var isEdge = !!chrome?.runtime && navigator.userAgent.indexOf("Edg") !== -1;

  var link;
  if (isEdge) {
    link = "https://microsoftedge.microsoft.com/addons/detail/tabmerger/eogjdfjemlgmbblgkjlcgdehbeoodbfn";
  } else if (isFirefox) {
    link = "https://addons.mozilla.org/en-CA/firefox/addon/tabmerger";
  } else {
    link = "https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc";
  }

  (document.getElementById("logo-img").parentNode as HTMLAnchorElement).href = link;
}

/**
 * Sets the settings item in sync storage according to the current configuration in TabMerger
 */
export function setSync() {
  const badgeInfo = (document.querySelector("input[name='badge-view']") as HTMLInputElement).checked;
  const blacklist = (document.getElementById("options-blacklist") as HTMLInputElement).value;
  const color = (document.getElementById("options-default-color") as HTMLInputElement).value;
  const dark = (document.getElementById("darkMode") as HTMLInputElement).checked;
  const fileLimitBackup = (document.querySelector("input[name='json-file-limit']") as HTMLInputElement).value;
  const font = (document.getElementById("tab-font") as HTMLInputElement).value;
  const periodBackup = (document.querySelector("input[name='period-backup']") as HTMLInputElement).value;
  const pin = (document.querySelector("input[name='pin-tabs']") as HTMLInputElement).checked;
  const merge = (document.querySelector("input[name='merge-tabs']") as HTMLInputElement).checked;
  const open = (document.querySelector("input[name='ext-open']") as HTMLInputElement).checked;
  const randomizeColor = (document.querySelector("input[name='randomize-group-color']") as HTMLInputElement).checked;
  const relativePathBackup = (document.querySelector("input[name='relative-path-backup']") as HTMLInputElement).value;
  const restore = (document.querySelector("input[name='restore-tabs']") as HTMLInputElement).checked;
  const saveAsVisibility = (document.getElementById("saveas-visibility") as HTMLInputElement).checked;
  const syncPeriodBackup = (document.querySelector("input[name='sync-backup']") as HTMLInputElement).value;
  const title = (document.getElementById("options-default-title") as HTMLInputElement).value;
  const tooltipVisibility = (document.getElementById("tooltip-visibility") as HTMLInputElement).checked;
  const weight = (document.getElementById("tab-weight") as HTMLInputElement).value;

  const settings = {
    badgeInfo,
    blacklist,
    color,
    dark,
    fileLimitBackup,
    font,
    periodBackup,
    pin,
    merge,
    open,
    randomizeColor,
    relativePathBackup,
    restore,
    saveAsVisibility,
    syncPeriodBackup,
    title,
    tooltipVisibility,
    weight,
  };
  chrome.storage.sync.set({ settings }, () => {});
}
