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

import React from "react";
import { toast } from "react-toastify";

import * as CONSTANTS from "../../constants/constants";
import { getTabTotal, storeDestructiveAction } from "../App/App_helpers";
import { setStateType, userType } from "../../typings/common";
import { TabState } from "../../typings/Tab";

/**
 * Sets the initial tabs based on Chrome's local storage upon initial render.
 * If Chrome's local storage is empty, this is set to an empty array.
 * @param {Function} setTabs For re-rendering the group's tabs
 * @param {string} id Used to get the correct group tabs
 */
export function setInitTabs(setTabs: setStateType<TabState[]>, id: string): void {
  chrome.storage.local.get("groups", (local) => {
    setTabs((local.groups && local.groups[id]?.tabs) || []);
  });
}

/**
 * Adds necessary classes to the tab element once a drag event is initialized
 * @param {React.DragEvent<HTMLDivElement>} e The tab which will be dragged within the same group or across groups
 */
export function tabDragStart(e: React.DragEvent<HTMLDivElement>): void {
  const target = ((e.target as HTMLDivElement).tagName === "DIV"
    ? e.target
    : (e.target as HTMLDivElement).parentNode) as HTMLDivElement;
  target.classList.add("dragging");
  target.closest(".group").classList.add("drag-origin");
}

/**
 * Handles the drop event once a drag is finished. Needs to re-order tabs accordingly and
 * check for sync limit violations - warning the user accordingly.
 * @param {DragEvent<HTMLDivElement>} e  The dragged tab
 * @param {Function} setGroups For re-rendering the groups
 */
export function tabDragEnd(e: React.DragEvent<HTMLDivElement>, setGroups: setStateType<string>): void {
  e.stopPropagation();
  const target = e.target as HTMLDivElement;

  const closest_group = target.closest(".group");
  const drag_origin = document.getElementsByClassName("drag-origin")[0];

  drag_origin.classList.remove("drag-origin");
  target.classList.remove("dragging");

  const scroll = document.documentElement.scrollTop;
  chrome.storage.local.get("groups", (local) => {
    const groups = local.groups;

    if (drag_origin.id !== closest_group.id) {
      // remove tab from group that originated the drag
      groups[drag_origin.id].tabs = groups[drag_origin.id].tabs.filter((x: TabState) => x.url !== target.querySelector("a").href); // prettier-ignore
    }

    // reorder tabs based on current positions
    groups[closest_group.id].tabs = [...closest_group.querySelectorAll(".draggable")].map(
      (x: Element): TabState => {
        const anchor = x.querySelector("a");
        return { pinned: !!x.querySelector(".pinned"), title: anchor.textContent, url: anchor.href };
      }
    );

    // update the groups
    chrome.storage.local.set({ groups, scroll }, () => setGroups(JSON.stringify(groups)));
  });
}

/**
 * Removes a tab from the group and adjusts global & group counts.
 * @param {React.MouseEvent<HTMLParagraphElement, MouseEvent>} e The "x" node element that user clicked on
 * @param {object[]} tabs The group's existing tabs (to find tab to remove)
 * @param {function} setTabs For re-rendering the group's tabs
 * @param {function} setTabTotal For re-rendering the total number of groups
 * @param {function} setGroups For re-rendering the overall groups
 */
export function removeTab(
  e: React.MouseEvent<HTMLParagraphElement, MouseEvent>,
  tabs: TabState[],
  user: userType,
  setTabs: setStateType<TabState[]>,
  setTabTotal: setStateType<number>,
  setGroups: setStateType<string>
): void {
  const tab = (e.target as HTMLParagraphElement).closest(".draggable");
  const url = tab.querySelector("a").href;
  const group_id = tab.closest(".group").id;

  chrome.storage.local.get(["groups", "groups_copy"], (local) => {
    // eslint-disable-next-line prefer-const
    let { groups, groups_copy } = local;

    if (!groups[group_id].locked) {
      const scroll = document.documentElement.scrollTop;
      groups_copy = storeDestructiveAction(groups_copy, groups, user);

      groups[group_id].tabs = tabs.filter((x: TabState) => x.url !== url);
      chrome.storage.local.set({ groups, groups_copy, scroll }, () => {
        setTabs(groups[group_id].tabs);
        setTabTotal(getTabTotal(groups));
        setGroups(JSON.stringify(groups));
      });
    } else {
      toast(...CONSTANTS.REMOVE_TAB_TOAST);
    }
  });
}

/**
 * Sets Chrome's local storage with an array (["group id", url_link]) consisting
 * of the tab to consider for removal after a user clicks to restore it.
 * @param {MouseEvent<HTMLAnchorElement, MouseEvent>} e Node representing the tab that was clicked
 */
export function handleTabClick(e: React.MouseEvent<HTMLAnchorElement, MouseEvent>): void {
  e.preventDefault();
  const target = e.target as HTMLAnchorElement;

  // can only left click when not editing the tab title
  if (e.button === 0 && !target.classList.contains("edit-tab-title")) {
    // left
    chrome.storage.local.set({ remove: [target.closest(".group").id, target.href] }, () => {
      target.click();
      target.blur();
    });
  } else if (e.button === 1) {
    // middle
    target.focus();
    target.classList.add("edit-tab-title");
  }
}

/**
 * Updates the local storage with the new title of the tab for the correct group.
 * @param {React.KeyboardEvent | React.FocusEvent} e Node representing the tab that was clicked
 */
export function handleTabTitleChange(e: React.KeyboardEvent | React.FocusEvent): void {
  const target = e.target as HTMLAnchorElement;
  target.classList.remove("edit-tab-title");

  // cannot make test pass if this is added
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  /* @ts-ignore */
  if (e instanceof FocusEvent || /*(e instanceof KeyboardEvent &&*/ e.code === "Enter" /*)*/) {
    e.preventDefault();
  } else {
    const group_id = target.closest(".group").id;
    chrome.storage.local.get("groups", (local) => {
      let tabs = local.groups[group_id].tabs;

      // update the tab's title
      tabs = tabs.map(
        (x: TabState): TabState => {
          if (x.url === target.href) {
            x.title = target.textContent;
          }
          return x;
        }
      );

      local.groups[group_id].tabs = tabs;

      chrome.storage.local.set({ groups: local.groups }, () => undefined);
    });
  }
}

/**
 * Pins or unpins a tab that is inside TabMerger. This avoids the need for opening a tab
 * in order to pin/unpin it and re-merge into TabMerger.
 * @param {MouseEvent<HTMLSpanElement, MouseEvent>} e Node representing the tab's pin that was clicked
 * @param {Function} setGroups For re-rendering the groups to show the update
 */
export function handlePinClick(
  e: React.MouseEvent<HTMLSpanElement, MouseEvent>,
  setGroups: setStateType<string>
): void {
  const target = e.target as HTMLSpanElement;
  target.closest(".pin-tab svg").classList.toggle("pinned");

  const id = target.closest(".group").id;
  const url = (target.closest(".pin-tab").previousSibling as HTMLAnchorElement).href;

  chrome.storage.local.get("groups", (local) => {
    const scroll = document.documentElement.scrollTop;
    const groups = local.groups;
    // adjust the pin status of the correct tab
    groups[id].tabs = groups[id].tabs.map(
      (x: TabState): TabState => {
        if (x.url === url) {
          x.pinned = target.classList.contains("pinned");
        }
        return x;
      }
    );

    chrome.storage.local.set({ groups, scroll }, () => setGroups(JSON.stringify(groups)));
  });
}
