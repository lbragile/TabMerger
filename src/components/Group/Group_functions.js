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
 * @module Group/Group_functions
 */

import { getTimestamp, updateTabTotal } from "../App/App_helpers";
import { getDragAfterElement } from "./Group_helpers";

/**
 * Sets the background color of each group according to what the user chose.
 * @param {HTMLElement} e Either the group's color picker value or the group container
 * @param {string} id Used to find the group whose background needs to be set
 */
export function setGroupBackground(e, id) {
  var color, target;
  if (e.target) {
    color = e.target.value;
    target = e.target.closest(".group-title");
  } else {
    var group_title = e.previousSibling;
    color = group_title.querySelector("input[type='color']").value;
    target = e;
  }
  [...target.parentNode.children].forEach((child) => {
    child.style.background = color;
  });

  chrome.storage.local.get("groups", (local) => {
    // this has to do with deleteAll reseting ID, so can ignore this as it works
    // istanbul ignore else
    if (local.groups[id]) {
      local.groups[id].color = color;
    }
    chrome.storage.local.set({ groups: local.groups }, () => {});
  });
}

/**
 * Sets the title of a given group in order for it to persist across reloads.
 * @param {HTMLElement} e The group node whose title was changed
 * @param {Function} setGroups For re-rendering the groups once the title is changed
 */
export function setTitle(e, setGroups) {
  chrome.storage.local.get("groups", (local) => {
    var group_id = e.target.closest(".group-title").nextSibling.id;
    var current_groups = local.groups;

    current_groups[group_id].title = e.target.value;

    chrome.storage.local.set({ groups: current_groups, scroll: document.documentElement.scrollTop }, () => {
      setGroups(JSON.stringify(current_groups));
    });
  });
}

/**
 * Allows the user to use enter key to exit title editing mode.
 * @param {HTMLElement} e Node corresponding to the group whose title is being changed
 */
/* istanbul ignore next */
export function blurOnEnter(e) {
  if (e.keyCode === 13) {
    e.target.blur();
  }
}

/**
 * Handles dynamic tab re-ordering while a dragging event is in progress.
 * Shows the tab that is being dragged "move around" in real time.
 * Also scrolls the window while dragging, as necessary, to improve user experience.
 * @param {HTMLElement} e This corresponds to the node that currently has the dragged tab above it
 */
export const dragOver = (e) => {
  e.preventDefault();
  var group_block = e.target.closest(".group");
  const afterElement = getDragAfterElement(group_block, e.clientY);
  const currentElement = document.querySelector(".dragging");
  var location = group_block.querySelector(".tabs-container");
  if (afterElement == null) {
    location.appendChild(currentElement);
  } else {
    location.insertBefore(currentElement, afterElement);
  }

  // allow scrolling while dragging with a 10px offset from top/bottom
  const offset = 10;
  if (e.clientY < offset || e.clientY > window.innerHeight - offset) {
    window.scrollTo(0, e.clientY);
  }
};

/**
 * Sets Chrome's local storage with an array (["group id", ... url_links ...]) consisting
 * of the group's tabs to consider for removal.
 * @param {HTMLElement} e Node corresponding to the group that contains the tabs to be opened
 */
export function openGroup(e) {
  var target = e.target.closest(".group-title").nextSibling;
  var tab_links = [...target.querySelectorAll(".a-tab")].map((x) => x.href);
  tab_links.unshift(target.id);
  chrome.storage.local.set({ remove: tab_links }, () => {});
}

/**
 * Deletes a groups which the user selects to delete and reorders all the other groups accordingly
 * by changing their "group id" value.
 * @param {HTMLElement} e Node corresponding to the group to be deleted
 * @param {Function} setTabTotal For re-rendering the global tab counter
 * @param {Function} setGroups For re-rendering the groups based on their new id
 */
export function deleteGroup(e, setTabTotal, setGroups) {
  chrome.storage.local.get("groups", (local) => {
    chrome.storage.sync.get("settings", (sync) => {
      var target = e.target.closest(".group-title").nextSibling;
      var group_blocks = local.groups;

      // if removed the only existing group
      if (Object.keys(group_blocks).length === 1) {
        group_blocks["group-0"] = {
          color: sync.settings.color,
          created: getTimestamp(),
          tabs: [],
          title: sync.settings.title,
        };
      } else {
        // must rename all keys for the groups above deleted group item
        var group_names = []; // need to change these
        var index_deleted = target.id.split("-")[1];
        Object.keys(group_blocks).forEach((key) => {
          if (parseInt(key.split("-")[1]) > parseInt(index_deleted)) {
            group_names.push(key);
          }
        });

        // perform the renaming of items
        var group_blocks_str = JSON.stringify(group_blocks);
        group_names.forEach((key) => {
          var new_name = "group-" + (parseInt(key.split("-")[1]) - 1);
          group_blocks_str = group_blocks_str.replace(key, new_name);
        });

        // get back json object with new item key names
        group_blocks = JSON.parse(group_blocks_str);

        // if group to be deleted is last - must only delete it
        if (!group_names[0]) {
          delete group_blocks["group-" + index_deleted];
        }
      }

      chrome.storage.local.set({ groups: group_blocks, scroll: document.documentElement.scrollTop }, () => {
        setGroups(JSON.stringify(group_blocks));
        setTabTotal(updateTabTotal(group_blocks));
      });
    });
  });
}

/**
 * Allows the user to collapse the tabs in the corresponding group,
 * reducing how much space the group takes up. Note that this is not persistent currently.
 * The user can also re-click the toggle button to expand the tabs of a collapsed group.
 * @param {HTMLElement} e Node corresponding to the group whose tabs will be collapsed/expanded.
 * @param {boolean} hide Whether the group's tabs are visible or hidden
 * @param {Function} setHide For re-rendering the group's visible/hidden state
 */
/* istanbul ignore next */
export function toggleGroup(e, hide, setHide) {
  var tabs = e.target.closest(".group-title").nextSibling.querySelectorAll(".draggable");
  tabs.forEach((tab) => {
    tab.style.display = hide ? "" : "none";
  });

  setHide(!hide);
}

/**
 * Used when merging tabs. A message is sent to the background script indicating
 * how to merge and into which group.
 * @param {{msg: string, id: string}} msg Contains merging directions and group id into which tabs are merged
 */
export function sendMessage(msg) {
  chrome.runtime.sendMessage(chrome.runtime.id, msg);
}
