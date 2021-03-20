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

/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-empty-function */

import { DefaultGroup } from "../../src/typings/common";
import { TabState } from "../../src/typings/Tab";

global.chrome = {
  /* @ts-ignore */
  alarms: {
    get: () => {},
    clear: () => {},
    create: () => {},
    onAlarm: ({
      addListener: () => {},
      removeListener: () => {},
    } as unknown) as chrome.alarms.AlarmEvent,
  },
  /* @ts-ignore */
  browserAction: {
    onClicked: ({ addListener: () => {} } as unknown) as chrome.browserAction.BrowserClickedEvent,
    setBadgeText: (_, cb) => cb(),
    setBadgeBackgroundColor: (_, cb) => cb(),
    setTitle: (_, cb) => cb(),
  },
  /* @ts-ignore */
  commands: {
    onCommand: ({ addListener: () => {} } as unknown) as chrome.commands.CommandEvent,
  },
  /* @ts-ignore */
  contextMenus: {
    create: () => {},
    onClicked: ({ addListener: () => {} } as unknown) as chrome.contextMenus.MenuClickedEvent,
  },
  /* @ts-ignore */
  downloads: {
    download: (_, cb) => cb(2),
    removeFile: (_, cb) => cb(),
    setShelfEnabled: () => {},
  },
  /* @ts-ignore */
  i18n: {
    getMessage: (msg) => {
      if (msg === "Title") {
        return "титул";
      } else {
        throw new Error("Translation for input does not exist");
      }
    },
  },
  /* @ts-ignore */
  runtime: {
    id: "ldhahppapilmnhocniaifnlieiofgnii",
    getManifest: (): { version: string; permissions: string[]; manifest_version: number; name: string } => ({
      version: "2.0.0",
      permissions: ["tabs", "contextMenus", "storage", "alarms", "downloads", "downloads.shelf"],
      manifest_version: 2,
      name: "TabMerger",
    }),
    setUninstallURL: () => {},
    sendMessage: () => {},
    onMessage: ({ addListener: () => {} } as unknown) as chrome.runtime.ExtensionMessageEvent,
  },
  storage: {
    local: {
      /* @ts-ignore */
      get: (keys: string | string[], cb: (local: unknown | DefaultGroup) => void) => {
        let item: { [key: string]: DefaultGroup };
        if (keys) {
          const local = {};
          // create array if not already
          keys = Array.isArray(keys) ? keys : [keys];
          keys.forEach((key) => {
            // can be a simple string or a stringify
            try {
              /* @ts-ignore */
              local[key] = JSON.parse(localStorage.getItem(key));
            } catch (err) {
              /* @ts-ignore */
              local[key] = localStorage.getItem(key);
            }
          });
          cb(local);
        } else {
          item = { ...localStorage };
          /* @ts-ignore */
          Object.keys(item).forEach((key) => (item[key] = JSON.parse(item[key])));
          cb(item);
        }
      },
      remove: (keys, cb) => {
        if (Array.isArray(keys)) {
          keys.forEach((key) => {
            localStorage.removeItem(key);
          });
        } else {
          localStorage.removeItem(keys);
        }

        cb();
      },
      set: (obj, cb) => {
        const key = Object.keys(obj)[0];
        /* @ts-ignore */
        localStorage.setItem(key, JSON.stringify(obj[key]));
        cb();
      },
    },
    sync: {
      /* @ts-ignore */
      get: (key: string | string[], cb) => {
        let item: { [key: string]: DefaultGroup };
        if (key) {
          /* @ts-ignore */
          item = JSON.parse(sessionStorage.getItem(key));
          /* @ts-ignore */
          cb({ [key]: item });
        } else {
          item = { ...sessionStorage };
          Object.keys(item).forEach((key) => {
            /* @ts-ignore */
            item[key] = JSON.parse(item[key]);
          });
          cb(item);
        }
      },
      remove: (keys, cb) => {
        if (Array.isArray(keys)) {
          keys.forEach((key) => {
            sessionStorage.removeItem(key);
          });
        } else {
          sessionStorage.removeItem(keys);
        }

        cb();
      },
      set: (obj, cb) => {
        const key = Object.keys(obj)[0];
        /* @ts-ignore */
        sessionStorage.setItem(key, JSON.stringify(obj[key]));
        cb();
      },
    },
    onChanged: ({ addListener: () => {}, removeListener: () => {} } as unknown) as chrome.storage.StorageChangedEvent,
  },
  tabs: {
    /* @ts-ignore */
    create: (obj: TabState, cb: () => void) => {
      const open_tabs = JSON.parse(sessionStorage.getItem("open_tabs"));
      open_tabs.push(obj);
      sessionStorage.setItem("open_tabs", JSON.stringify(open_tabs));

      cb();
    },
    /* @ts-ignore */
    move: (id: number): void => {
      const open_tabs = JSON.parse(sessionStorage.getItem("open_tabs"));

      const tab_to_move = open_tabs.filter((x: TabState) => x.id === id);
      const index = open_tabs.indexOf(tab_to_move[0]);
      open_tabs.push(open_tabs.splice(index, 1)[0]); // move it to the end

      sessionStorage.setItem("open_tabs", JSON.stringify(open_tabs));
    },
    /* @ts-ignore */
    query: (opts: { active: boolean; title: string }, cb: (open_tabs: TabState[]) => void) => {
      const open_tabs =
        opts.active || opts.title === "TabMerger"
          ? [{ title: "TabMerger", url: "https://github.com/lbragile/TabMerger", id: 99 }]
          : JSON.parse(sessionStorage.getItem("open_tabs"));
      cb(open_tabs);
    },
    /* @ts-ignore */
    remove: (ids: number[]) => {
      ids = Array.isArray(ids) ? ids : [ids];
      const open_tabs = JSON.parse(sessionStorage.getItem("open_tabs"));
      const remain_open_tabs = open_tabs.filter((x: TabState) => !ids.includes(x.id));
      sessionStorage.setItem("open_tabs", JSON.stringify(remain_open_tabs));
    },
    /* @ts-ignore */
    update: (_tabId: number, _updateProperties: chrome.tabs.UpdateProperties, cb: () => void) => cb(),
    onUpdated: ({
      addListener: (cb: () => void) => cb(),
      removeListener: (cb: () => void) => cb(),
    } as unknown) as chrome.tabs.TabUpdatedEvent,
  },
};
