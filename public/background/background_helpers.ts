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

import { DefaultGroup } from "../../src/typings/common";
import { TabState } from "../../src/typings/Tab";

/**
 * @module Background/Background_helpers

 */

/**
 * Filters a list of tabs according to the merging information provided in the parameters.
 * Sets the local storage item corresponding to the group to merge into and the tabs to merge.
 * Avoids duplicates as much as possible. If duplicate tabs are merged, only a single copy of the
 * many duplicates is included in the merge (the other duplicate tabs are simply closed).
 * @param {{which: string}} info which direction to merge from
 * @param {TabState} tab indicates where the merging call originated from
 * @param {string?} group_id the group to merge into (if merge button from one of TabMerger's groups is used)
 */
export function filterTabs(info: { which: string }, tab: TabState, group_id?: string): void {
  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    // filter based on user's merge button click
    tabs = tabs.filter((x) => x.title !== "TabMerger");
    switch (info.which) {
      case "right":
        tabs = tabs.filter((x) => x.index > tab.index);
        break;
      case "left":
        tabs = tabs.filter((x) => x.index < tab.index);
        break;
      case "excluding":
        tabs = tabs.filter((x) => x.index !== tab.index);
        break;
      case "only":
        tabs = tabs.filter((x) => x.index === tab.index);
        break;

      // no default
    }

    // create duplicate title/url list & filter blacklisted sites
    var filter_vals = ["New Tab", "Extensions", "Add-ons Manager"];

    setTimeout(() => {
      chrome.storage.sync.get("settings", (sync) => {
        chrome.storage.local.get("groups", (local) => {
          // get a list of all the current tab titles and/or urls
          (Object.values(local.groups) as DefaultGroup[]).forEach(
            (val) => (filter_vals = filter_vals.concat(val.tabs.map((x) => x.url)))
          );

          // apply blacklist items
          tabs = tabs.filter((x) => {
            var bl_sites = (sync.settings.blacklist.split(", ") as string[]).map((site) => site.toLowerCase());
            return !bl_sites.includes(x.url.toLowerCase());
          });

          // remove unnecessary information from each tab
          /* @ts-ignore */
          tabs = tabs.map((x) => ({ pinned: x.pinned, title: x.title, url: x.url, id: x.id }));

          // duplicates (already in TabMerger) can be removed
          const duplicates = tabs.filter((x) => filter_vals.includes(x.title) || filter_vals.includes(x.url));
          chrome.tabs.remove(duplicates.map((x) => x.id));

          // apply above filter
          tabs = tabs.filter((x) => !filter_vals.includes(x.title) && !filter_vals.includes(x.url));

          // make sure original merge has no duplicated values and obtain offending indicies
          var unique_tabs: TabState[] = [], indicies: number[] = []; // prettier-ignore
          /* @ts-ignore */
          tabs.forEach((x, i) => (unique_tabs.map((y) => y.url).includes(x.url) ? indicies.push(i) : unique_tabs.push(x))); // prettier-ignore

          // close duplicates in the merging process
          indicies.forEach((i) => chrome.tabs.remove(tabs[i].id));

          // ignore pinned tabs if needed
          if (!sync.settings.pin) {
            unique_tabs = unique_tabs.filter((x) => !x.pinned);
          }

          const whichGroup = group_id ? group_id : "contextMenu";
          chrome.storage.local.set({ into_group: whichGroup, merged_tabs: unique_tabs }, () => {});
        });
      });
    }, 100);
  });
}

/**
 * When TabMerger is open, this navigates to its tab if not on that tab already.
 * When TabMerger is not open, this opens its tab on the very right side.
 * Function ends when TabMerger's tab becomes active and its loading status is complete.
 * @param {boolean=} testing Whether this is a testing call or a real call
 * @return A promise which should be awaited. Resolve value is insignificant
 */
export function findExtTabAndSwitch(testing?: boolean) {
  var query = { title: "TabMerger", currentWindow: true };
  var exists = { highlighted: true, active: true };
  var not_exist = { url: "../index.html", active: true };
  return new Promise((resolve) => {
    chrome.tabs.query(query, (tabMergerTabs) => {
      tabMergerTabs[0]
        ? chrome.tabs.update(tabMergerTabs[0].id, exists, () => resolve(0))
        : chrome.tabs.create(not_exist, (newTab) => {
            function listener(tabId: number, changeInfo: { status: string }, _tab: any | undefined) {
              if (changeInfo?.status === "complete" && tabId === newTab.id) {
                /* @ts-ignore */
                chrome.tabs.onUpdated.removeListener(listener);
                resolve(0);
              }

              // during testing, need to check for tab not loading fully or id mismatch
              // cannot use process.env.NODE_ENV === "test" since this is not a node/react environment -> dependency inject
              if (testing) {
                resolve(1);
              }
            }
            /* @ts-ignore */
            chrome.tabs.onUpdated.addListener(listener);
          });
    });
  });
}

/**
 * Any URL specified here will be excluded from TabMerger when a merging action is performed.
 * This means that it will be ignored even when other tabs are merged in.
 * @param {TabState} tab The tab which should be excluded from TabMerger's merging visibility
 */
export function excludeSite(tab: TabState) {
  chrome.storage.sync.get("settings", (result) => {
    result.settings.blacklist += `${tab.url}, `;
    chrome.storage.sync.set({ settings: result.settings }, () => {});
  });
}
