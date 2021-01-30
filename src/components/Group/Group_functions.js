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

import { getTimestamp, updateTabTotal, sortByKey, storeDestructiveAction } from "../App/App_helpers";

/**
 * Sets the background color of each group according to what the user chose.
 * @param {HTMLElement} e Either the group's color picker value or the group container
 * @param {string} id Used to find the group whose background needs to be set
 */
export function setBGColor(e, id) {
  var color, target;
  if (e.target) {
    color = e.target.value;
    target = e.target.closest(".group-title");
  } else {
    var group_title = e.previousSibling;
    color = group_title.querySelector("input[type='color']").value;
    target = e;
  }

  const adjusted_text_color = color > "#777777" ? "black" : "white";
  [...target.parentNode.children].forEach((child) => {
    child.style.background = color;
    const selectors = ".title-edit-input, .group-count, .hidden-symbol, .btn-in-group-title svg, .group-color svg, .draggable svg, .a-tab"; // prettier-ignore
    [...child.querySelectorAll(selectors)].forEach((x) => {
      if (x.classList.contains("a-tab")) {
        x.classList.value = x.classList.value.split(" ").filter((cl) => !cl.includes("text-")).join(" "); // prettier-ignore
        x.classList.add("text-" + (adjusted_text_color === "black" ? "primary" : "light"));
      } else {
        x.style.color = adjusted_text_color;
      }
    });

    if (child.classList.contains("group-title")) {
      child.style.borderBottom = "1px dashed " + adjusted_text_color;
    }
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
 * Update the group text color to make it high contrast regardless of background color
 * @param {Function} setGroups For state updates of the current groups
 */
export function updateTextColor(setGroups) {
  chrome.storage.local.get("groups", (local) => {
    chrome.storage.local.set({ scroll: document.documentElement.scrollTop }, () => {
      setGroups(JSON.stringify(local.groups));
    });
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
 *
 * @param {HTMLElement} e The group that is being dragged
 */
export function groupDragStart(e) {
  if (!e.target.closest(".draggable")) {
    e.target.closest(".group-item").classList.add("dragging-group");
  }
}

/**
 *
 * @param {HTMLElement} e The group that is being dragged
 */
export function groupDragEnd(e, setGroups) {
  e.preventDefault();

  if (e.target.classList.contains("dragging-group")) {
    e.target.classList.remove("dragging-group");
    var group_items = document.querySelectorAll(".group-item");
    var new_groups = {};
    group_items.forEach((x, i) => {
      new_groups["group-" + i] = {
        color: x.querySelector("input[type='color']").value,
        created: x.querySelector(".created span").textContent,
        hidden: !!x.querySelector(".hidden-symbol"),
        locked: x.querySelector(".lock-group-btn .tiptext-group-title").textContent.includes("Unlock"),
        starred: x.querySelector(".star-group-btn .tiptext-group-title").textContent.includes("Unstar"),
        tabs: [...x.querySelectorAll(".draggable")].map((tab) => {
          const a = tab.querySelector("a");
          return { pinned: !!tab.querySelector(".pinned"), title: a.textContent, url: a.href };
        }),
        title: x.querySelector(".title-edit-input").value,
      };
    });

    chrome.storage.local.set({ groups: new_groups, scroll: document.documentElement.scrollTop }, () => {
      setGroups(JSON.stringify(new_groups));
    });
  }
}

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
  chrome.storage.local.get(["groups", "groups_copy"], (local) => {
    chrome.storage.sync.get("settings", (sync) => {
      const scroll = document.documentElement.scrollTop;
      var target = e.target.closest(".group-title").nextSibling;

      var { groups, groups_copy } = local;
      if (!groups[target.id].locked) {
        groups_copy = storeDestructiveAction(groups_copy, groups);

        // if removed the only existing group
        if (Object.keys(groups).length === 1) {
          groups["group-0"] = {
            color: sync.settings.color,
            created: getTimestamp(),
            hidden: false,
            locked: false,
            starred: false,
            tabs: [],
            title: sync.settings.title,
          };
        } else {
          delete groups[target.id];

          // order the groups correctly
          const ordered_vals = sortByKey(groups);
          groups = {};
          ordered_vals.forEach((val, i) => {
            groups["group-" + i] = val;
          });
        }

        chrome.storage.local.set({ groups, groups_copy, scroll }, () => {
          setGroups(JSON.stringify(groups));
          setTabTotal(updateTabTotal(groups));
        });
      } else {
        alert("This group is locked and thus cannot be deleted. Press the lock symbol to first unlock and then retry deleting it!"); // prettier-ignore
      }
    });
  });
}

/**
 * Lock -> locks/unlocks a given group. A locked group will not be deleted if a user accidently causes a
 * delete action to be performed. Thus, important tabs should go in locked groups when backups are not made.
 *
 * Star -> starring a given group moving it to the top below other starred groups.
 * A starred group will also be locked automatically to prevent accidental deletion.
 * Staring a group can be useful to avoid long drag and drop operations when many groups are present
 *
 * Hide -> Allows the user to collapse the tabs in the corresponding group,
 * reducing how much space the group takes up. Note that this is not persistent currently.
 * The user can also re-click the toggle button to expand the tabs of a collapsed group.
 *
 * @param {HTMLElement} e Node corresponding to the group that will be locked/unlocked.
 * @param {"visibility"|"lock"|"star"} toggle_type Type of operation to perform on a group.
 * @param {Function} setGroups For re-rendering the group's visible/hidden state
 */
export function toggleGroup(e, toggle_type, setGroups) {
  const id = e.target.closest(".group-title").nextSibling.id;
  var scroll = document.documentElement.scrollTop;
  var groups = {};

  chrome.storage.local.get("groups", (local) => {
    switch (toggle_type) {
      case "visibility":
        local.groups[id].hidden = !local.groups[id].hidden;
        groups = local.groups;
        break;
      case "lock":
        local.groups[id].locked = !local.groups[id].locked;
        groups = local.groups;
        break;

      default:
        scroll = 0;
        groups = local.groups;
        local.groups[id].starred = !local.groups[id].starred;

        if (local.groups[id].starred) {
          local.groups[id].locked = true;

          const starred_val = local.groups[id];
          delete local.groups[id];
          const other_vals = sortByKey(local.groups);

          groups["group-" + 0] = starred_val;
          other_vals.forEach((val, i) => {
            groups["group-" + (i + 1)] = val;
          });
        }
        break;
    }

    chrome.storage.local.set({ groups, scroll }, () => {
      setGroups(JSON.stringify(groups));
    });
  });
}

/**
 * Used when merging tabs. A message is sent to the background script indicating
 * how to merge and into which group.
 * @param {{msg: string, id: string}} msg Contains merging directions and group id into which tabs are merged
 */
export function sendMessage(msg) {
  chrome.runtime.sendMessage(chrome.runtime.id, msg);
}
