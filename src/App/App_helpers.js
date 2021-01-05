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
  date_parts[1] = ("0" + new Date().getMonth() + 1).slice(-2) + "/";
  date_parts[2] += " @ ";

  return date_parts.join("");
}

/**
 * Toggles TabMerger's theme (light or dark).
 * In dark mode, the theme is set to dark background with light text.
 * In light mode, the exact opposite happens - light background with dark text.
 * @param {boolean} isChecked whether dark mode is enabled or disabled
 *
 * @note Exported for testing purposes
 */
export function toggleDarkMode(isChecked) {
  var container = document.querySelector("body");
  var hr = document.querySelector("hr");

  container.style.background = isChecked ? "rgb(52, 58, 64)" : "white";
  container.style.color = isChecked ? "white" : "black";
  hr.style.borderTop = isChecked
    ? "1px solid white"
    : "1px solid rgba(0,0,0,.1)";
}

/**
 * Changes the state of the "Last Sync" indicator:
 * @example
 * positive = false ➡ 🟥 `Last Sync: --/--/---- @ --:--:--` 🟥
 * positive = true ➡ 🟩 `Last Sync: 11/11/2020 @ 11:11:11` 🟩
 * @param {boolean} positive Whether a sync happened or not
 * @param {HTMLElement} sync_node Node that contains the sync time message
 */
export function toggleSyncTimestamp(positive, sync_node) {
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
 * Chrome's storage sync has limits per item. Therefore, the groups are stored individually
 * as one group per item (unlike in Chrome's storage local - where they are all one big item).
 * Due to this and the fact that there is also a limit of sync write operations per minute,
 * Sync items are updated only when they change and only changed items are overwritten with new values.
 * @param {string} key Group id of an item that might need to be updated
 * @param {string} value Value corresponding to the above group id
 *
 * @return Promise that resolves if sync is updated or no update is required
 *
 * @note Exported for testing purposes
 */
export function updateGroupItem(key, value) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(key, (x) => {
      if (
        !x[key] ||
        x[key].color !== value.color ||
        x[key].created !== value.created ||
        x[key].title !== value.title ||
        JSON.stringify(x[key].tabs) !== JSON.stringify(value.tabs)
      ) {
        chrome.storage.sync.set({ [key]: value }, () => {
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
 *
 * @note Exported for testing purposes
 */
export function sortByKey(json) {
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
 *
 * @note Exported for testing purposes
 */
export function updateTabTotal(ls_entry, setTabTotal) {
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
 *
 * @note Exported for testing purposes
 */
export function findSameTab(tab_list, match_url) {
  return tab_list.filter((x) => x.url === match_url);
}

/**
 * Output filename generation for exporting file functions (JSON and/or PDF)
 *
 * @return ```TabMerger [dd/mm/yyyy @ hh:mm:ss]```
 *
 * @note Exported for testing purposes
 */
export function outputFileName() {
  return `TabMerger [${getTimestamp()}]`;
}
