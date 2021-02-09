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
import { translate } from "../App/App_functions";

/**
 * Sets the background color of each group according to what the user chose.
 * @param {HTMLElement} e Either the group's color picker value or the group container
 * @param {string?} id Used to find the group whose background needs to be set
 */
export function setBGColor(e, id) {
  const color = e.target ? e.target.value : e.previousSibling.querySelector("input[type='color']").value;
  const target = e.target ? e.target.closest(".group-title") : e.previousSibling;

  const threshold_passed = color > "#777777";
  const adjusted_text_color = threshold_passed ? "black" : "white";
  [...target.parentNode.children].forEach((child) => {
    child.style.background = color;
    const selectors = ".title-edit-input, .group-count, .hidden-symbol, .btn-in-group-title svg, .color-group-btn svg, .draggable svg, .a-tab"; // prettier-ignore
    [...child.querySelectorAll(selectors)].forEach((x) => {
      if (x.classList.contains("a-tab")) {
        x.classList.value = x.classList.value.split(" ").filter((cl) => !cl.includes("text-")).join(" "); // prettier-ignore
        x.classList.add("text-" + (threshold_passed ? "primary" : "light"));
      } else {
        x.style.color = adjusted_text_color;
      }
    });

    if (child.classList.contains("group-title")) {
      child.style.borderBottom = "1px dashed " + adjusted_text_color;
    }
  });

  chrome.storage.local.get("groups", (local) => {
    var groups = local.groups;
    if (groups[id]) {
      groups[id].color = color;
      chrome.storage.local.set({ groups }, () => {});
    }
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
export function blurOnEnter(e) {
  if (e.keyCode === 13) {
    e.target.blur();
  }
}

/**
 * Allows the user to drag a tab's URL address icon directly into TabMerger.
 * Once this is done, the URL is converted into the appropriate tab row.
 * This is useful if the user wants to avoid using the merge buttons or simply
 * merge directly into a specific group from outside of TabMerger.
 *
 * @param {HTMLElement} e The input field where the tab data was dropped
 * @param {Function} setGroups For re-rendering the groups once the operation is complete
 * @param {Function} setTabTotal For re-rendering the total tab counter
 * @param {Function} setDialog For rendering a warning/error message
 */
export function addTabFromURL(e, setGroups, setTabTotal, setDialog) {
  const url = e.target.value;
  const id = e.target.closest(".group").id;

  chrome.storage.sync.get("settings", (sync) => {
    chrome.storage.local.get("groups", (local) => {
      // match against exsiting urls to avoid duplicates
      var current_urls = [];
      Object.values(local.groups).forEach((val) => {
        current_urls = [...current_urls, ...val.tabs.map((x) => x.url)];
      });

      if (!current_urls.includes(url) && (url.includes("http://") || url.includes("https://"))) {
        // query open tabs to get the title from the tab which has a matching url
        chrome.tabs.query({ status: "complete" }, (tabs) => {
          var new_tab, remove_id;
          tabs.forEach((tab) => {
            if (tab.url === url) {
              new_tab = { pinned: tab.pinned, title: tab.title, url };
              remove_id = tab.id;
            }
          });

          // determine if need to close the merged tab
          if (sync.settings.merge === "merge") {
            chrome.tabs.remove(remove_id);
          }

          local.groups[id].tabs = [...local.groups[id].tabs, new_tab];
          chrome.storage.local.set({ groups: local.groups, scroll: document.documentElement.scrollTop }, () => {
            setTabTotal(updateTabTotal(local.groups));
            setGroups(JSON.stringify(local.groups));
          });
        });
      } else {
        e.target.value = "";
        e.target.blur();
        setTimeout(() => {
          setDialog({
            show: true,
            title: "❕ TabMerger Information ❕",
            msg: <div>That tab is already in TabMerger!</div>,
            accept_btn_text: "OK",
            reject_btn_text: null,
          });
        }, 50);
      }
    });
  });
}

/**
 * Adds the necessary classes to corresponding components when a group drag is initiated
 * @param {HTMLElement} e The group that is being dragged
 */
export function groupDragStart(e) {
  if (!e.target.closest(".draggable")) {
    e.target.closest(".group-item").classList.add("dragging-group");
  }
}

/**
 * When a group's drag operation is finished, need to re-order all other groups and assign
 * appropriate group-id to each.
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
        locked: x.querySelector(".lock-group-btn .tiptext-group-title").textContent.includes(translate("unlock")),
        starred: x.querySelector(".star-group-btn .tiptext-group-title").textContent.includes(translate("unstar")),
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
 * @param {Function} setDialog For rendering a warning/error message
 */
export function deleteGroup(e, setTabTotal, setGroups, setDialog) {
  chrome.storage.local.get(["groups", "groups_copy"], (local) => {
    chrome.storage.sync.get("settings", (sync) => {
      const scroll = document.documentElement.scrollTop;
      var target = e.target.closest(".group-title").nextSibling;

      var { groups, groups_copy } = local;
      if (!groups[target.id].locked) {
        groups_copy = storeDestructiveAction(groups_copy, groups);

        delete groups[target.id];

        // if removed the only existing group
        if (Object.keys(groups).length === 0) {
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
        setDialog({
          show: true,
          title: "❕ TabMerger Information ❕",
          msg: (
            <div>
              This group is <b>locked</b>, thus it cannot be deleted. <br />
              <br /> Press the <b>lock</b> symbol to first <i>unlock</i> the group and then retry deleting it again!
            </div>
          ),
          accept_btn_text: "OK",
          reject_btn_text: null,
        });
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

  chrome.storage.local.get("groups", (local) => {
    var groups = local.groups;

    switch (toggle_type) {
      case "visibility":
        groups[id].hidden = !groups[id].hidden;
        break;
      case "lock":
        groups[id].locked = !groups[id].locked;
        break;

      default:
        scroll = 0;
        groups[id].starred = !groups[id].starred;

        if (groups[id].starred) {
          groups[id].locked = true;

          const starred_val = groups[id];
          delete groups[id];
          const other_vals = sortByKey(groups);

          groups = {};
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
