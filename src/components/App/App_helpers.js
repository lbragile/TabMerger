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
 * @module App/App_helpers
 */

import * as CONSTANTS from "../../constants/constants";
import { toast } from "react-toastify";

/**
 * Produces a timestamp which is added to newly formed groups
 * @param {string?} date_str Used in testing to inject a predefined date
 *
 * @return ```dd/mm/yyyy @ hh:mm:ss```
 */
export function getTimestamp(date_str) {
  var date_parts = date_str?.split(" ") || new Date(Date.now()).toString().split(" ");
  date_parts = date_parts.filter((_, i) => 0 < i && i <= 4);

  // dd/mm/yyyy @ hh:mm:ss
  date_parts[0] = date_parts[1] + "/";
  date_parts[1] = ("0" + (new Date().getMonth() + 1)).slice(-2) + "/";
  date_parts[2] += " @ ";

  return date_parts.join("");
}

/**
 * Toggles TabMerger's theme (light or dark).
 * In dark mode, the theme is set to dark background with light text.
 * In light mode, the exact opposite happens - light background with dark text.
 * @param {boolean} isChecked whether dark mode is enabled or disabled
 *
 * @note Exported for testing purposes
 */
export function toggleDarkMode(isChecked) {
  var body = document.querySelector("body");
  var sidebar = document.querySelector("#sidebar");

  body.style.background = isChecked ? "rgb(52, 58, 64)" : "white";
  body.style.color = isChecked ? "white" : "black";
  sidebar.style.background = isChecked ? "rgb(27, 27, 27)" : "rgb(120, 120, 120)";
}

/**
 * Changes the state of the "Last Sync" indicator:
 * @example
 * positive = false ➡ 🟥 `Last Sync: --/--/---- @ --:--:--` 🟥
 * positive = true ➡ 🟩 `Last Sync: 11/11/2020 @ 11:11:11` 🟩
 * @param {boolean} positive Whether a sync happened or not
 * @param {HTMLElement} sync_node Node that contains the sync time message
 */
export function toggleSyncTimestamp(positive, sync_node) {
  var sync_container = sync_node.parentNode;

  if (positive) {
    chrome.storage.local.get("last_sync", (local) => {
      sync_node.innerText = local.last_sync;
      sync_container.classList.replace("alert-danger", "alert-success");
    });
  } else {
    sync_node.innerText = "--/--/---- @ --:--:--";
    sync_container.classList.replace("alert-success", "alert-danger");
  }
}

/**
 * Chrome's storage sync has limits per item. Therefore, the groups are stored individually
 * as one group per item (unlike in Chrome's storage local - where they are all one big item).
 * Due to this and the fact that there is also a limit of sync write operations per minute,
 * Sync items are updated only when they change and only changed items are overwritten with new values.
 * @param {string} key Group id of an item that might need to be updated
 * @param {string} value Value corresponding to the above group id
 *
 * @return Promise that resolves if sync is updated or no update is required
 *
 * @note Exported for testing purposes
 */
export function updateGroupItem(key, value) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(key, (x) => {
      if (JSON.stringify(x[key]) !== JSON.stringify(value)) {
        chrome.storage.sync.set({ [key]: value }, () => {});
      }

      resolve(0);
    });
  });
}

/**
 * Sorts the groups based on their ids so that the order is id index based ("group-{index}").
 * @example
 * "group-0", ..., "group-9", "group-10", ... ✅
 * "group-0", "group-1", "group-10", ..., "group-9", ... ❌
 * @param {object} json Unsorted object containing the group key/value pairs which will get sorted.
 *
 * @return {object[]} Values from the sorted groups
 */
export function sortByKey(json) {
  var sortedArray = [];

  // Push each JSON Object entry in array by [key, value]
  for (var i in json) {
    sortedArray.push([i, json[i]]);
  }

  var sorted_groups = sortedArray.sort((a, b) => {
    var opts = { numeric: true, sensitivity: "base" };
    return a[0].localeCompare(b[0], undefined, opts);
  });

  // get the sorted values
  return sorted_groups.map((x) => x[1]);
}

/**
 * Updates the total tab count based on tabs in all the groups inside TabMerger
 * @param {{groups: {"group-id": {color: string, created: string, tabs:
 *  Array.<{title: string, url: string}>, title: string}}}} ls_entry current group information
 *
 * @return {Number} The total number of tabs currently present in TabMerger
 */
export function getTabTotal(ls_entry) {
  var num_tabs = 0;
  Object.values(ls_entry).forEach((val) => (num_tabs += val.tabs.length));
  return num_tabs;
}

/**
 * Given a list of tab objects, filters and returns a specific tab which contains the correct URL.
 * @param {object[]} tab_list All the tabs in the group that need to be filtered
 * @param {string} match_url The full URL that is being matched against
 *
 * @return {object[]} Tab that has a URL matching the match_url parameter
 *
 * @note Exported for testing purposes
 */
export function findSameTab(tab_list, match_url) {
  return tab_list.filter((x) => x.url === match_url);
}

/**
 * Output filename generation for exporting file functions (JSON and/or PDF)
 *
 * @return ```TabMerger [dd/mm/yyyy @ hh:mm:ss]```
 *
 * @note Exported for testing purposes
 */
export function outputFileName() {
  return `TabMerger [${getTimestamp()}]`;
}

/**
 * USed to determine the element after the current one when dragging a tab/group/url.
 * @param {HTMLElement} container The group/app body which the dragged tab is above
 * @param {number} y_pos The tab's/group's y coordinate in the window
 * @param {"tab" | "group"} type Whether the dragging element is a "tab" or a "group"
 *
 * @see dragOver in App_functions.js
 * @link modified from https://github.com/WebDevSimplified/Drag-And-Drop
 *
 * @return {HTMLElement} The tab/group element immediately after the current position of the dragged element.
 */
export function getDragAfterElement(container, y_pos, type) {
  const selector = type === "tab" ? ".draggable:not(.dragging)" : type === "group" ? ".group-item:not(.dragging-group)" : null; // prettier-ignore
  const elements = selector ? [...container.querySelectorAll(selector)] : [];
  const coef = type === "tab" ? 2 : type === "group" ? 3 : null;
  const afterElement = elements.reduce(
    (closest, element) => {
      const { top, height } = element.getBoundingClientRect();
      const offset = y_pos - top - height / coef;
      return closest.offset < offset && offset < 0 ? { offset, element } : closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  );

  return afterElement.element;
}

/**
 * If a user accidently removes a tab, group, or everything. They can press the "Undo"
 * button to restore the previous configuration.
 *
 * @param {object[]} groups_copy All the stored states up to now
 * @param {object} groups The current state which will be stored
 *
 * @note Up to 15 states are stored.
 *
 * @return {object[]} The new group state array which includes the latest state at the front.
 */
export function storeDestructiveAction(groups_copy, groups, user) {
  // shift down one to stay below NUM_UNDO_STATES
  if (groups_copy.length === CONSTANTS.USER[user.tier].NUM_UNDO_STATES) {
    groups_copy.shift();
  }
  groups_copy.push(JSON.parse(JSON.stringify(groups))); // deep copy
  return groups_copy;
}

/**
 * Certain actions require user confirmation. In such cases an element (the button which was pressed) is assigned a new attribute
 * which holds the user's response - mutation. This function listens for this mutation and responds accordingly.
 *
 * @param {HTMLElement} element The button which was pressed
 * @param {Function} cb Corresponding action if a mutation is detected on the element
 */
export function elementMutationListener(element, cb) {
  var observer = new MutationObserver((mutations, observer) => {
    mutations.forEach((mutation) => {
      cb(mutation);
    });
    observer.disconnect();
  });

  observer.observe(element, { attributes: true });
}

/**
 * Helps create alarms with similar logic (automatic backup of JSON/Sync functionality)
 * @param {number} periodInMinutes The alarms period (how often it is called)
 * @param {"sync_backup"|"json_backup"} alarm_name The alarms unique name
 * @param {object} toast_val The toast message to show when the alarm is cleared
 */
export function alarmGenerator(periodInMinutes, alarm_name, toast_val) {
  if (periodInMinutes > 0) {
    chrome.alarms.get(alarm_name, (alarm) => {
      // only create a new alarm if the existing alarms period does not match (user changed)
      if (alarm?.periodInMinutes !== periodInMinutes) {
        chrome.alarms.create(alarm_name, { when: Date.now() + 1000, periodInMinutes });
      }
    });
  } else {
    chrome.alarms.clear(alarm_name, (wasCleared) => {
      if (wasCleared) {
        toast(...toast_val);
      }
    });
  }
}
