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

import React, { ChangeEvent } from "react";
import { toast } from "react-toastify";

import { getTimestamp, getTabTotal, sortByKey, storeDestructiveAction } from "@App/App_helpers";
import { translate } from "@App/App_functions";

import * as CONSTANTS from "@Constants/constants";
import { setStateType, userType, DefaultGroup } from "@Typings/common";
import { TabState } from "@Typings/Tab";

/**
 * Sets the background color of each group according to what the user chose.
 * @param {ChangeEvent | HTMLInputElement} e Either the group's color picker value or the group container
 * @param {string?} id Used to find the group whose background needs to be set
 */
export function setBGColor(e: ChangeEvent | HTMLInputElement, id: string): void {
  let target = (e as ChangeEvent).target as HTMLInputElement;
  const prevSibling = (e as HTMLInputElement).previousSibling as HTMLElement;
  const color = target ? target.value : (prevSibling.querySelector("input[type='color']") as HTMLInputElement).value;
  target = (target ? target.closest(".group-title") : prevSibling) as HTMLInputElement;

  const threshold_passed = color > CONSTANTS.GROUP_COLOR_THRESHOLD;
  const adjusted_text_color = threshold_passed ? "black" : "white";
  [...target.parentNode.children].forEach((child) => {
    (child as HTMLElement).style.background = color;
    child.querySelectorAll("* :not(.created, datalist, option, path, ellipse, g, defs, b, span, p)").forEach((x) => {
      if (x.classList.contains("a-tab")) {
        x.classList.remove("text-primary");
        x.classList.remove("text-light");
        x.classList.add("text-" + (threshold_passed ? "primary" : "light"));
      } else {
        (x as HTMLElement).style.color = adjusted_text_color;
      }
    });

    if (child.classList.contains("group-title")) {
      (child as HTMLElement).style.borderBottom = "1px dashed " + adjusted_text_color;
    }
  });

  chrome.storage.local.get("groups", (local) => {
    const groups = local.groups;
    if (groups[id]) {
      groups[id].color = color;
      chrome.storage.local.set({ groups }, () => undefined);
    }
  });
}

/**
 * Update the group text color to make it high contrast regardless of background color
 * @param {setStateType<string>} setGroups For state updates of the current groups
 */
export function updateTextColor(setGroups: setStateType<string>): void {
  chrome.storage.local.get("groups", (local) => {
    chrome.storage.local.set({ scroll: document.documentElement.scrollTop }, () => {
      setGroups(JSON.stringify(local.groups));
    });
  });
}

/**
 * Sets the title of a given group in order for it to persist across reloads.
 * @param {React.FocusEvent<HTMLElement>} e The group node whose title was changed
 */
export function setTitle(e: React.FocusEvent<HTMLElement>): void {
  chrome.storage.local.get("groups", (local) => {
    const target = e.target as HTMLInputElement;
    const scroll = document.documentElement.scrollTop;
    const group_id = (target.closest(".group-title").nextSibling as HTMLDivElement).id;
    const groups = local.groups;
    groups[group_id].title = target.value;

    chrome.storage.local.set({ groups, scroll }, () => undefined);
  });
}

/**
 * Allows the user to use enter key to exit title editing mode.
 * @param {React.KeyboardEvent<HTMLInputElement>} e Node corresponding to the group whose title is being changed
 */
export function blurOnEnter(e: React.KeyboardEvent<HTMLInputElement>): void {
  if (e.code === "Enter") {
    (e.target as HTMLInputElement).blur();
  }
}

/**
 * Allows the user to drag a tab's URL address icon directly into TabMerger.
 * Once this is done, the URL is converted into the appropriate tab row.
 * This is useful if the user wants to avoid using the merge buttons or simply
 * merge directly into a specific group from outside of TabMerger.
 *
 * @param {React.ChangeEvent<HTMLInputElement>} e The input field where the tab data was dropped
 * @param {setStateType<string>} setGroups For re-rendering the groups once the operation is complete
 * @param {setStateType<number>} setTabTotal For re-rendering the total tab counter
 */
export function addTabFromURL(
  e: React.ChangeEvent<HTMLInputElement>,
  user: userType,
  setGroups: setStateType<string>,
  setTabTotal: setStateType<number>
): void {
  if (!user.paid) {
    toast(...CONSTANTS.SUBSCRIPTION_TOAST);
  } else {
    const url = e.target.value;
    const id = e.target.closest(".group").id;

    chrome.storage.sync.get("settings", (sync) => {
      chrome.storage.local.get("groups", (local) => {
        const scroll = document.documentElement.scrollTop;
        const groups = local.groups;

        const url_exists = (Object.values(groups) as DefaultGroup[]).some((val) => (val.tabs as TabState[]).map((x) => x.url).includes(url)); // prettier-ignore
        if (!url_exists && url.match(/http.+\/\//)) {
          // query open tabs to get the title from the tab which has a matching url
          chrome.tabs.query({ status: "complete" }, (tabs) => {
            let new_tab, remove_id;
            tabs.forEach((tab) => {
              if (tab.url === url) {
                new_tab = { pinned: tab.pinned, title: tab.title, url };
                remove_id = tab.id;
              }
            });

            // determine if need to close the merged tab
            if (sync.settings.merge) {
              chrome.tabs.remove(remove_id);
            }

            groups[id].tabs = [...groups[id].tabs, new_tab];
            chrome.storage.local.set({ groups, scroll }, () => {
              setTabTotal(getTabTotal(groups));
              setGroups(JSON.stringify(groups));
            });
          });
        } else {
          e.target.value = "";
          e.target.blur();
          setTimeout(() => toast(...CONSTANTS.ADD_TAB_FROM_URL_TOAST), 50);
        }
      });
    });
  }
}

/**
 * Adds the necessary classes to corresponding components when a group drag is initiated
 * @param {React.DragEvent<HTMLDivElement>} e The group that is being dragged
 */
export function groupDragStart(e: React.DragEvent<HTMLDivElement>): void {
  if (!(e.target as HTMLElement).closest(".draggable")) {
    (e.target as HTMLDivElement).closest(".group-item").classList.add("dragging-group");
  }
}

/**
 * When a group's drag operation is finished, need to re-order all other groups and assign
 * appropriate group-id to each.
 * @param {React.DragEvent<HTMLDivElement>} e The group that is being dragged
 */
export function groupDragEnd(e: React.DragEvent<HTMLDivElement>): void {
  e.preventDefault();
  const scroll = document.documentElement.scrollTop;

  if ((e.target as HTMLDivElement).classList.contains("dragging-group")) {
    (e.target as HTMLDivElement).classList.remove("dragging-group");
    const group_items = document.querySelectorAll(".group-item");
    const groups: { [key: string]: DefaultGroup } = {};
    group_items.forEach((x, i) => {
      groups["group-" + i] = {
        color: (x.querySelector("input[type='color']") as HTMLInputElement).value,
        created: x.querySelector(".created span").textContent,
        hidden: !!x.querySelector(".hidden-symbol"),
        locked: x.querySelector(".lock-group-btn").getAttribute("data-tip").includes(translate("unlock")),
        starred: x.querySelector(".star-group-btn").getAttribute("data-tip").includes(translate("unstar")),
        tabs: [...x.querySelectorAll(".draggable")].map((tab) => {
          const a = tab.querySelector("a");
          return { pinned: !!tab.querySelector(".pinned"), title: a.textContent, url: a.href };
        }),
        title: (x.querySelector(".title-edit-input") as HTMLInputElement).value,
      };
    });

    // adjust the group ids manually since no re-rendering occurs
    [...document.querySelectorAll(".group")].forEach((x, i) => (x.id = "group-" + i));

    chrome.storage.local.set({ groups, scroll }, () => undefined);
  }
}

/**
 * Sets Chrome's local storage with an array (["group id", ... url_links ...]) consisting
 * of the group's tabs to consider for removal.
 * @param {MouseEvent} e Node corresponding to the group that contains the tabs to be opened
 */
export function openGroup(e: MouseEvent): void {
  const target = (e.target as HTMLElement).closest(".group-title").nextSibling as HTMLDivElement;
  const tab_links = ([...target.querySelectorAll(".a-tab")] as HTMLAnchorElement[]).map((x) => x.href);
  tab_links.unshift(target.id);
  chrome.storage.local.set({ remove: tab_links }, () => undefined);
}

/**
 * Deletes a groups which the user selects to delete and reorders all the other groups accordingly
 * by changing their "group id" value.
 * @param {MouseEvent} e Node corresponding to the group to be deleted
 * @param {setStateType<number>} setTabTotal For re-rendering the global tab counter
 * @param {setStateType<string>} setGroups For re-rendering the groups after deletion
 */
export function deleteGroup(
  e: MouseEvent,
  user: userType,
  setTabTotal: setStateType<number>,
  setGroups: setStateType<string>
): void {
  chrome.storage.local.get(["groups", "groups_copy"], (local) => {
    chrome.storage.sync.get("settings", (sync) => {
      const scroll = document.documentElement.scrollTop;
      const target: { id: string } = (e.target as HTMLParagraphElement).closest(".group-title").nextSibling as HTMLDivElement; // prettier-ignore

      let { groups, groups_copy } = local;
      if (!groups[target.id].locked) {
        groups_copy = storeDestructiveAction(groups_copy, groups, user);
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
          ordered_vals.forEach((val, i) => (groups["group-" + i] = val));
        }

        chrome.storage.local.set({ groups, groups_copy, scroll }, () => {
          setGroups(JSON.stringify(groups));
          setTabTotal(getTabTotal(groups));
        });
      } else {
        toast(...CONSTANTS.DELETE_GROUP_TOAST);
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
 * @param {MouseEvent} e Node corresponding to the group that will be locked/unlocked.
 * @param {"visibility"|"lock"|"star"} toggle_type Type of operation to perform on a group.
 * @param {setStateType<string>} setGroups For re-rendering the group's visible/hidden state
 */
export function toggleGroup(
  e: MouseEvent,
  toggle_type: "visibility" | "lock" | "star",
  setGroups: setStateType<string>
): void {
  const id = ((e.target as HTMLElement).closest(".group-title").nextSibling as HTMLElement).id;
  let scroll = document.documentElement.scrollTop;

  chrome.storage.local.get("groups", (local) => {
    let groups = local.groups;

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

    chrome.storage.local.set({ groups, scroll }, () => setGroups(JSON.stringify(groups)));
  });
}

/**
 * Used when merging tabs. A message is sent to the background script indicating
 * how to merge and into which group.
 * @param {{msg: string, id: string}} msg Contains merging directions and group id into which tabs are merged
 */
export function sendMessage(msg: { msg: string; id: string }): void {
  chrome.runtime.sendMessage(chrome.runtime.id, msg);
}
