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
 * @module Background/Background_functions
 */

/* eslint-disable @typescript-eslint/ban-ts-comment */

import { TabState } from "@Typings/Tab.js";
import { filterTabs, findExtTabAndSwitch, excludeSite } from "./background_helpers.js";

interface IContextInfo {
  which?: string;
  command?: string;
  menuItemId?: string;
}

export type InfoType = IContextInfo | string;

const info = { which: "all" }, tab: TabState = { index: 0, pinned: false, url: "Temp" }; // prettier-ignore

/**
 * Extension click from toolbar - open TabMerger with or without merging tabs (according to settings).
 * Will always navigate to TabMerger's extension page first.
 */
export function handleBrowserIconClick(): void {
  chrome.storage.sync.get("settings", async (sync) => {
    await findExtTabAndSwitch();
    if (!sync.settings.open) {
      filterTabs(info, tab);
    }
  });
}

/**
 * Fired when an extension merge button is clicked.
 * Filters the tabs in the current window to prepare for the merging process.
 * @param {{msg: string, id: string}} request Contains information regarding
 * which way to merge and the calling tab's id
 */
export function extensionMessage(request: { msg: string; id: string }): void {
  const queryOpts = { currentWindow: true, active: true };
  info.which = request.msg;

  /* @ts-ignore */
  chrome.tabs.query(queryOpts, (tabs) => filterTabs(info, tabs[0], request.id));
}

/**
 * Helper function for creating a contextMenu (right click) item.
 * @param {string} id unique value for locating each contextMenu item added
 * @param {string} title the contextMenu's item title
 * @param {"separator" | "normal"} type The type of contextMenu item to use "separator" or "normal" (default)
 */
export function createContextMenu(id: string, title: string, type: "separator" | "normal"): void {
  chrome.contextMenus.create({ id, title, type });
}

/**
 * Handles contextMenu item clicks or keyboard shortcut events for both merging actions and
 * other actions like excluding from visibility, opening TabMerger, visiting help site, etc.
 * @param {InfoType} info Indicates merging direction,
 * keyboard command, and/or the contextMenu item that was clicked
 * @param {TabState} tab The tab for which the event occured.
 * Used when determining which tabs to merge
 */
export async function contextMenuOrShortCut(info: InfoType, tab: TabState): Promise<void> {
  if (typeof info === "string") {
    info = { command: info };
  }

  let dest_url;
  switch (info.menuItemId || info.command) {
    case "aopen-tabmerger":
      await findExtTabAndSwitch();
      break;
    case "merge-all-menu":
      info.which = "all";
      await findExtTabAndSwitch();
      filterTabs(info as { which: string }, tab, null);
      break;
    case "merge-left-menu":
      info.which = "left";
      await findExtTabAndSwitch();
      filterTabs(info as { which: string }, tab, null);
      break;
    case "merge-right-menu":
      info.which = "right";
      await findExtTabAndSwitch();
      filterTabs(info as { which: string }, tab, null);
      break;
    case "merge-xcluding-menu":
      info.which = "excluding";
      await findExtTabAndSwitch();
      filterTabs(info as { which: string }, tab, null);
      break;
    case "merge-snly-menu":
      info.which = "only";
      await findExtTabAndSwitch();
      filterTabs(info as { which: string }, tab, null);
      break;
    case "remove-visibility":
      excludeSite(tab);
      break;
    case "zdl-instructions":
      dest_url = "https://lbragile.github.io/TabMerger-Extension/instructions";
      chrome.tabs.create({ active: true, url: dest_url });
      break;
    case "dl-contact":
      dest_url = "https://lbragile.github.io/TabMerger-Extension/contact";
      chrome.tabs.create({ active: true, url: dest_url });
      break;

    // no default
  }
}

/**
 * Checks if a translation for a specific key is available and returns the translation.
 * @param {string} msg The key specified in the "_locales" folder corresponding to a translation from English
 *
 * @see ```./public/_locales/``` For key/value translation pairs
 *
 * @return {string} If key exists - translation from English to the corresponding language (based on user's Chrome Language settings),
 * Else - the original message
 *
 */
// was tested in App component but need here to avoid import outside module
export function translate(msg: string): string {
  try {
    return chrome.i18n.getMessage(msg);
  } catch (err) {
    return msg;
  }
}
