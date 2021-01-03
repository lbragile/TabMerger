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

import React, { useState, useEffect, useRef, useCallback } from "react";
import Button from "../Button/Button.js";

import * as AppFunc from "./App_functions";

import "./App.css";
import "../Button/Button.css";
import "bootstrap/dist/css/bootstrap.min.css";

import { AiOutlineSearch, AiFillGithub, AiFillLinkedin } from "react-icons/ai";
import { BiImport, BiExport, BiHelpCircle } from "react-icons/bi";
import { BsCloudUpload, BsCloudDownload, BsChat, BsInfoCircle } from "react-icons/bs"; // prettier-ignore
import { FiYoutube, FiStar, FiSettings } from "react-icons/fi";
import { GiExpand } from "react-icons/gi";
import { GrClear, GrAddCircle } from "react-icons/gr";
import { RiHandCoinLine } from "react-icons/ri";

export default function App() {
  const ITEM_STORAGE_LIMIT = useRef(8000); //500 for testing - 8000 for production
  const SYNC_STORAGE_LIMIT = useRef(102000); //1000 for testing - 102000 for production
  const NUM_GROUP_LIMIT = useRef(100); // 3 for testing - 100 for production

  const links = useRef([
    // prettier-ignore
    { url: "https://tabmerger.herokuapp.com/", text: "Help", icon: <BiHelpCircle color="black" /> },
    // prettier-ignore
    { url: "https://youtu.be/zkI0T-GzmzQ", text: "Demo", icon: <FiYoutube color="black" /> },
    // prettier-ignore
    { url: process.env.REACT_APP_PAYPAL_URL, text: "Donate", icon: <RiHandCoinLine color="black" /> },
    // prettier-ignore
    { url: AppFunc.getTabMergerLink(true), text: "Review", icon: <FiStar color="black" /> },
    // prettier-ignore
    { url: "https://tabmerger.herokuapp.com/contact", text: "Contact", icon: <BsChat color="black" /> },
    // prettier-ignore
    { url: "https://github.com/lbragile/TabMerger", text: "GitHub", icon: <AiFillGithub color="black" /> },
    // prettier-ignore
    { url: "https://www.linkedin.com/in/liorbragilevsky/", text: "LinkedIn", icon: <AiFillLinkedin color="black" /> },
  ]);

  var syncTimestamp = useRef();

  const defaultGroup = useRef({
    color: "#dedede",
    created: AppFunc.getTimestamp(),
    tabs: [],
    title: "Title",
  });

  const defaultSettings = useRef({
    blacklist: "",
    color: "#dedede",
    dark: true,
    open: "without",
    restore: "keep",
    title: "Title",
  });

  const [tabTotal, setTabTotal] = useState(0);
  const [groups, setGroups] = useState();

  const toggleSyncTimestamp = useCallback(
    (positive) => {
      AppFunc.toggleSyncTimestampHelper(positive, syncTimestamp.current);
    },
    [syncTimestamp]
  );

  useEffect(() => {
    // prettier-ignore
    AppFunc.storageInit(defaultSettings.current, defaultGroup.current, syncTimestamp.current, setGroups, setTabTotal);
  }, [toggleSyncTimestamp]);

  useEffect(() => {
    const openOrRemoveTabs = (changes, namespace) => {
      // prettier-ignore
      AppFunc.openOrRemoveTabsHelper(changes, namespace, setTabTotal, setGroups);
    };

    const checkMerging = (changes, namespace) => {
      // prettier-ignore
      AppFunc.checkMergingHelper(changes, namespace, SYNC_STORAGE_LIMIT.current, ITEM_STORAGE_LIMIT.current, setTabTotal, setGroups);
    };

    chrome.storage.onChanged.addListener(openOrRemoveTabs);
    chrome.storage.onChanged.addListener(checkMerging);

    return () => {
      chrome.storage.onChanged.removeListener(openOrRemoveTabs);
      chrome.storage.onChanged.removeListener(checkMerging);
    };
  }, []);

  return (
    <div id="app-wrapper" className="text-center">
      <nav id="mySidebar" className="sidebar">
        <a href={AppFunc.getTabMergerLink(false)}>
          <img
            id="logo-img"
            className="my-4"
            src="./images/logo-full-rescale.PNG"
            alt="TabMerger Logo"
          />
        </a>
        <div className="subtitle">
          <h2 id="tab-total" className="mt-2 mb-4">
            <span className="small">
              {tabTotal + (tabTotal === 1 ? " Tab" : " Tabs")}
            </span>
          </h2>
        </div>
        <div className="input-group search-filter my-3 mx-auto">
          <div className="input-group-prepend">
            <span className="input-group-text">
              <AiOutlineSearch color="white" />
            </span>
          </div>
          <input
            type="text"
            name="search-group"
            maxLength={20}
            placeholder="Search for tabs..."
            onChange={(e) => AppFunc.filterRegEx(e)}
          />
          <div className="input-group-append">
            <span className="input-group-text">
              <div className="tip">
                <BsInfoCircle color="white" size="1rem" />
                <span className="tiptext-global-white text-left">
                  <small>
                    #_ &rarr; Group
                    <br />_ &rarr; Tab
                  </small>
                </span>
              </div>
            </span>
          </div>
        </div>

        <hr className="my-4 mx-auto" />

        <div className="global-btn-row col">
          <p className="mx-auto alert alert-danger" id="sync-text">
            <b>Sync:</b> <span ref={syncTimestamp}>--/--/---- @ --:--:--</span>
          </p>

          <Button
            id="options-btn"
            classes="p-0 mx-auto d-block btn-in-global"
            translate={AppFunc.translate("settings")}
            tooltip={"tiptext-global"}
            onClick={() => window.location.assign("/settings/settings.html")}
          >
            <FiSettings color="black" size="1.6rem" />
          </Button>

          <div>
            <Button
              id="open-all-btn"
              classes="p-0 mx-1 btn-in-global"
              translate={AppFunc.translate("openAll")}
              tooltip={"tiptext-global"}
              onClick={() => AppFunc.openAllTabs()}
            >
              <GiExpand color="black" />
            </Button>

            <Button
              id="export-btn"
              classes="mx-1 btn-in-global"
              translate={AppFunc.translate("exportJSON")}
              tooltip={"tiptext-json"}
              onClick={AppFunc.exportJSON}
            >
              <BiExport color="black" size="1.4rem" />
            </Button>

            <Button
              id="sync-write-btn"
              classes="p-0 mx-1 btn-in-global"
              translate={"Sync Write"}
              tooltip={"tiptext-global"}
              onClick={() => AppFunc.updateSync(syncTimestamp.current)}
            >
              <BsCloudUpload color="black" size="1.5rem" />
            </Button>
          </div>

          <div className="mt-2">
            <Button
              id="delete-all-btn"
              classes="p-0 mx-1 btn-in-global"
              translate={AppFunc.translate("deleteAll")}
              tooltip={"tiptext-global"}
              onClick={() => AppFunc.deleteAllGroups(setTabTotal, setGroups)}
            >
              <GrClear color="black" />
            </Button>

            <label
              id="import-btn"
              htmlFor="import-input"
              className="mx-1 btn-in-global btn"
            >
              <div className="tip">
                <BiImport color="black" size="1.4rem" />
                <span className="tiptext-json">
                  {AppFunc.translate("importJSON")}
                </span>
              </div>
            </label>
            <input
              id="import-input"
              type="file"
              accept=".json"
              onChange={(e) =>
                AppFunc.readImportedFile(e, setGroups, setTabTotal)
              }
            ></input>

            <Button
              id="sync-read-btn"
              classes="p-0 mx-1 btn-in-global"
              translate={"Sync Read"}
              tooltip={"tiptext-global"}
              onClick={() =>
                // prettier-ignore
                AppFunc.loadSyncedData(syncTimestamp.current, setGroups, setTabTotal)
              }
            >
              <BsCloudDownload color="black" size="1.5rem" />
            </Button>
          </div>

          <Button
            id="add-group-btn"
            classes="p-0 mx-auto d-block btn-in-global"
            translate={AppFunc.translate("addGroup")}
            tooltip={"tiptext-global"}
            onClick={() => AppFunc.addGroup(NUM_GROUP_LIMIT.current, setGroups)}
          >
            <GrAddCircle color="black" size="1.5rem" />
          </Button>
        </div>

        <hr className="my-4 mx-auto" />

        {links.current.slice(0, 5).map((x) => {
          return (
            <Button
              id={x.text.toLowerCase() + "-btn"}
              classes="p-0 mx-1 link-global btn-in-global"
              translate={AppFunc.translate(x.text)}
              tooltip={"tiptext-global"}
              onClick={() => window.open(x.url, "_blank")}
              key={Math.random()}
            >
              {x.icon}
            </Button>
          );
        })}

        <hr className="my-4 mx-auto" />

        <div className="mx-auto">
          {links.current.slice(5).map((x) => {
            return (
              <Button
                id={x.text.toLowerCase() + "-btn"}
                classes="p-0 mx-1 link-global btn-in-global"
                translate={AppFunc.translate(x.text)}
                onClick={() => window.open(x.url, "_blank")}
                key={Math.random()}
              >
                {x.icon}
              </Button>
            );
          })}
        </div>

        <div id="copyright" className="my-4">
          Copyright &copy; {new Date().getFullYear()} Lior Bragilevsky
        </div>
      </nav>

      <div className="container-fluid" id="main">
        <div className="col" id="tabmerger-container">
          <div className="groups-container my-4">
            {
              // prettier-ignore
              AppFunc.groupFormation(groups, ITEM_STORAGE_LIMIT.current, setGroups, setTabTotal)
            }
          </div>
        </div>
      </div>
    </div>
  );
}
