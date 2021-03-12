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

import * as AppHelper from "../App/App_helpers";
import * as CONSTANTS from "../../constants/constants";

import { TUTORIAL_GROUP } from "../Extra/Tutorial";
import { toast } from "react-toastify";

import Tab from "../Tab/Tab";
import Group from "../Group/Group";

/**
 * @module App/App_functions
 */

/**
 * Allows the user to activate their subscription by providing their credentials.
 * Once the button is pressed, the credentials are verified in the external database
 * and corresponding TabMerger functionality is unlocked.
 * @param {Function} setUser Re-renders the user's subscription details { paid: boolean, tier: string }
 * @param {Function} setDialog Shows the modal for inputing the user's credentials.
 */
export function setUserStatus(setUser, setDialog) {
  setDialog(CONSTANTS.SET_USER_STATUS_DIALOG(setUser, setDialog));
}

/**
 * Stores the relevant details in local storage prior to checking if the user is authenticated
 * @param {FormEvent<HTMLFormElement>} e The submitted form (where user enters their email and activation key)
 * @param {Function} setUser To re-render the user details and adjust buttons/features accordingly
 * @param {Function} setDialog To close dialog when needed
 */
export function storeUserDetailsPriorToCheck(e, setUser, setDialog) {
  e.preventDefault();
  var [email, password] = [...e.target.querySelectorAll("input")].map((x) => x.value);
  chrome.storage.local.set({ client_details: { email, password } }, () => {
    AppHelper.checkUserStatus(setUser); // authenticate the user
    setDialog({ show: false }); // close modal
  });
}

/**
 * Displays helpful warning symbols above group for item level sync exceeding groups
 * or TabMerger for total level sync exceeding configurations.
 */
export function syncLimitIndication() {
  chrome.storage.local.get(["groups", "scroll", "client_details"], (local) => {
    chrome.storage.sync.get("settings", (sync) => {
      const { groups, scroll, client_details } = local;
      setTimeout(() => {
        document.documentElement.scrollTop = scroll ?? 0;

        if (client_details?.paid) {
          var disable_sync = false;
          // group sync
          Object.keys(groups).forEach((key) => {
            if (JSON.stringify(groups[key]).length > CONSTANTS.ITEM_STORAGE_LIMIT) {
              document.querySelector("#" + key + " .sync-group-exceed-indicator").classList.remove("d-none");
              disable_sync = true;
            }
          });

          // total sync (all groups + settings)
          if (JSON.stringify(groups).length + JSON.stringify(sync.settings).length > CONSTANTS.SYNC_STORAGE_LIMIT) {
            document.querySelector("#sync-text").style.border = "1px solid red";
            disable_sync = true;
          } else {
            document.querySelector("#sync-text").style.border = "none";
          }

          if (disable_sync) {
            document.querySelector("#sync-write-btn").classList.add("disabled-btn");
          }
        }
      }, 100);
    });
  });
}

/**
 * Re-arranges TabMerger's page before the printing process is initiated.
 * Takes into account the user's subscription to hide/show ads on the side.
 * Restores original configuration once the printing process is done.
 * @param {string} type Whether it is before or after the printing process
 * @param {object} user The user's subscription details
 */
export function toggleHiddenOrEmptyGroups(type, user) {
  if (["Standard", "Premium"].includes(user.tier)) {
    document.querySelector("#sidebar").style.visibility = type === "before" ? "hidden" : "";
  }
}

/**
 * Creates alarms that trigger automatic backups in the form of JSON and Sync Write, respectively.
 * Alarms are based on the settings configured by the user.
 */
export function createAutoBackUpAlarm() {
  chrome.storage.local.get("client_details", (local) => {
    if (local.client_details?.tier === "Premium") {
      chrome.storage.sync.get("settings", (sync) => {
        // JSON auto backup alarm
        AppHelper.alarmGenerator(parseInt(sync.settings?.periodBackup), "json_backup", CONSTANTS.JSON_AUTOBACKUP_OFF_TOAST); // prettier-ignore

        // sync write auto backup alarm
        AppHelper.alarmGenerator(parseInt(sync.settings?.syncPeriodBackup), "sync_backup", CONSTANTS.SYNC_AUTOBACKUP_OFF_TOAST); // prettier-ignore
      });
    }
  });
}

/**
 * Handler for install events, mainly used to provide temporary access to a specific tier for existing users
 * This functionality will change later (temporary)
 */
export function handleUpdate() {
  chrome.storage.local.get("ext_version", (local) => {
    const previousVersion = local.ext_version;
    const currentVersion = process.env.REACT_APP_PRODUCTION ? chrome.runtime.getManifest().version : "1.0.0";
    if (previousVersion < currentVersion && currentVersion === "2.0.0") {
      toast(...CONSTANTS.UPDATE_TOAST(previousVersion, currentVersion));
    }

    chrome.storage.local.set({ ext_version: currentVersion }, () => {});
  });
}

/**
 * Initialize the local & sync storage when the user first installs TabMerger.
 * @param {HTMLElement} sync_node Node indicating the "Last Sync" time
 * @param {Function} setTour For re-rendering the tutorial walkthrough
 * @param {Function} setGroups For re-rendering the initial groups
 * @param {Function} setTabTotal For re-rendering the total tab counter
 */
export function storageInit(sync_node, setTour, setGroups, setTabTotal) {
  const scroll = document.documentElement.scrollTop;
  chrome.storage.sync.get(null, (sync) => {
    if (!sync.settings) {
      chrome.storage.sync.set({ settings: CONSTANTS.DEFAULT_SETTINGS }, () => {});
      AppHelper.toggleDarkMode(true);
    } else {
      AppHelper.toggleDarkMode(sync.settings.dark);
    }

    if (sync["group-0"]) {
      AppHelper.toggleSyncTimestamp(true, sync_node);
    }

    delete sync.settings;
    chrome.storage.local.get(["groups", "tour_needed"], (local) => {
      const tour_needed = !local.tour_needed && !local.groups;
      const groups = tour_needed ? TUTORIAL_GROUP : local.groups || { "group-0": CONSTANTS.DEFAULT_GROUP };

      chrome.storage.local.remove(["groups"], () => {
        chrome.storage.local.set({ groups, groups_copy: [], scroll, tour_needed }, () => {
          setTour(tour_needed);
          setGroups(JSON.stringify(groups));
          setTabTotal(AppHelper.getTabTotal(groups));
        });
      });
    });
  });
}

/**
 * Allows the user to view the tutorial again or navigate to the official homepage.
 * Choosing OK plays the tutorial, choosing Cancel navigates to the official homepage.
 * If a tutorial is replayed, the current configuration is not changed to avoid data loss!
 *
 * @param {HTMLElement} e The help button which was clicked
 * @param {string} url Link to TabMerger's official homepage
 * @param {Function} setTour For re-rendering the tour
 * @param {Function} setDialog For rendering a confirmation message
 */
export function resetTutorialChoice(e, url, setTour, setDialog) {
  var element = e.target.closest("#need-btn");
  AppHelper.elementMutationListener(element, (mutation) => {
    if (mutation.type === "attributes") {
      element.getAttribute("response") === "positive" ? setTour(true) : window.open(url, "_blank", "noreferrer");
    }
  });

  setDialog(CONSTANTS.RESET_TUTORIAL_CHOICE_DIALOG(element));
}

/**
 * Displays the tab & group information in the badge icon. Also adjusts the background color and text as needed.
 *
 * @param {number} tabTotal The current total tab count
 * @param {number?} STEP_SIZE Break point for color changes (number of tabs before color changes)
 * @param {{"green": string, "yellow": string, "orange": string, "red": string }?} COLORS The colors as hex strings of form "#FF7700"
 */
// prettier-ignore
export function badgeIconInfo(tabTotal, user, STEP_SIZE = CONSTANTS.BADGE_ICON_STEP_SIZE, COLORS = CONSTANTS.BADGE_ICON_COLORS) { 
  chrome.storage.sync.get("settings", (sync) => {
    chrome.storage.local.get("groups", (local) => {
      if (local.groups && sync.settings && ["Standard", "Premium"].includes(user.tier)) {
        const num_groups = Object.keys(local.groups).length;
        var color;
        if (tabTotal < STEP_SIZE) {
          color = COLORS.green;
        } else if (tabTotal < STEP_SIZE * 2) {
          color = COLORS.yellow;
        } else if (tabTotal < STEP_SIZE * 3) {
          color = COLORS.orange;
        } else {
          color = COLORS.red;
        }

        const showInfo = sync.settings.badgeInfo;
        const text = showInfo && tabTotal > 0 ? `${tabTotal}|${num_groups}` : "";
        const tab_translate = translate(tabTotal === 1 ? "tab" : "tabs").toLocaleLowerCase();
        const group_translate = translate(num_groups === 1 ? "group" : "groups").toLocaleLowerCase();
        const title = tabTotal > 0 ? `You currently have ${tabTotal} ${tab_translate} in ${num_groups} ${group_translate}` : CONSTANTS.BADGE_ICON_DEFAULT_TITLE;

        chrome.browserAction.setBadgeText({ text }, () => {});
        chrome.browserAction.setBadgeBackgroundColor({ color }, () => {});
        chrome.browserAction.setTitle({ title }, () => {});
      }else{
        chrome.browserAction.setBadgeText({ text: "" }, () => {});
        chrome.browserAction.setTitle({ title: CONSTANTS.BADGE_ICON_DEFAULT_TITLE }, () => {});
      }
    });
  });
}

/**
 * Updates the sync items - only those that have changes are overwritten
 * @param {HTMLElement} e Node representing the global sync write button
 * @param {HTMLElement} sync_node Node corresponding to the "Last Sync:" timestamp
 * @param {object} user The user's subscription details
 */
export function syncWrite(e, sync_node, user) {
  if (!user.paid) {
    toast(...CONSTANTS.SUBSCRIPTION_TOAST);
  } else if (e.target.closest("#sync-write-btn").classList.contains("disabled-btn")) {
    toast(...CONSTANTS.SYNC_WRITE_TOAST);
  } else {
    chrome.storage.local.get("groups", async (local) => {
      var groups = local.groups;
      if (Object.values(groups).some((val) => val.tabs.length > 0)) {
        for (var key of Object.keys(groups)) {
          await AppHelper.updateGroupItem(key, groups[key]);
        }

        // remove extras from previous sync
        chrome.storage.sync.get(null, (sync) => {
          delete sync.settings;
          var remove_keys = Object.keys(sync).filter((key) => !Object.keys(groups).includes(key));
          chrome.storage.sync.remove(remove_keys, () => {
            chrome.storage.local.set({ last_sync: AppHelper.getTimestamp() }, () => {
              AppHelper.toggleSyncTimestamp(true, sync_node);
            });
          });
        });
      }
    });

    console.info(`%c[TABMERGER INFO] %c${e.autoAction ? "automatic" : "manual"} sync performed - ${AppHelper.getTimestamp()}`, "color: blue", "color: black"); // prettier-ignore
  }
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
export function syncRead(sync_node, user, setGroups, setTabTotal) {
  if (!user.paid) {
    toast(...CONSTANTS.SUBSCRIPTION_TOAST);
  } else {
    chrome.storage.sync.get(null, (sync) => {
      if (sync["group-0"]) {
        delete sync.settings;
        chrome.storage.local.remove(["groups"], () => {
          var new_ls = {};
          var remove_keys = [];
          Object.keys(sync).forEach((key) => {
            new_ls[key] = sync[key];
            remove_keys.push(key);
          });

          chrome.storage.local.set({ groups: new_ls, scroll: document.documentElement.scrollTop }, () => {
            chrome.storage.sync.remove(remove_keys, () => {
              AppHelper.toggleSyncTimestamp(false, sync_node);
              setGroups(JSON.stringify(new_ls));
              setTabTotal(AppHelper.getTabTotal(new_ls));
            });
          });
        });
      }
    });
  }
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
export function openOrRemoveTabs(changes, namespace, setTabTotal, setGroups) {
  if (namespace === "local" && changes?.remove?.newValue?.length > 0) {
    chrome.storage.sync.get("settings", (sync) => {
      chrome.storage.local.get("groups", (local) => {
        const scroll = document.documentElement.scrollTop;
        var groups = local.groups;

        // extract and remove the button type from array
        var group_id = changes.remove.newValue[0];
        changes.remove.newValue.splice(0, 1);

        var tabs;
        if (group_id) {
          tabs = groups[group_id].tabs;
        } else {
          Object.values(groups).forEach((x) => (tabs = tabs ? [...tabs, ...x.tabs] : [...x.tabs]));
        }

        // try to not open tabs if it is already open
        chrome.tabs.query({ currentWindow: true }, (windowTabs) => {
          for (var i = 0; i < changes.remove.newValue.length; i++) {
            const tab_url = changes.remove.newValue[i];
            const same_tab = AppHelper.findSameTab(windowTabs, tab_url);
            if (same_tab[0] && !same_tab.pinned) {
              chrome.tabs.move(same_tab[0].id, { index: -1 });
            } else {
              const tab_obj = tabs.filter((x) => x.url === tab_url)[0];
              chrome.tabs.create({ pinned: tab_obj.pinned, url: tab_obj.url, active: false }, () => {});
            }
          }

          if (!sync.settings.restore) {
            if (group_id) {
              if (!groups[group_id].locked) {
                groups[group_id].tabs = tabs.filter((x) => !changes.remove.newValue.includes(x.url));
              }
            } else {
              Object.keys(groups).forEach((key) => (groups[key].tabs = !groups[key].locked ? [] : groups[key].tabs));
            }

            chrome.storage.local.set({ groups, scroll }, () => {
              setTabTotal(AppHelper.getTabTotal(groups));
              setGroups(JSON.stringify(groups));
            });
          }

          // allow reopening same tab
          chrome.storage.local.remove(["remove"], () => {});
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
 * @param {Function} setTabTotal For re-rendering the total tab counter
 * @param {Function} setGroups For re-rendering the groups
 *
 * @see SYNC_STORAGE_LIMIT in App.js
 * @see ITEM_STORAGE_LIMIT in App.js
 */
export function checkMerging(changes, namespace, setTabTotal, setGroups) {
  if (namespace === "local" && changes?.merged_tabs?.newValue?.length > 0) {
    chrome.storage.sync.get("settings", (sync) => {
      chrome.storage.local.get(["merged_tabs", "into_group", "groups", "client_details"], (local) => {
        var { into_group, merged_tabs, groups, client_details } = local;
        const scroll = document.documentElement.scrollTop;

        if (
          AppHelper.getTabTotal(groups) + merged_tabs.length <=
          CONSTANTS.USER[client_details?.tier ?? "Free"].NUM_TAB_LIMIT
        ) {
          // IF top group has tabs - add new group at top ("merging group")
          // if context menu is used to avoid merging into group with existing tabs.
          // Else - add tabs to the top group. This allows the user to star a group and then merge into it.
          if (!into_group.includes("group")) {
            into_group = "group-0";
            if (groups[into_group].tabs.length > 0) {
              const group_values = AppHelper.sortByKey(groups);
              groups[into_group] = {
                color: sync.settings.color,
                created: AppHelper.getTimestamp(),
                hidden: false,
                locked: false,
                starred: false,
                tabs: [],
                title: sync.settings.title,
              };

              group_values.forEach((val, i) => {
                groups["group-" + (i + 1)] = val;
              });
            }
          }

          // close tabs that are being merged (if settings is set to do so)
          if (sync.settings.merge) {
            chrome.tabs.remove(merged_tabs.map((x) => x.id));
          }

          const new_tabs = [...groups[into_group].tabs, ...merged_tabs];
          groups[into_group].tabs = new_tabs.map((x) => ({ pinned: x.pinned, title: x.title, url: x.url }));

          chrome.storage.local.set({ groups, scroll }, () => {
            setTabTotal(AppHelper.getTabTotal(groups));
            setGroups(JSON.stringify(groups));
          });
        } else {
          toast(...CONSTANTS.CHECK_MERGING_TOAST(client_details?.tier ?? "Free"));
        }

        // remove to be able to detect changes again (even for same tabs)
        chrome.storage.local.remove(["into_group", "merged_tabs"], () => {});
      });
    });
  }
}

/**
 * Forms the group components with tab draggable tab components inside.
 * Each formed group has correct & up-to-date information.
 * @param {string} groups A stringified object consisting of TabMerger's current group information
 * @param {{fontFamily: string, fontWeight: string}} textStyles Used to adjust the font family and weight of text in TabMerger
 *
 * @return If "groups" is defined - array of group components which include the correct number of tab components inside each.
 * Else - null
 */
export function groupFormation(groups, textStyles) {
  if (groups) {
    var parsed_groups = JSON.parse(groups);
    var group_values = Object.values(parsed_groups);
    var sorted_vals = group_values.length > 10 ? AppHelper.sortByKey(parsed_groups) : group_values;

    return sorted_vals.map((x, i) => {
      const id = "group-" + i;
      const textColor = x.color > CONSTANTS.GROUP_COLOR_THRESHOLD ? "primary" : "light";
      return (
        <Group
          id={id}
          title={x.title || x.name || CONSTANTS.DEFAULT_GROUP_TITLE}
          textColor={textColor}
          color={x.color || CONSTANTS.DEFAULT_GROUP_COLOR}
          created={x.created || AppHelper.getTimestamp()}
          num_tabs={(x.tabs && x.tabs.length) || 0}
          hidden={x.hidden}
          locked={x.locked}
          starred={x.starred}
          fontFamily={textStyles.fontFamily}
          key={Math.random()}
        >
          <Tab
            id={id}
            hidden={x.hidden}
            textColor={textColor}
            fontWeight={textStyles.fontWeight}
            fontFamily={textStyles.fontFamily}
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
 * Each new group is always empty and has a creation timestamp. Also scrolls the page
 * down so that the new group is in full view to the user.
 * @param {Function} setGroups For re-rendering the groups
 */
export function addGroup(setGroups) {
  chrome.storage.local.get(["groups", "client_details"], (local) => {
    var { groups, client_details } = local;
    const scroll = document.body.scrollHeight;
    const NUM_GROUP_LIMIT = CONSTANTS.USER[client_details?.tier]?.NUM_GROUP_LIMIT ?? CONSTANTS.USER.Free.NUM_GROUP_LIMIT; // prettier-ignore

    var num_keys = Object.keys(groups).length;
    if (num_keys < NUM_GROUP_LIMIT) {
      chrome.storage.sync.get("settings", (sync) => {
        var color;
        if (client_details?.tier === "Premium" && sync.settings.randomizeColor) {
          color = CONSTANTS.RANDOM_COLOR_LIST[Math.floor(Math.random() * CONSTANTS.RANDOM_COLOR_LIST.length)];
        } else {
          color = sync.settings.color;
        }

        groups["group-" + num_keys] = {
          color,
          created: AppHelper.getTimestamp(),
          hidden: false,
          locked: false,
          starred: false,
          tabs: [],
          title: sync.settings.title,
        };
        chrome.storage.local.set({ groups, scroll }, () => setGroups(JSON.stringify(groups)));
      });
    } else {
      toast(...CONSTANTS.ADD_GROUP_TOAST(NUM_GROUP_LIMIT));
    }
  });
}

/**
 * Sets Chrome's local storage with an array ([null, ... url_links ...]) consisting
 * of all the tabs in TabMerger to consider for removal.
 *
 * @param {HTMLElement} e Representing the Open All button
 * @param {Function} setDialog For rendering a warning/error message
 */
export function openAllTabs(e, setDialog) {
  var element = e.target.closest("#open-all-btn");
  AppHelper.elementMutationListener(element, (mutation) => {
    if (mutation.type === "attributes" && element.getAttribute("response") === "positive") {
      var tab_links = [...document.querySelectorAll(".a-tab")].map((x) => x.href);
      tab_links.unshift(null);
      chrome.storage.local.set({ remove: tab_links }, () => {});
    }
  });

  setDialog(CONSTANTS.OPEN_ALL_DIALOG(element));
}

/**
 * Allows the user to delete every UNLOCKED group (including tabs) inside TabMerger.
 * A default group is formed above all locked groups to allow for re-merging after deletion.
 * The default group has title & color matching settings parameter and a creation timestamp.
 *
 * @param {HTMLElement} e Button corresponding to the delete all operation
 * @param {Function} setTabTotal For re-rendering the total tab counter
 * @param {Function} setGroups For re-rendering the groups
 * @param {Function} setDialog For rendering the confirmation dialog
 */
export function deleteAllGroups(e, user, setTabTotal, setGroups, setDialog) {
  const scroll = document.documentElement.scrollTop;
  var element = e.target.closest("#delete-all-btn");
  AppHelper.elementMutationListener(element, (mutation) => {
    if (mutation.type === "attributes" && element.getAttribute("response") === "positive") {
      chrome.storage.local.get(["groups", "groups_copy"], (local) => {
        chrome.storage.sync.get("settings", (sync) => {
          var { groups_copy, groups } = local;
          groups_copy = AppHelper.storeDestructiveAction(groups_copy, groups, user);

          groups = {};
          var locked_counter = 0;
          document.querySelectorAll(".group-item").forEach((x) => {
            if (x.querySelector(".lock-group-btn").getAttribute("data-tip").includes(translate("unlock"))) {
              groups["group-" + locked_counter] = {
                color: x.querySelector("input[type='color']").value,
                created: x.querySelector(".created span").textContent,
                hidden: !!x.querySelector(".hidden-symbol"),
                locked: true,
                starred: x.querySelector(".star-group-btn").getAttribute("data-tip").includes(translate("unstar")),
                tabs: [...x.querySelectorAll(".draggable")].map((tab) => {
                  const a = tab.querySelector("a");
                  return { pinned: !!tab.querySelector(".pinned"), title: a.textContent, url: a.href };
                }),
                title: x.querySelector(".title-edit-input").value,
              };

              locked_counter++;
            }
          });

          groups["group-" + locked_counter] = {
            color: sync.settings.color,
            created: AppHelper.getTimestamp(),
            hidden: false,
            locked: false,
            starred: false,
            tabs: [],
            title: sync.settings.title,
          };

          chrome.storage.local.set({ groups, groups_copy, scroll }, () => {
            setTabTotal(AppHelper.getTabTotal(groups));
            setGroups(JSON.stringify(groups));
          });
        });
      });
    }
  });

  setDialog(CONSTANTS.DELETE_ALL_DIALOG(element));
}

/**
 * If a user accidently removes a tab, group, or everything. They can press the "Undo"
 * button to restore the previous configuration.
 *
 * @param {Function} setGroups For re-rendering the groups after they are reset
 * @param {Function} setTabTotal For re-rendering the tab total counter
 *
 * @note The number of states stored are based on user tier { Free: 2, Basic: 5, Standard: 10, Premium: 15 }.
 */
export function undoDestructiveAction(setGroups, setTabTotal) {
  chrome.storage.local.get(["groups", "groups_copy"], (local) => {
    if (local.groups_copy.length >= 1) {
      const scroll = document.documentElement.scrollTop;
      const prev_group = local.groups_copy.pop();

      chrome.storage.local.set({ groups: prev_group, groups_copy: local.groups_copy, scroll }, () => {
        setTabTotal(AppHelper.getTabTotal(prev_group));
        setGroups(JSON.stringify(prev_group));
      });
    } else {
      toast(...CONSTANTS.UNDO_DESTRUCTIVE_ACTION_TOAST);
    }
  });
}

/**
 * Allows the user to drag and drop an entire group with tabs inside.
 * @param {HTMLElement} e The group node being dragged.
 * @param {string} type Either group or tab, corresponding to the dragging operation.
 * @param {string?} offset Number of pixels from the top/bottom of the screen to wait for mouse position to hit, prior to scrolling
 */
export function dragOver(e, type, offset = 10) {
  const currentElement = document.querySelector(type === "group" ? ".dragging-group" : ".dragging");
  if (currentElement) {
    e.preventDefault();
    var group_block = e.target.closest(".group");
    var location = type === "group" ? e.target.closest("#tabmerger-container") : group_block.querySelector(".tabs-container"); // prettier-ignore
    const afterElement = AppHelper.getDragAfterElement(type === "group" ? location : group_block, e.clientY, type);
    !afterElement ? location?.appendChild(currentElement) : location?.insertBefore(currentElement, afterElement);

    // allow scrolling while dragging with a 10px offset from top/bottom
    if (e.clientY < offset || e.clientY > window.innerHeight - offset) {
      window.scrollTo(0, e.clientY);
    }
  }
}

/**
 * Allows the user to search for groups or tabs within TabMerger using a filter.
 * The filter is case-insensitive and updates the groups in real time as the user types.
 * This action is non-persistent and will reset once the page reloads or a re-render occurs.
 * Tabs/Groups are simply hidden from the user once a filter is applied, that is they are not
 * removed from TabMerger and thus the counts (group and global) are not updated.
 *
 * @example
 * "#TabMerger (or `@TabMerger`) ➡ Group Level Search (by group title)"
 * "TabMerger ➡ Tab Level Search (by tab title)"
 *
 * @param {HTMLElement} e Node corresponding to the search filter
 * @param {object?} user Contains information about the user's subscription
 */
export function regexSearchForTab(e, user) {
  if (user && !user.paid) {
    toast(...CONSTANTS.SUBSCRIPTION_TOAST);
  } else {
    var sections = document.querySelectorAll(".group-item");
    var tab_items = [...sections].map((x) => [...x.querySelectorAll(".draggable")]);

    var titles, match;
    if (e.target.value === "") {
      sections.forEach((section) => (section.style.display = ""));
    } else if (e.target.value.match(/^[#@]/)) {
      // GROUP
      titles = [...sections].map((x) => x.querySelector(".title-edit-input").value);
      match = e.target.value.substr(1).toLowerCase();
      titles.forEach((x, i) => (sections[i].style.display = x.toLowerCase().indexOf(match) === -1 ? "none" : ""));
    } else {
      // TAB
      titles = tab_items.map((x) => x.map((y) => y.querySelector(".a-tab").textContent.toLowerCase()));
      match = e.target.value.toLowerCase();

      titles.forEach((title, i) => {
        if (title.some((x) => x.indexOf(match) !== -1)) {
          sections[i].style.display = "";
          title.forEach((x, j) => (tab_items[i][j].style.display = x.indexOf(match) !== -1 ? "" : "none"));
        } else {
          // no need to hide tabs if group is hidden
          sections[i].style.display = "none";
        }
      });
    }
  }
}

/**
 * Clears the tab search input field when the user exits it (onBlur).
 * Additionally, this will undo the search operation and display all the tabs & groups.
 * @param {HTMLElement} e Node corresponding to the tab search filter
 *
 * @note The timeout is added to allow operations like opening a tab
 */
export function resetSearch(e) {
  setTimeout(() => {
    e.target.value = "";
    regexSearchForTab(e);
  }, 100);
}

/**
 * Allows the user to export TabMerger's current configuration (including settings).
 * Also performs auto-backups by creating JSON files in a specific folder relative to the Downloads folder at user specific intervals.
 * @param {boolean} showGrayDownloadShelf Whether or not a download will show up at the bottom of the screen (pop-up). False for auto-backup
 * @param {boolean} showSaveAsDialog Whether or not to show the saveAs dialog box. Can be configured in settings.
 * @param {string} relativePath A path relative to the Downloads folder which will contain the generated file. Cannot include "../", "./", or absolute paths.
 */
export function exportJSON(showGrayDownloadShelf, showSaveAsDialog, relativePath) {
  chrome.storage.local.get(["groups", "client_details", "file_ids"], (local) => {
    var { groups, client_details, file_ids } = local;
    if (!client_details || ["Free", "Basic"].includes(client_details.tier)) {
      toast(...CONSTANTS.SUBSCRIPTION_TOAST);
    } else {
      chrome.storage.sync.get("settings", (sync) => {
        groups["settings"] = sync.settings;
        const dataBlob = new Blob([JSON.stringify(groups, null, 2)], { type: "text/json;charset=utf-8" });
        const download_opts = {
          url: URL.createObjectURL(dataBlob),
          filename:
            (!!relativePath ? "" : sync.settings.relativePathBackup) +
            AppHelper.outputFileName().replace(/\:|\//g, "_") +
            ".json",
          conflictAction: "uniquify",
          saveAs: showSaveAsDialog === undefined ? sync.settings.saveAsVisibility : showSaveAsDialog,
        };

        // enable or disable the download gray shelf at the bottom of the window which notifies of the download.
        // For auto-backups this is disabled and saveas menu is not shown (it is configured in settings)
        if (chrome.runtime.getManifest().permissions.includes("downloads.shelf")) {
          chrome.downloads.setShelfEnabled(showGrayDownloadShelf);
        }

        chrome.downloads.download(download_opts, (downloadId) => {
          if (!chrome.runtime.lastError) {
            // if automatic -> add to list so can keep track off how many and know which to delete later
            // when this file would exceed limit, remove the oldest file
            if (!showGrayDownloadShelf) {
              const current_limit = parseInt(sync.settings?.fileLimitBackup);
              file_ids = file_ids ?? [];

              if (file_ids.length >= current_limit) {
                // user can have limit at 5 then change to 4.
                // This would cause TabMerger to keep 4 latest backups and delete the rest.
                const ids_to_remove = file_ids.length > current_limit ? file_ids.splice(0, (file_ids.length - current_limit) + 1) : [file_ids.shift()]; // prettier-ignore
                for (const old_id of ids_to_remove) {
                  chrome.downloads.removeFile(old_id, () => {
                    if (!chrome.runtime.lastError) {
                      console.info(`%c[TABMERGER INFO] %cdeleted old backup file with id=${old_id} to make room for new files - ${AppHelper.getTimestamp()}`, "color: blue", "color: black"); // prettier-ignore
                    }
                  });
                }
              }
              chrome.storage.local.set({ file_ids: [...file_ids, downloadId] }, () => {});
            }
            console.info(`%c[TABMERGER INFO] %c${showGrayDownloadShelf ? "manual" : "automatic"} download of file with id=${downloadId} - ${AppHelper.getTimestamp()}`, "color: blue", "color: black"); // prettier-ignore
          } else {
            chrome.runtime.lastError != "Error: Download canceled by the user" && toast(...CONSTANTS.DOWNLOAD_ERROR_TOAST); // prettier-ignore
          }
        });
      });
    }
  });
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
export function importJSON(e, user, setGroups, setTabTotal) {
  if (e.target.files[0].type === "application/json") {
    chrome.storage.local.get(["groups", "groups_copy"], (local) => {
      const groups_copy = AppHelper.storeDestructiveAction(local.groups_copy, local.groups, user);
      const scroll = document.documentElement.scrollTop;

      var reader = new FileReader();
      reader.readAsText(e.target.files[0]);
      reader.onload = () => {
        var fileContent = JSON.parse(reader.result);

        chrome.storage.sync.set({ settings: fileContent.settings }, () => {
          delete fileContent.settings;
          chrome.storage.local.set({ groups: fileContent, groups_copy, scroll }, () => {
            e.target.value = ""; // reset the file input so it can trigger again
            setGroups(JSON.stringify(fileContent));
            setTabTotal(AppHelper.getTabTotal(fileContent));
          });
        });
      };
    });
  } else {
    toast(...CONSTANTS.IMPORT_JSON_TOAST);
  }
}

/**
 * On different browsers, this generates the corresponding link to the browser's webstore
 * where TabMerger can be downloaded.
 * @param {boolean} reviews Whether or not the link should be to a reviews page
 *
 * @return A URL link to TabMerger's webstore (or reviews) page
 */
export function getTabMergerLink(reviews) {
  var link;
  var isFirefox = typeof InstallTrigger !== "undefined";
  var isChrome = !!chrome && !!chrome.runtime;
  var isEdge = isChrome && navigator.userAgent.indexOf("Edg") !== -1;

  if (isEdge) {
    link = "https://microsoftedge.microsoft.com/addons/detail/tabmerger/eogjdfjemlgmbblgkjlcgdehbeoodbfn";
  } else if (isFirefox) {
    link = "https://addons.mozilla.org/en-CA/firefox/addon/tabmerger";
  } else if (isChrome) {
    link = "https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc";
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
