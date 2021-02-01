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

import React, { useState, useEffect, useRef, useCallback } from "react";

import * as AppFunc from "./App_functions";
import * as AppHelper from "./App_helpers";

import GlobalBtns from "../Button/GlobalBtns.js";
import Header from "../Extra/Header.js";
import TabSearch from "../Extra/TabSearch.js";
import Reviews from "../Extra/Reviews.js";
import Links from "../Extra/Links.js";

import { AppProvider } from "../../context/AppContext";

import "./App.css";
import "../Button/Button.css";
import "bootstrap/dist/css/bootstrap.min.css";

export default function App() {
  /** @constant {Number} ITEM_STORAGE_LIMIT @default 8000 (500 for testing) */
  const ITEM_STORAGE_LIMIT = useRef(8000);
  /** @constant {Number} SYNC_STORAGE_LIMIT @default 102000 (1000 for testing) */
  const SYNC_STORAGE_LIMIT = useRef(102000);
  /** @constant {Number} NUM_GROUP_LIMIT @default 100 (3 for testing) */
  const NUM_GROUP_LIMIT = useRef(100);

  var syncTimestamp = useRef();

  /** @constant {Object} defaultGroup @default { color: "#dedede", created: AppHelper.getTimestamp(), hidden: false, locked: false, starred: false, tabs: [], title: "Title" } */
  const defaultGroup = useRef({ color: "#dedede", created: AppHelper.getTimestamp(), hidden: false, locked: false, starred: false, tabs: [], title: "Title" }); // prettier-ignore
  /** @constant {Object} defaultSettings @default { badgeInfo: "display", blacklist: "", color: "#dedede", dark: true, merge: "merge", open: "without", pin: "include", restore: "keep", title: "Title" } */
  const defaultSettings = useRef({ badgeInfo: "display", blacklist: "", color: "#dedede", dark: true, merge: "merge", open: "without", pin: "include", restore: "keep", title: "Title" }); // prettier-ignore

  const [tabTotal, setTabTotal] = useState(0);
  const [groups, setGroups] = useState(null);

  const toggleSyncTimestamp = useCallback(
    (positive) => {
      AppHelper.toggleSyncTimestamp(positive, syncTimestamp.current);
    },
    [syncTimestamp]
  );

  useEffect(() => {
    AppFunc.storageInit(defaultSettings.current, defaultGroup.current, syncTimestamp.current, setGroups, setTabTotal);
  }, [toggleSyncTimestamp]);

  useEffect(() => {
    const openOrRemoveTabs = (changes, namespace) => {
      AppFunc.openOrRemoveTabs(changes, namespace, setTabTotal, setGroups);
    };

    const checkMerging = (changes, namespace) => {
      AppFunc.checkMerging(changes, namespace, SYNC_STORAGE_LIMIT.current, ITEM_STORAGE_LIMIT.current, setTabTotal, setGroups); // prettier-ignore
    };

    chrome.storage.onChanged.addListener(openOrRemoveTabs);
    chrome.storage.onChanged.addListener(checkMerging);

    return () => {
      chrome.storage.onChanged.removeListener(openOrRemoveTabs);
      chrome.storage.onChanged.removeListener(checkMerging);
    };
  }, []);

  useEffect(() => {
    AppFunc.badgeIconInfo(tabTotal);
  }, [tabTotal, groups]);

  useEffect(() => {
    chrome.storage.local.get("scroll", (local) => {
      setTimeout(() => {
        document.documentElement.scrollTop = local.scroll || 0;
      }, 50);
    });
  }, [groups]);

  return (
    <div id="app-wrapper" className="text-center">
      <nav id="sidebar">
        <Header total={tabTotal} />
        <hr className="mx-auto d-none shown-in-print" />
        <Reviews />

        <div id="global-action-container">
          <TabSearch />
          <hr className="mx-auto hidden-in-print" />

          {/* prettier-ignore */}
          <GlobalBtns syncTimestamp={syncTimestamp} group_limit={NUM_GROUP_LIMIT.current} setTabTotal={setTabTotal} setGroups={setGroups}/>
          <Links />
        </div>

        <div id="copyright" className="mt-4">
          Copyright &copy; {new Date().getFullYear()} Lior Bragilevsky
        </div>
      </nav>

      <AppProvider value={{ setGroups, setTabTotal }}>
        <div className="container-fluid col" id="tabmerger-container" onDragOver={(e) => AppFunc.dragOver(e, "group")}>
          {AppFunc.groupFormation(groups, ITEM_STORAGE_LIMIT.current)}
        </div>
      </AppProvider>
    </div>
  );
}
