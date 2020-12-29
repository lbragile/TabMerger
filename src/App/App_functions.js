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
TabMerger team at <https://tabmerger.herokuapp.com/contact/>
*/

import Tabs from "../Tab/Tab.js";
import Group from "../Group/Group.js";

/*------------------------------- HELPER FUNCTIONS -----------------------------*/
/**
 * Toggles TabMerger's theme (light or dark).
 * In dark mode, the theme is set to dark background with light text.
 * In light mode, the exact opposite happens - light background with dark text.
 * @param {boolean} isChecked whether dark mode is enabled or disabled
 */
function toggleDarkMode(isChecked) {
  var container = document.querySelector("body");
  var hr = document.querySelector("hr");
  var links = document.getElementsByClassName("link");

  container.style.background = isChecked ? "rgb(52, 58, 64)" : "white";
  container.style.color = isChecked ? "white" : "black";
  hr.style.borderTop = isChecked
    ? "1px white solid"
    : "1px rgba(0,0,0,.1) solid";

  [...links].forEach((x) => {
    x.style.color = isChecked ? "white" : "black";
  });
}

/**
 * Chrome's storage sync has limits per item. Therefore, the groups are stored individually
 * as one group per item (unlike in Chrome's storage local - where they are all one big item).
 * Due to this and the fact that there is also a limit of sync write operations per minute,
 * Sync items are updated only when they change and only changed items are overwritten with new values.
 * @param {string} key Group id of an item that might need to be updated
 * @param {string} value Value corresponding to the above group id
 *
 * @return Promise that resolves if sync is updated or no update is required
 */
function updateGroupItem(key, value) {
  var sync_entry = {};
  sync_entry[key] = value;

  // need to make sure to only set changed groups
  return new Promise((resolve) => {
    chrome.storage.sync.get(key, (x) => {
      if (
        x[key] === undefined ||
        x[key].color !== value.color ||
        x[key].created !== value.created ||
        x[key].title !== value.title ||
        JSON.stringify(x[key].tabs) !== JSON.stringify(value.tabs)
      ) {
        chrome.storage.sync.set(sync_entry, () => {
          resolve(0);
        });
      } else {
        resolve(0);
      }
    });
  });
}

/**
 * Sorts the groups based on their ids so that the order is id index based ("group-{index}").
 * @example
 * "group-0", ..., "group-9", "group-10", ... ✅
 * "group-0", "group-1", "group-10", ..., "group-9", ... ❌
 * @param {object} json
 *
 * @return {object[]} Values from the sorted groups
 */
function sortByKey(json) {
  var sortedArray = [];

  // Push each JSON Object entry in array by [key, value]
  for (var i in json) {
    sortedArray.push([i, json[i]]);
  }

  var sorted_groups = sortedArray.sort((a, b) => {
    var opts = { numeric: true, sensitivity: "base" };
    return a[0].localeCompare(b[0], undefined, opts);
  });

  // get the sorted values
  return sorted_groups.map((x) => x[1]);
}

/**
 * Updates the total tab count based on tabs in all the groups inside TabMerger
 * @param {{groups: {"group-id": {color: string, created: string, tabs:
 *  [{title: string, url: string}], title: string}}}} ls_entry current group information
 * @param {Function} setTabTotal For re-rendering the total tab counter
 */
function updateTabTotal(ls_entry, setTabTotal) {
  var num_tabs = 0;
  Object.values(ls_entry).forEach((val) => {
    num_tabs += val.tabs.length;
  });
  setTabTotal(num_tabs);
}

/**
 * Given a list of tab objects, filters and returns a specific tab which contains the correct URL.
 * @param {object[]} tab_list All the tabs in the group that need to be filtered
 * @param {string} match_url The full URL that is being matched against
 *
 * @return {object[]} Tab that has a URL matching the match_url parameter
 */
function findSameTab(tab_list, match_url) {
  return tab_list.filter((x) => x.url === match_url);
}

/**
 * Output filename generation for exporting file functions (JSON and/or PDF)
 *
 * @return ```TabMerger [dd/mm/yyyy @ hh:mm:ss]```
 */
function outputFileName() {
  const timestamp = new Date(Date.now()).toString().split(" ").slice(1, 5);
  const date_str = timestamp.slice(0, 3).join("-");

  return `TabMerger [${date_str} @ ${timestamp[3]}]`;
}

/*-------------------------------------------------------------------------------*/

/**
 * Changes the state of the "Last Sync" indicator:
 * @example
 * positive = false ➡ 🟥 `Last Sync: --/--/---- @ --:--:--` 🟥
 * positive = true ➡ 🟩 `Last Sync: 11/11/2020 @ 11:11:11` 🟩
 * @param {boolean} positive Whether a sync happened or not
 * @param {HTMLElement} sync_node Node that contains the sync time message
 */
export function toggleSyncTimestampHelper(positive, sync_node) {
  var sync_container = sync_node.parentNode;

  if (positive) {
    sync_node.innerText = getTimestamp();
    sync_container.classList.replace("alert-danger", "alert-success");
  } else {
    sync_node.innerText = "--/--/---- @ --:--:--";
    sync_container.classList.replace("alert-success", "alert-danger");
  }
}

/**
 * Initialize the local & sync storage when the user first installs TabMerger.
 * @param {{blacklist: string, color: string, dark: boolean,
 *  open: "with" | "without", restore: "keep" | "remove", title: string}} default_settings TabMerger's original default settings
 * @param {{color: string, created: string, tabs: object[], title: string}} default_group TabMerger's original default group (with up-to-date timestamp)
 * @param {HTMLElement} sync_node Node indicating the "Last Sync" time
 * @param {Function} setGroups For re-rendering the initial groups
 * @param {Function} setTabTotal For re-rendering the total tab counter
 *
 * @see defaultSettings in App.js
 * @see defaultGroup in App.js
 */
export function storageInit(
  default_settings,
  default_group,
  sync_node,
  setGroups,
  setTabTotal
) {
  chrome.storage.sync.get(null, (sync) => {
    if (!sync.settings) {
      chrome.storage.sync.set({ settings: default_settings });
      toggleDarkMode(true);
    } else {
      toggleDarkMode(sync.settings.dark);
    }

    if (sync["group-0"]) {
      toggleSyncTimestampHelper(true, sync_node);
    }

    delete sync.settings;
    chrome.storage.local.get("groups", (local) => {
      var ls_entry = local.groups || { "group-0": default_group };

      chrome.storage.local.clear(() => {
        chrome.storage.local.set({ groups: ls_entry }, () => {
          setGroups(JSON.stringify(ls_entry));
          updateTabTotal(ls_entry, setTabTotal);
        });
      });
    });
  });
}

/**
 * Updates the sync items - only those that have changes are overwritten
 * @param {{color: string, created: string, tabs: object[], title: string}} default_group TabMerger's default group
 * @param {HTMLElement} sync_node Node corresponding to the "Last Sync:" timestamp
 *
 * @see defaultGroup in App.js
 */
export function updateSync(default_group, sync_node) {
  chrome.storage.local.get("groups", async (local) => {
    var current_groups = local.groups;
    if (current_groups !== { "group-0": default_group }) {
      for (var key of Object.keys(current_groups)) {
        await updateGroupItem(key, current_groups[key]);
      }

      // remove extras from previous sync
      chrome.storage.sync.get(null, (sync) => {
        delete sync.settings;
        var remove_keys = Object.keys(sync).filter(
          (key) => !Object.keys(current_groups).includes(key)
        );
        chrome.storage.sync.remove(remove_keys, () => {
          toggleSyncTimestampHelper(true, sync_node);
        });
      });
    }
  });
}

/**
 * Provides the ability to upload group items from Sync storage.
 * This action overwrites local storage accordingly.
 * @example
 * 1. "TabMerger <= uploaded # groups ➡ overwrite current"
 * 2. "TabMerger > uploaded # groups ➡ overwrite current & delete extra groups"
 * @param {HTMLElement} sync_node Node corresponding to the "Last Sync:" timestamp
 * @param {Function} setGroups For re-rendering the groups
 * @param {Function} setTabTotal For re-rendering the total tab count
 */
export function loadSyncedData(sync_node, setGroups, setTabTotal) {
  chrome.storage.sync.get(null, (sync) => {
    if (sync["group-0"]) {
      delete sync.settings;
      chrome.storage.local.clear(() => {
        var new_ls = {};
        var remove_keys = [];
        Object.keys(sync).forEach((key) => {
          new_ls[key] = sync[key];
          remove_keys.push(key);
        });

        chrome.storage.local.set({ groups: new_ls }, () => {
          chrome.storage.sync.remove(remove_keys, () => {
            toggleSyncTimestampHelper(false, sync_node);
            setGroups(JSON.stringify(new_ls));
            updateTabTotal(new_ls, setTabTotal);
          });
        });
      });
    }
  });
}

/**
 * When a restoring action is performed, the corresponding tab(s) need to be opened.
 * However, if the settings indicate to "Remove from TabMerger" when restoring, the tab(s)
 * also need to be removed.
 * @param {object} changes contains the changed keys and they old & new values
 * @param {string} namespace local or sync storage type
 * @param {Function} setTabTotal For re-rendering the total tab counter
 * @param {Function} setGroups For re-rendering the groups
 */
export function openOrRemoveTabsHelper(
  changes,
  namespace,
  setTabTotal,
  setGroups
) {
  if (namespace === "local" && changes.remove && changes.remove.newValue) {
    // extract and remove the button type from array
    var btn_type = changes.remove.newValue[0];
    changes.remove.newValue.splice(0, 1);

    // try to not open tabs if it is already open
    chrome.tabs.query({ currentWindow: true }, (windowTabs) => {
      for (var i = 0; i < changes.remove.newValue.length; i++) {
        var tab_url = changes.remove.newValue[i];
        var same_tab = findSameTab(windowTabs, tab_url);
        if (same_tab[0]) {
          chrome.tabs.move(same_tab[0].id, { index: -1 });
        } else {
          chrome.tabs.create({ url: tab_url, active: false });
        }
      }

      // remove tab if needed
      chrome.storage.sync.get("settings", (sync) => {
        chrome.storage.local.get("groups", (local) => {
          var group_blocks = local.groups;
          if (sync.settings.restore !== "keep") {
            if (btn_type !== "all") {
              var any_tab_url = changes.remove.newValue[0];
              var elem = document.querySelector(`a[href='${any_tab_url}']`);
              var group_id = elem.closest(".group").id;
              group_blocks[group_id].tabs = group_blocks[group_id].tabs.filter(
                (x) => !changes.remove.newValue.includes(x.url)
              );
            } else {
              Object.keys(group_blocks).forEach((key) => {
                group_blocks[key].tabs = [];
              });
            }

            chrome.storage.local.set({ groups: group_blocks }, () => {
              // update global counter
              setTabTotal(
                document.querySelectorAll(".draggable").length -
                  changes.remove.newValue.length
              );

              setGroups(JSON.stringify(group_blocks));
            });
          }

          // allow reopening same tab
          chrome.storage.local.remove(["remove"]);
        });
      });
    });
  }
}

/**
 * When a merging action is performed, TabMerger checks if Chrome's syncing limits are
 * adhered to before performing the merge. This (in addition to local storage) ensures
 * that TabMerger's data is never lost. If limits are exceeded, the action is canceled
 * and the user is given a warning with instructions.
 * @param {object} changes contains the changed keys and they old & new values
 * @param {string} namespace local or sync storage type
 * @param {number} sync_limit Limit for overall sync storage - includes all groups, tabs, settings, etc.
 * @param {number} item_limit Limit for each group with regards to sync item storage - only contains group related details
 * @param {Function} setTabTotal For re-rendering the total tab counter
 * @param {Function} setGroups For re-rendering the groups
 *
 * @see SYNC_STORAGE_LIMIT in App.js
 * @see ITEM_STORAGE_LIMIT in App.js
 */
export function checkMergingHelper(
  changes,
  namespace,
  sync_limit,
  item_limit,
  setTabTotal,
  setGroups
) {
  if (
    namespace === "local" &&
    changes.merged_tabs &&
    changes.merged_tabs.newValue &&
    changes.merged_tabs.newValue.length !== 0
  ) {
    chrome.storage.local.get(
      ["merged_tabs", "into_group", "groups"],
      (local) => {
        // prettier-ignore
        var into_group = local.into_group, merged_tabs = local.merged_tabs;
        var group_blocks = local.groups;
        var merged_bytes = JSON.stringify(merged_tabs).length;

        var sync_bytes = JSON.stringify(group_blocks).length + merged_bytes;

        if (sync_bytes < sync_limit) {
          var this_group = group_blocks[into_group];
          var item_bytes = JSON.stringify(this_group).length + merged_bytes;

          // // prettier-ignore
          // console.log(item_bytes, "item", sync_bytes, "sync", merged_bytes, "merge");

          if (item_bytes < item_limit) {
            // close tabs to avoid leaving some open
            chrome.tabs.remove(merged_tabs.map((x) => x.id));

            var tabs_arr = [...this_group.tabs, ...merged_tabs];
            tabs_arr = tabs_arr.map((x) => ({
              title: x.title,
              url: x.url,
            }));

            group_blocks[into_group].tabs = tabs_arr;

            chrome.storage.local.set({ groups: group_blocks }, () => {
              var current = document.querySelectorAll(".draggable");
              setTabTotal(current.length + merged_tabs.length);
              setGroups(JSON.stringify(group_blocks));
            });
          } else {
            alert(
              `Group's syncing capacity exceeded by ${
                item_bytes - item_limit
              } bytes.\n\nPlease do one of the following:
    1. Create a new group and merge new tabs into it;
    2. Remove some tabs from this group;
    3. Merge less tabs into this group (each tab is ~100-300 bytes).`
            );
          }
        } else {
          alert(
            `Total syncing capacity exceeded by ${
              sync_bytes - sync_limit
            } bytes.\n\nPlease do one of the following:
    1. Remove some tabs from any group;
    2. Delete a group that is no longer needed;
    3. Merge less tabs into this group (each tab is ~100-300 bytes).
    \nMake sure to Export JSON or PDF to have a backup copy!`
          );
        }

        // remove to be able to detect changes again (even for same tabs)
        chrome.storage.local.remove(["into_group", "merged_tabs"]);
      }
    );
  }
}

/**
 * Produces a timestamp which is added to newly formed groups
 *
 * @return ```dd/mm/yyyy @ hh:mm:ss```
 */
export function getTimestamp() {
  var date_parts = new Date(Date.now()).toString().split(" ");
  date_parts = date_parts.filter((_, i) => 0 < i && i <= 4);

  // dd/mm/yyyy @ hh:mm:ss
  date_parts[0] = date_parts[1] + "/";
  date_parts[1] = new Date().getMonth() + 1 + "/";
  date_parts[2] += " @ ";

  return date_parts.join("");
}

/**
 * Forms the group components with tab draggable tab components inside.
 * Each formed group has correct & up-to-date information.
 * @param {string} groups A stringified object consisting of TabMerger's current group information
 * @param {number} itemLimit Limit for each group with regards to sync item storage - only contains group related details
 * @param {Function} setGroups For re-rendering the groups
 * @param {Function} setTabTotal For re-rendering the total tab counter
 *
 * @see ITEM_STORAGE_LIMIT in App.js
 *
 * @return If "groups" is defined - array of group components which include the correct number of tab components inside each.
 * Else - null
 */
export function groupFormation(groups, itemLimit, setGroups, setTabTotal) {
  if (groups) {
    var group_values = Object.values(JSON.parse(groups));

    var sorted_vals =
      group_values.length > 10 ? sortByKey(JSON.parse(groups)) : group_values;

    return sorted_vals.map((x, i) => {
      var id = "group-" + i;
      return (
        <Group
          id={id}
          className="group"
          title={x.title}
          color={x.color}
          created={x.created}
          num_tabs={(x.tabs && x.tabs.length) || 0}
          setGroups={setGroups}
          setTabTotal={setTabTotal}
          getTimestamp={getTimestamp}
          key={Math.random()}
        >
          <Tabs
            id={id}
            itemLimit={itemLimit}
            setTabTotal={setTabTotal}
            setGroups={setGroups}
          />
        </Group>
      );
    });
  } else {
    return null;
  }
}

/**
 * Allows the user to add a group with the default title & color chosen in the settings.
 * Each new group is always empty and has a creation timestamp.
 * @param {number} num_group_limit an upper limit on the number of groups that can be created
 * @param {Function} setGroups For re-rendering the groups
 *
 * @see NUM_GROUP_LIMIT in App.js
 */
export const addGroup = (num_group_limit, setGroups) => {
  chrome.storage.local.get("groups", (local) => {
    var current_groups = local.groups;
    var num_keys = Object.keys(current_groups).length;

    if (num_keys < num_group_limit) {
      chrome.storage.sync.get("settings", (sync) => {
        current_groups["group-" + num_keys] = {
          color: sync.settings.color,
          created: getTimestamp(),
          tabs: [],
          title: sync.settings.title,
        };
        chrome.storage.local.set({ groups: current_groups }, () => {
          setGroups(JSON.stringify(current_groups));
        });
      });
    } else {
      alert(
        `Number of groups exceeded.\n\nPlease do one of the following:
  1. Delete a group that is no longer needed;
  2. Merge tabs into another existing group.`
      );
    }
  });
};

/**
 * Sets Chrome's local storage with an array (["all", ... url_links ...]) consisting
 * of all the tabs in TabMerger to consider for removal.
 */
export function openAllTabs() {
  var tab_links = [...document.querySelectorAll(".a-tab")].map((x) => x.href);
  tab_links.unshift("all");
  chrome.storage.local.set({ remove: tab_links });
}

/**
 * Allows the user to delete every group (including tabs) inside TabMerger.
 * A default group is formed to allow for re-merging after deletion.
 * The default group has title & color matching settings parameter and a creation timestamp.
 * @param {Function} setTabTotal For re-rendering the total tab counter
 * @param {Function} setGroups For re-rendering the groups
 */
export function deleteAllGroups(setTabTotal, setGroups) {
  chrome.storage.sync.get("settings", (sync) => {
    var new_entry = {
      "group-0": {
        color: sync.settings.color,
        created: getTimestamp(),
        tabs: [],
        title: sync.settings.title,
      },
    };
    chrome.storage.local.set({ groups: new_entry }, () => {
      setTabTotal(0);
      setGroups(JSON.stringify(new_entry));
    });
  });
}

/**
 * Allows the user to search for groups or tabs within TabMerger using a filter.
 * The filter is case-insensitive and updates the groups in real time as the user types.
 * This action is non-persistent and will reset once the page reloads or a re-render occurs.
 * Tabs/Groups are simply hidden from the user once a filter is applied, that is they are not
 * removed from TabMerger and thus the counts (group and global) are not updated.
 * @example
 * #chess ➡ Group Search
 * chess ➡ Tab Search
 *
 * @param {HTMLElement} e Node corresponding to the search filter
 */
export function filterRegEx(e) {
  // prettier-ignore
  var sections, titles, match, tab_items, search_type, no_match, keep_sections = [];
  sections = document.querySelectorAll(".group-item");

  if (e.target.value[0] === "#") {
    titles = [...sections].map((x) => x.querySelector("p").innerText);
    match = e.target.value.substr(1).toLowerCase();
    search_type = "group";
  } else if (e.target.value !== "") {
    tab_items = [...sections].map((x) => [...x.querySelectorAll(".draggable")]);
    titles = tab_items.map((x) => {
      return x.map((y) => y.lastChild.innerText.toLowerCase());
    });

    match = e.target.value.toLowerCase();
    search_type = "tab";
  } else {
    // no typing? show all groups and tabs
    sections.forEach((x) => (x.style.display = ""));
    [...document.querySelectorAll(".draggable")].forEach(
      (x) => (x.style.display = "")
    );
  }

  if (search_type === "group") {
    titles.forEach((x, i) => {
      no_match = x.toLowerCase().indexOf(match) === -1;
      sections[i].style.display = no_match ? "none" : "";
    });
  } else if (search_type === "tab") {
    titles.forEach((title, i) => {
      // individual tabs where a group has 1 tab matching
      title.forEach((x, j) => {
        // maintain a list of groups to keep since
        // they contain at least one match
        no_match = x.indexOf(match) === -1;

        if (!no_match) {
          keep_sections.push(i);
        }

        tab_items[i][j].style.display = no_match ? "none" : "";
      });
    });

    // remove groups based on above calculations
    sections.forEach((x, i) => {
      x.style.display = !keep_sections.includes(i) ? "none" : "";
    });
  }
}

/**
 * Allows the user to import a JSON file which they exported previously.
 * This JSON file contains TabMerger's configuration and once uploaded
 * overwrites the current configuration. Checks are made to ensure a JSON
 * file is uploaded.
 * @param {HTMLElement} e Node corresponding to the input file field
 * @param {Function} setGroups For re-rendering the groups
 * @param {Function} setTabTotal For re-rendering the total tab counter
 */
export function readImportedFile(e, setGroups, setTabTotal) {
  if (e.target.files[0].type === "application/json") {
    var reader = new FileReader();
    reader.readAsText(e.target.files[0]);
    reader.onload = () => {
      var fileContent = JSON.parse(reader.result);

      chrome.storage.sync.set({ settings: fileContent.settings }, () => {
        delete fileContent.settings;
        chrome.storage.local.set({ groups: fileContent }, () => {
          setGroups(JSON.stringify(fileContent));
          updateTabTotal(fileContent, setTabTotal);
        });
      });
    };
  } else {
    alert(
      `You must import a JSON file (.json extension)!\n
These can be generated via the "Export JSON" button.\n\n
Be careful, only import JSON files generated by TabMerger, otherwise you risk losing your current configuration!`
    );
  }
}

/**
 * Allows the user to export TabMerger's current configuration (including settings).
 */
export const exportJSON = () => {
  chrome.storage.local.get("groups", (local) => {
    var group_blocks = local.groups;
    chrome.storage.sync.get("settings", (sync) => {
      group_blocks["settings"] = sync.settings;

      var dataStr =
        "data:text/json;charset=utf-8," +
        encodeURIComponent(JSON.stringify(group_blocks, null, 2));

      var anchor = document.createElement("a");
      anchor.setAttribute("href", dataStr);
      anchor.setAttribute("download", outputFileName() + ".json");
      anchor.click();
      anchor.remove();
    });
  });
};

/**
 * On different browsers, this generates the corresponding link to the browser's webstore
 * where TabMerger can be downloaded.
 * @param {boolean} reviews Whether or not the link should be to a reviews page
 *
 * @return A URL link to TabMerger's webstore (or reviews) page
 */
export function getTabMergerLink(reviews) {
  var link;
  var isOpera = navigator.userAgent.indexOf(" OPR/") >= 0;
  var isFirefox = typeof InstallTrigger !== "undefined";
  var isIE = /*@cc_on!@*/ false || !!document.documentMode;
  var isEdge = !isIE && !!window.StyleMedia;
  var isChrome = !!window.chrome && !!window.chrome.runtime;
  var isEdgeChromium = isChrome && navigator.userAgent.indexOf("Edg") !== -1;

  if (isIE || isEdge || isEdgeChromium) {
    link =
      "https://microsoftedge.microsoft.com/addons/detail/tabmerger/eogjdfjemlgmbblgkjlcgdehbeoodbfn";
  } else if (isFirefox) {
    link = "https://addons.mozilla.org/en-CA/firefox/addon/tabmerger";
  } else if (isChrome || isOpera) {
    link =
      "https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc";
  }

  if (reviews && !isFirefox) {
    link += "/reviews/";
  }
  return link;
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
export function translate(msg) {
  try {
    return chrome.i18n.getMessage(msg);
  } catch (err) {
    return msg;
  }
}
