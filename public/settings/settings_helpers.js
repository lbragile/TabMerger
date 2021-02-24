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
 * @module __Script/Settings_helpers
 */

/**
 * On different browsers, this generates the corresponding link to the browser's webstore
 * where TabMerger can be downloaded.
 */
export function setTabMergerLink() {
  var link;
  var isFirefox = typeof InstallTrigger !== "undefined";
  var isChrome = !!chrome && !!chrome.runtime;
  var isEdge = isChrome && navigator.userAgent.indexOf("Edg") !== -1;

  if (isEdge) {
    link = "https://microsoftedge.microsoft.com/addons/detail/tabmerger/eogjdfjemlgmbblgkjlcgdehbeoodbfn";
  } else if (isFirefox) {
    link = "https://addons.mozilla.org/en-CA/firefox/addon/tabmerger";
  } else if (isChrome) {
    link = "https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc";
  }

  document.getElementById("logo-img").parentNode.href = link;
}

/**
 * Sets the settings item in sync storage according to the current configuration in TabMerger
 */
export function setSync() {
  const badgeInfo = document.querySelector("input[name='badge-view']:checked").value;
  const blacklist = document.getElementById("options-blacklist").value;
  const color = document.getElementById("options-default-color").value;
  const dark = document.getElementById("darkMode").checked;
  const font = document.getElementById("tab-font").value;
  const periodBackup = document.querySelector("input[name='period-backup']").value;
  const pin = document.querySelector("input[name='pin-tabs']:checked").value;
  const merge = document.querySelector("input[name='merge-tabs']:checked").value;
  const open = document.querySelector("input[name='ext-open']:checked").value;
  const relativePathBackup = document.querySelector("input[name='relative-path-backup']").value;
  const restore = document.querySelector("input[name='restore-tabs']:checked").value;
  const saveAsVisibility = document.getElementById("saveas-visibility").checked;
  const syncPeriodBackup = document.querySelector("input[name='sync-backup']").value;
  const title = document.getElementById("options-default-title").value;
  const tooltipVisibility = document.getElementById("tooltip-visibility").checked;
  const weight = document.getElementById("tab-weight").value;

  const settings = {
    badgeInfo,
    blacklist,
    color,
    dark,
    font,
    periodBackup,
    pin,
    merge,
    open,
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
