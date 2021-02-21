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
import Tour from "reactour";

import * as AppFunc from "./App_functions";
import * as AppHelper from "./App_helpers";

import GlobalBtns from "../Button/GlobalBtns";
import Header from "../Extra/Header";
import TabSearch from "../Extra/TabSearch";
import Reviews from "../Extra/Reviews";
import Links from "../Extra/Links";
import Dialog from "../Extra/Dialog";
import Button from "../Button/Button";
import { TOUR_STEPS } from "../Extra/Tutorial";
import { AppProvider } from "../../context/AppContext";
import { BiCheckCircle } from "react-icons/bi";

import "./App.css";
import "../Button/Button.css";
import "bootstrap/dist/css/bootstrap.min.css";

export default function App() {
  /** @constant {Number} ITEM_STORAGE_LIMIT @default 8000 (500 for testing) */
  const ITEM_STORAGE_LIMIT = useRef(8000);
  /** @constant {Number} SYNC_STORAGE_LIMIT @default 102000 (1000 for testing) */
  const SYNC_STORAGE_LIMIT = useRef(102000);

  var syncTimestamp = useRef();

  /** @constant {Object} defaultGroup @default { color: "#dedede", created: AppHelper.getTimestamp(), hidden: false, locked: false, starred: false, tabs: [], title: "Title" } */
  const defaultGroup = useRef({ color: "#dedede", created: AppHelper.getTimestamp(), hidden: false, locked: false, starred: false, tabs: [], title: "Title" }); // prettier-ignore
  /** @constant {Object} defaultSettings @default { badgeInfo: "display", blacklist: "", color: "#dedede", dark: true, font: "Arial", merge: "merge", open: "without", pin: "include", restore: "keep", title: "Title", weight: "Normal" } */
  const defaultSettings = useRef({ badgeInfo: "display", blacklist: "", color: "#dedede", dark: true, font: "Arial", merge: "merge", open: "without", pin: "include", restore: "keep", title: "Title", weight: "Normal" }); // prettier-ignore

  // app parameters
  const [tabTotal, setTabTotal] = useState(0);
  const [groups, setGroups] = useState(null);
  const [dialog, setDialog] = useState({ show: false });

  // activation parameters
  const [user, setUser] = useState({ paid: false, tier: "Free" });

  // tutorial parameters
  const [tour, setTour] = useState(false);
  const startStep = useRef(0);

  useEffect(() => {
    function openOrRemoveTabs(changes, namespace) {
      AppFunc.openOrRemoveTabs(changes, namespace, setTabTotal, setGroups);
    }

    function checkMerging(changes, namespace) {
      AppFunc.checkMerging(changes, namespace, SYNC_STORAGE_LIMIT.current, ITEM_STORAGE_LIMIT.current, setTabTotal, setGroups, setDialog); // prettier-ignore
    }

    function toggleHiddenOrEmptyGroups(type) {
      document.querySelectorAll(".hidden, .empty").forEach((x) => (x.style.display = type === "before" ? "none" : ""));
    }

    if (process.env.NODE_ENV !== "test") {
      chrome.storage.local.get("client_details", (local) => {
        if (local.client_details) {
          AppFunc.checkUserStatus(setUser);
        }
      });
    }

    AppFunc.storageInit(defaultSettings.current, defaultGroup.current, syncTimestamp.current, setTour, setGroups, setTabTotal); // prettier-ignore

    chrome.storage.onChanged.addListener(openOrRemoveTabs);
    chrome.storage.onChanged.addListener(checkMerging);
    window.addEventListener("beforeprint", () => toggleHiddenOrEmptyGroups("before"));
    window.addEventListener("afterprint", () => toggleHiddenOrEmptyGroups("after"));

    return () => {
      chrome.storage.onChanged.removeListener(openOrRemoveTabs);
      chrome.storage.onChanged.removeListener(checkMerging);
      window.removeEventListener("beforeprint", () => toggleHiddenOrEmptyGroups("before"));
      window.removeEventListener("afterprint", () => toggleHiddenOrEmptyGroups("after"));
    };
  }, []);

  useEffect(() => AppFunc.badgeIconInfo(tabTotal, user), [groups, tabTotal, user]);

  useEffect(() => {
    chrome.storage.local.get("scroll", (local) => {
      setTimeout(() => (document.documentElement.scrollTop = local.scroll || 0), 50);
    });
  }, [groups]);

  return (
    <div id="app-wrapper" className="text-center">
      <Dialog {...dialog} setDialog={setDialog} />
      <Tour
        steps={TOUR_STEPS}
        isOpen={!!tour}
        onRequestClose={() => setTour(false)}
        badgeContent={(current, total) => `Step ${current}/${total}`}
        closeWithMask={false}
        showNavigationNumber={false}
        disableFocusLock={true}
        disableKeyboardNavigation={["esc"]}
        getCurrentStep={(step_num) => (startStep.current = step_num)}
        startAt={startStep.current}
        rounded={5}
        lastStepNextButton={<button className="btn btn-dark">🏁</button>}
      />
      <nav id="sidebar">
        <Header total={tabTotal} />
        <hr className="mx-auto d-none shown-in-print" />
        <Reviews />

        <div id="global-action-container">
          <TabSearch user={user} setDialog={setDialog} />
          <hr className="mx-auto hidden-in-print" />

          {/* prettier-ignore */}
          <GlobalBtns user={user} syncTimestamp={syncTimestamp} setTabTotal={setTabTotal} setGroups={setGroups} setDialog={setDialog}/>
          <Links setTour={setTour} setDialog={setDialog} />
        </div>

        {/* Verify/activate account button*/}
        <Button
          classes="p-0 btn-in-global"
          id="subscription-btn"
          translate="Activate Tier"
          onClick={() => AppFunc.setUserStatus(setUser, setDialog)}
        >
          {<BiCheckCircle color="black" size="1.5rem" />}
        </Button>

        <div id="copyright" className="mt-4">
          Copyright &copy; {new Date().getFullYear()} Lior Bragilevsky
        </div>
      </nav>
      <AppProvider value={{ user, setGroups, setTabTotal, setDialog }}>
        <div className="container-fluid col" id="tabmerger-container" onDragOver={(e) => AppFunc.dragOver(e, "group")}>
          {AppFunc.groupFormation(groups, ITEM_STORAGE_LIMIT.current)}
        </div>
      </AppProvider>
    </div>
  );
}
