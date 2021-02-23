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
 * @module __CONSTANTS
 */

import React from "react";
import { getTimestamp } from "../components/App/App_helpers";

export const USER = {
  Free: {
    NUM_TAB_LIMIT: process.env.REACT_APP_PRODUCTION ? 50 : 15,
    NUM_GROUP_LIMIT: process.env.REACT_APP_PRODUCTION ? 5 : 3,
    NUM_UNDO_STATES: process.env.REACT_APP_PRODUCTION ? 2 : 1,
  },
  Basic: {
    NUM_TAB_LIMIT: process.env.REACT_APP_PRODUCTION ? 250 : 16,
    NUM_GROUP_LIMIT: process.env.REACT_APP_PRODUCTION ? 15 : 4,
    NUM_UNDO_STATES: process.env.REACT_APP_PRODUCTION ? 5 : 2,
  },
  Standard: {
    NUM_TAB_LIMIT: process.env.REACT_APP_PRODUCTION ? 2500 : 17,
    NUM_GROUP_LIMIT: process.env.REACT_APP_PRODUCTION ? 50 : 5,
    NUM_UNDO_STATES: process.env.REACT_APP_PRODUCTION ? 10 : 3,
  },
  Premium: {
    NUM_TAB_LIMIT: process.env.REACT_APP_PRODUCTION ? 10000 : 18,
    NUM_GROUP_LIMIT: process.env.REACT_APP_PRODUCTION ? 100 : 6,
    NUM_UNDO_STATES: process.env.REACT_APP_PRODUCTION ? 15 : 4,
  },
};

export const FONT_FAMILY = {
  Arial: "Arial, sans-serif",
  Verdana: "Verdana, sans-serif",
  Helvetica: "Helvetica, sans-serif",
  Tahoma: "Tahoma, sans-serif",
  "Trebuchet MS": "'Trebuchet MS', sans-serif",
  "Brush Script MT": "'Brush Script MT', cursive",
  Georgia: "Georgia, serif",
  Garamond: "Garamond, serif",
  "Courier New": "'Courier New', monospace",
  "Times New Roman": "'Times New Roman', serif",
};

export const FONT_WEIGHT = {
  Bold: "bold",
  Bolder: "bolder",
  Normal: "normal",
  Lighter: "lighter",
  Light: "100",
};

export const DEFAULT_GROUP_TITLE = "Title";
export const DEFAULT_GROUP_COLOR = "#dedede";
export const GROUP_COLOR_THRESHOLD = "#777777";

export const BADGE_ICON_STEP_SIZE = 25;
export const BADGE_ICON_COLORS = { green: "#060", yellow: "#CC0", orange: "#C70", red: "#C00" };
export const BADGE_ICON_DEFAULT_TITLE = "Merge your tabs into groups";

/** @constant {Number} ITEM_STORAGE_LIMIT @default 8000 (500 for testing) */
export const ITEM_STORAGE_LIMIT = process.env.REACT_APP_PRODUCTION ? 8000 : 500;

/** @constant {Number} SYNC_STORAGE_LIMIT @default 102000 (1000 for testing) */
export const SYNC_STORAGE_LIMIT = process.env.REACT_APP_PRODUCTION ? 102000 : 1000;

/** @constant {Number} TITLE_TRIM_LIMIT @default 50 */
export const TITLE_TRIM_LIMIT = 50;

/** @constant {Object} DEFAULT_GROUP @default { color: "#dedede", created: AppHelper.getTimestamp(), hidden: false, locked: false, starred: false, tabs: [], title: "Title" } */
export const DEFAULT_GROUP = {
  color: DEFAULT_GROUP_COLOR,
  created: getTimestamp(),
  hidden: false,
  locked: false,
  starred: false,
  tabs: [],
  title: DEFAULT_GROUP_TITLE,
};

export const DEFAULT_BACKUP_PERIOD_IN_MINUTES = 12 * 60;

/** @constant {Object} DEFAULT_SETTINGS @default { badgeInfo: "display", blacklist: "", color: "#dedede", dark: true, font: "Arial", merge: "merge", open: "without", pin: "include", restore: "keep", title: "Title", weight: "Normal" } */
export const DEFAULT_SETTINGS = {
  badgeInfo: "display",
  blacklist: "",
  color: DEFAULT_GROUP_COLOR,
  dark: true,
  font: "Arial",
  merge: "merge",
  open: "without",
  periodBackup: DEFAULT_BACKUP_PERIOD_IN_MINUTES,
  pin: "include",
  relativePathBackup: "TabMerger/",
  restore: "keep",
  syncPeriodBackup: DEFAULT_BACKUP_PERIOD_IN_MINUTES,
  title: DEFAULT_GROUP_TITLE,
  weight: "Normal",
};

/* DATABASE & SUBSCRIPTION LINKS */
export const USER_STATUS_URL = process.env.REACT_APP_PRODUCTION ? "https://tabmerger-backend.herokuapp.com/v1/customer/" : "http://localhost:5000/v1/customer/"; // prettier-ignore
export const SUBSCRIPTION_URL = process.env.REACT_APP_PRODUCTION ? "https://lbragile.github.io/TabMerger-Extension/pricing" : "http://localhost:3000/TabMerger-Extension/pricing"; // prettier-ignore

/* TOASTS */
export const SUBSCRIPTION_TOAST = [
  <div className="text-left">
    To use this feature, you need to <b>upgrade</b> your TabMerger subscription.
    <br />
    <br />
    Please visit our official homepage's{" "}
    <a href={SUBSCRIPTION_URL} target="_blank" rel="noreferrer">
      Subscriptions & Pricing
    </a>{" "}
    page for more information.
  </div>,
  { toastId: "subscription_toast" },
];

export const SYNC_WRITE_TOAST = [
  <div className="text-left">
    Either one (or more) of your groups exceed(s) their respective sync limit <u>or</u> the total sync limit is exceeded
    - see TabMerger's sync indicators. <br /> <br />
    Please adjust these as needed by doing <b>one or both</b> of the following:
    <ul style={{ marginLeft: "25px" }}>
      <li>Delete tabs that are no longer important/relevant to you;</li>
      <li>Delete some tab groups for the same reasoning as above.</li>
    </ul>
    Perform these actions until the corresponding indicators are no longer visible in TabMerger.
  </div>,
  { toastId: "syncWrite_exceed" },
];

export const CHECK_MERGING_TOAST = (tier) => [
  <div className="text-left">
    This would exceed your plan's ({tier} Tier) tab limit of <b>{USER[tier].NUM_TAB_LIMIT}</b>!<br />
    <br />
    To successfully execute this action you should do <b>one</b> of the following:
    <ul style={{ marginLeft: "25px" }}>
      <li>If you are merging tabs into TabMerger, try to merge less tabs;</li>
      <li>Remove a few tabs that are not as important/relevant to you anymore;</li>
      <li>
        Upgrade your subscription by visiting our official homepage's{" "}
        <a href={SUBSCRIPTION_URL} target="_blank" rel="noreferrer">
          Subscriptions & Pricing
        </a>
      </li>
    </ul>
  </div>,
  { toastId: "tabExceed_toast" },
];

export const ADD_GROUP_TOAST = (NUM_GROUP_LIMIT) => [
  <div className="text-left">
    Number of groups exceeded (more than <b>{NUM_GROUP_LIMIT}</b>).
    <br />
    <br />
    Please do <b>one</b> of the following:
    <ul style={{ marginLeft: "25px" }}>
      <li>Delete a group that is no longer needed;</li>
      <li>Merge tabs into another existing group;</li>
      <li>
        Upgrade your TabMerger subscription (
        <a href={SUBSCRIPTION_URL} target="_blank" rel="noreferrer">
          Subscriptions & Pricing
        </a>
        ).
      </li>
    </ul>
  </div>,
  { toastId: "addGroup_toast" },
];

export const UNDO_DESTRUCTIVE_ACTION_TOAST = [
  <div className="text-left">
    There are <b>no more</b> states to undo. <br />
    <br />
    States are created with <u>destructive actions</u>! <br />
    <br />
    Upgrading your subscription will increase the number of undos that can be performed. <br />
    <br />
    Please visit our official homepage's{" "}
    <a href={SUBSCRIPTION_URL} target="_blank" rel="noreferrer">
      Subscriptions & Pricing
    </a>{" "}
    page for more information.
  </div>,
  { toastId: "undoStates_toast" },
];

export const IMPORT_JSON_TOAST = [
  <div className="text-left">
    You must import a JSON file <i>(.json extension)</i>!<br />
    <br />
    These can be generated via the <b>Export JSON</b> button.
    <br />
    <br />
    <b>Be careful</b>, <u>only import JSON files generated by TabMerger</u>, otherwise you risk losing your current
    configuration!
  </div>,
  { toastId: "importJSON_toast" },
];

export const ADD_TAB_FROM_URL_TOAST = [
  <div className="text-left">That tab is already in TabMerger!</div>,
  { toastId: "addTabFromURL_toast" },
];

export const DELETE_GROUP_TOAST = [
  <div className="text-left">
    This group is <b>locked</b>, thus it cannot be deleted. <br />
    <br /> Press the <b>lock</b> symbol to first <i>unlock</i> the group and then retry deleting it again!
  </div>,
  { toastId: "deleteGroup_toast" },
];

export const REMOVE_TAB_TOAST = [
  <div className="text-left">
    This group is <b>locked</b> and thus tabs inside cannot be deleted. <br />
    <br /> Press the <b>lock</b> symbol to first <i>unlock</i> the group and then retry deleting the tab again!
  </div>,
  { toastId: "removeTab_toast" },
];

/* MODAL DIALOG */
export const OPEN_ALL_DIALOG = (element) => ({
  element,
  show: true,
  title: "✔ TabMerger Confirmation Request ❌",
  msg: (
    <div>
      Are you sure you want to open <b>ALL</b> your tabs at once?
      <br />
      <br></br>We do <b>not</b> recommend opening <u>more than 100 tabs</u> at once as it may overload your system!
    </div>
  ),
  accept_btn_text: "YES, OPEN ALL",
  reject_btn_text: "CANCEL",
});

export const DELETE_ALL_DIALOG = (element) => ({
  element,
  show: true,
  title: "✔ TabMerger Confirmation Request ❌",
  msg: (
    <div>
      Are you sure?
      <br />
      <br />
      This action will delete <b>ALL</b> groups/tabs that are <u>not locked</u>.<br />
      <br />
      Make sure you have a backup!
    </div>
  ),
  accept_btn_text: "YES, DELETE ALL",
  reject_btn_text: "CANCEL",
});

export const RESET_TUTORIAL_CHOICE_DIALOG = (element) => ({
  element,
  show: true,
  title: "✋ TabMerger Question ❔",
  msg: (
    <div>
      Press <b>VIEW TUTORIAL</b> to get a walkthrough of TabMerger's main features{" "}
      <u>
        <i>OR</i>
      </u>{" "}
      <b>GO TO SITE</b> to visit TabMerger's official homepage!
    </div>
  ),
  accept_btn_text: "VIEW TUTORIAL",
  reject_btn_text: "GO TO SITE",
});

export const DOWNLOAD_ERROR_TOAST = [
  <div className="text-left">
    The <b>relative path</b> you have set in the settings is <b>not valid</b>, please adjust it.
  </div>,
  { toastId: "relativePathError_toast" },
];

export const JSON_AUTOBACKUP_OFF_TOAST = [
  <div className="text-left">
    Automatic JSON file generation/backup was turned off since the saving period was set to 0 minutes.
  </div>,
  { toastId: "automaticBackupOff_toast" },
];

export const SYNC_AUTOBACKUP_OFF_TOAST = [
  <div className="text-left">
    Automatic sync write backup was turned off since the saving period was set to 0 minutes.
  </div>,
  { toastId: "automaticBackupOff_toast" },
];
