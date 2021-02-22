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
 * @module Tab/Tab_functions
 */

import { updateTabTotal, storeDestructiveAction } from "../App/App_helpers";
import { toast } from "react-toastify";

/**
 * Sets the initial tabs based on Chrome's local storage upon initial render.
 * If Chrome's local storage is empty, this is set to an empty array.
 * @param {function} setTabs For re-rendering the group's tabs
 * @param {string} id Used to get the correct group tabs
 */
export function setInitTabs(setTabs, id) {
  chrome.storage.local.get("groups", (local) => {
    var groups = local.groups;
    setTabs((groups && groups[id]?.tabs) || []);
  });
}

/**
 * Allows the user to modify the tab title styles (font family & weight) according to the settings.
 * @param {string} id The group id corresponding to the tabs
 */
export function applyTitleStyles(id) {
  chrome.storage.sync.get("settings", (sync) => {
    var tab_titles = document.querySelectorAll("#" + id + " .a-tab");
    tab_titles.forEach((x) => {
      switch (sync.settings.weight) {
        case "Bold":
          x.style.fontWeight = "bold";
          break;
        case "Bolder":
          x.style.fontWeight = "bolder";
          break;
        case "Lighter":
          x.style.fontWeight = "lighter";
          break;
        case "Light":
          x.style.fontWeight = "100";
          break;

        default:
          x.style.fontWeight = "normal";
          break;
      }

      switch (sync.settings.font) {
        case "Arial":
          x.style.fontFamily = "Arial, sans-serif";
          break;
        case "Verdana":
          x.style.fontFamily = "Verdana, sans-serif";
          break;
        case "Helvetica":
          x.style.fontFamily = "Helvetica, sans-serif";
          break;
        case "Tahoma":
          x.style.fontFamily = "Tahoma, sans-serif";
          break;
        case "Trebuchet MS":
          x.style.fontFamily = "'Trebuchet MS', sans-serif";
          break;
        case "Brush Script MT":
          x.style.fontFamily = "'Brush Script MT', cursive";
          break;
        case "Georgia":
          x.style.fontFamily = "Georgia, serif";
          break;
        case "Garamond":
          x.style.fontFamily = "Garamond, serif";
          break;
        case "Courier New":
          x.style.fontFamily = "'Courier New', monospace";
          break;

        default:
          x.style.fontFamily = "'Times New Roman', serif";
          break;
      }
    });
  });
}

/**
 * Adds necessary classes to the tab element once a drag event is initialized
 * @param {HTMLElement} e The tab which will be dragged within the same group or across groups
 */
export function tabDragStart(e) {
  var target = e.target.tagName === "DIV" ? e.target : e.target.parentNode;
  target.classList.add("dragging");
  target.closest(".group").classList.add("drag-origin");
}

/**
 * Handles the drop event once a drag is finished. Needs to re-order tabs accordingly and
 * check for sync limit violations - warning the user accordingly.
 * @param {HTMLElement} e  The dragged tab
 * @param {Function} setGroups For re-rendering the groups
 *
 * @see ITEM_STORAGE_LIMIT in App.js for exact "item_limit" value
 */
export function tabDragEnd(e, setGroups) {
  e.stopPropagation();

  var closest_group = e.target.closest(".group");
  var drag_origin = document.getElementsByClassName("drag-origin")[0];

  drag_origin.classList.remove("drag-origin");
  e.target.classList.remove("dragging");

  const scroll = document.documentElement.scrollTop;
  chrome.storage.local.get("groups", (local) => {
    var groups = local.groups;

    if (drag_origin.id !== closest_group.id) {
      // remove tab from group that originated the drag
      groups[drag_origin.id].tabs = groups[drag_origin.id].tabs.filter((x) => x.url !== e.target.querySelector("a").href); // prettier-ignore
    }

    // reorder tabs based on current positions
    groups[closest_group.id].tabs = [...closest_group.querySelectorAll(".draggable")].map((x) => {
      const anchor = x.querySelector("a");
      return { pinned: !!x.querySelector(".pinned"), title: anchor.textContent, url: anchor.href };
    });

    // update the groups
    chrome.storage.local.set({ groups, scroll }, () => setGroups(JSON.stringify(groups)));
  });
}

/**
 * Removes a tab from the group and adjusts global & group counts.
 * @param {HTMLElement} e The "x" node element that user clicked on
 * @param {Array.<{title: string, url: string, id: string?}>} tabs The group's existing tabs (to find tab to remove)
 * @param {function} setTabs For re-rendering the group's tabs
 * @param {function} setTabTotal For re-rendering the total number of groups
 * @param {function} setGroups For re-rendering the overall groups
 */
export function removeTab(e, tabs, user, setTabs, setTabTotal, setGroups) {
  const tab = e.target.closest(".draggable");
  const url = tab.querySelector("a").href;
  const group_id = tab.closest(".group").id;

  chrome.storage.local.get(["groups", "groups_copy"], (local) => {
    var { groups, groups_copy } = local;

    if (!groups[group_id].locked) {
      const scroll = document.documentElement.scrollTop;
      groups_copy = storeDestructiveAction(groups_copy, groups, user);

      groups[group_id].tabs = tabs.filter((x) => x.url !== url);
      chrome.storage.local.set({ groups, groups_copy, scroll }, () => {
        setTabs(groups[group_id].tabs);
        setTabTotal(updateTabTotal(groups));
        setGroups(JSON.stringify(groups));
      });
    } else {
      toast(
        <div className="text-left">
          This group is <b>locked</b> and thus tabs inside cannot be deleted. <br />
          <br /> Press the <b>lock</b> symbol to first <i>unlock</i> the group and then retry deleting the tab again!
        </div>,
        { toastId: "removeTab_toast" }
      );
    }
  });
}

/**
 * Sets Chrome's local storage with an array (["group id", url_link]) consisting
 * of the tab to consider for removal after a user clicks to restore it.
 * @param {HTMLElement} e Node representing the tab that was clicked
 */
export function handleTabClick(e) {
  e.preventDefault();

  // can only left click when not editing the tab title
  if (e.button === 0 && !e.target.classList.contains("edit-tab-title")) {
    // left
    chrome.storage.local.set({ remove: [e.target.closest(".group").id, e.target.href] }, () => {
      e.target.click();
      e.target.blur();
    });
  } else if (e.button === 1) {
    // middle
    e.target.focus();
    e.target.classList.add("edit-tab-title");
  }
}

/**
 * Updates the local storage with the new title of the tab for the correct group.
 * @param {HTMLElement} e Node representing the tab that was clicked
 */
export function handleTabTitleChange(e) {
  e.target.classList.remove("edit-tab-title");

  if (e.which === 13 || e.keyCode === 13) {
    e.preventDefault();
  } else {
    const group_id = e.target.closest(".group").id;
    chrome.storage.local.get("groups", (local) => {
      var tabs = local.groups[group_id].tabs;

      // update the tab's title
      tabs = tabs.map((x) => {
        if (x.url === e.target.href) {
          x.title = e.target.textContent;
        }
        return x;
      });

      local.groups[group_id].tabs = tabs;

      chrome.storage.local.set({ groups: local.groups }, () => {});
    });
  }
}

/**
 * Pins or unpins a tab that is inside TabMerger. This avoids the need for opening a tab
 * in order to pin/unpin it and re-merge into TabMerger.
 * @param {HTMLElement} e Node representing the tab's pin that was clicked
 * @param {Function} setGroups For re-rendering the groups to show the update
 */
export function handlePinClick(e, setGroups) {
  e.target.closest(".pin-tab svg").classList.toggle("pinned");

  const id = e.target.closest(".group").id;
  const url = e.target.closest(".pin-tab").previousSibling.href;

  chrome.storage.local.get("groups", (local) => {
    const scroll = document.documentElement.scrollTop;
    var groups = local.groups;
    // adjust the pin status of the correct tab
    groups[id].tabs = groups[id].tabs.map((x) => {
      if (x.url === url) {
        x.pinned = e.target.classList.contains("pinned");
      }
      return x;
    });

    chrome.storage.local.set({ groups, scroll }, () => {
      setGroups(JSON.stringify(groups));
    });
  });
}
