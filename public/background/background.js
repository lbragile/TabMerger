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

import { handleBrowserIconClick, extensionMessage, contextMenuOrShortCut, createContextMenu, translate } from "./background_functions.js"; // prettier-ignore

// ask the user to take a survey to figure out why they removed TabMerger
chrome.runtime.setUninstallURL("https://lbragile.github.io/TabMerger-Extension/survey");

// when the user clicks the TabMerger icons in the browser's toolbar
chrome.browserAction.onClicked.addListener(handleBrowserIconClick);

// contextMenu creation
createContextMenu("aopen-tabmerger", translate("bgOpen"));

createContextMenu("first-separator", "separator", "separator");
createContextMenu("merge-all-menu", translate("bgAll"));
createContextMenu("merge-left-menu", translate("bgLeft"));
createContextMenu("merge-right-menu", translate("bgRight"));
createContextMenu("merge-xcluding-menu", translate("bgExclude"));
createContextMenu("merge-snly-menu", translate("bgOnly"));

createContextMenu("second-separator", "separator", "separator");
createContextMenu("remove-visibility", translate("bgSiteExclude"));

createContextMenu("third-separator", "separator", "separator");
createContextMenu("zdl-instructions", translate("bgInstructions"));
createContextMenu("dl-contact", translate("bgContact"));

// merge button clicks
chrome.runtime.onMessage.addListener(extensionMessage);

// context menu actions
chrome.contextMenus.onClicked.addListener(contextMenuOrShortCut);

// shortcut keyboard
chrome.commands.onCommand.addListener(contextMenuOrShortCut);
