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
 * @note This is duplicated in `../public/background.js` since `import` is not allowed outside of modules.
 * Thus, this file serves its purpose for testing only.
 */

import { filterTabs, findExtTabAndSwitch, excludeSite } from "./background_helpers.js";

var info = { which: "all" }, tab = { index: 0 }; // prettier-ignore

/**
 * extension click from toolbar - open TabMerger with or without merging tabs (according to settings)
 */
export const handleBrowserIconClick = () => {
  chrome.storage.sync.get("settings", async (result) => {
    result.settings === undefined || result.settings.open === "without"
      ? await findExtTabAndSwitch()
      : await filterTabs(info, tab);
  });
};

/**
 * Fired when an extension merge button is clicked.
 * Filters the tabs in the current window to prepare for the merging process.
 * @param {{msg: string, id: string}} request Contains information regarding
 * which way to merge and the calling tab's id
 */
export const extensionMessage = (request) => {
  info.which = request.msg;
  var queryOpts = { currentWindow: true, active: true };
  chrome.tabs.query(queryOpts, async (tabs) => {
    await filterTabs(info, tabs[0], request.id);
  });
};

/**
 * Helper function for creating a contextMenu (right click) item.
 * @param {string} id unique value for locating each contextMenu item added
 * @param {string} title the contextMenu's item title
 * @param {string} type "separator" or "normal" (default)
 */
export function createContextMenu(id, title, type) {
  chrome.contextMenus.create({ id, title, type });
}

/**
 * Handles contextMenu item clicks or keyboard shortcut events for both merging actions and
 * other actions like excluding from visibility, opening TabMerger, visiting help site, etc.
 * @param {{which: string, command: string?, menuItemId: string?}} info Indicates merging direction,
 * keyboard command, and/or the contextMenu item that was clicked
 * @param {{url: string, title: string, id: string?}} tab The tab for which the event occured.
 * Used when determining which tabs to merge
 */
export const contextMenuOrShortCut = async (info, tab) => {
  // need to alter the info object if it comes from a keyboard shortcut event
  if (typeof info === "string") {
    info = { which: "all", command: info };
  }

  switch (info.menuItemId || info.command) {
    case "aopen-tabmerger":
      await findExtTabAndSwitch();
      break;
    case "merge-left-menu":
      info.which = "left";
      await filterTabs(info, tab);
      break;
    case "merge-right-menu":
      info.which = "right";
      await filterTabs(info, tab);
      break;
    case "merge-xcluding-menu":
      info.which = "excluding";
      await filterTabs(info, tab);
      break;
    case "merge-snly-menu":
      info.which = "only";
      await filterTabs(info, tab);
      break;
    case "remove-visibility":
      excludeSite(tab);
      break;
    case "zdl-instructions":
      var dest_url = "https://lbragile.github.io/TabMerger-Extension/instructions";
      chrome.tabs.create({ active: true, url: dest_url });
      break;
    case "dl-contact":
      var dest_url = "https://lbragile.github.io/TabMerger-Extension/contact";
      chrome.tabs.create({ active: true, url: dest_url });
      break;

    default:
      info.which = "all";
      await filterTabs(info, tab);
      break;
  }
};
