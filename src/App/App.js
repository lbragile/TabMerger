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

import { MdSettings, MdDeleteForever, MdAddCircle } from "react-icons/md";
import { FaTrashRestore } from "react-icons/fa";
import { BiImport, BiExport } from "react-icons/bi";
import { BsCloudUpload, BsCloudDownload } from "react-icons/bs";
import { AiOutlineSearch } from "react-icons/ai";

export default function App() {
  const ITEM_STORAGE_LIMIT = useRef(8000); //500 for testing - 8000 for production
  const SYNC_STORAGE_LIMIT = useRef(102000); //1000 for testing - 102000 for production
  const NUM_GROUP_LIMIT = useRef(100); // 3 for testing - 100 for production

  const links = useRef([
    { url: "https://tabmerger.herokuapp.com/", text: "HELP" },
    { url: "https://youtu.be/zkI0T-GzmzQ", text: "DEMO" },
    { url: process.env.REACT_APP_PAYPAL_URL, text: "DONATE" },
    { url: AppFunc.getTabMergerLink(true), text: "REVIEW" },
    { url: "https://tabmerger.herokuapp.com/contact", text: "CONTACT" },
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
    <div className="container-fluid">
      <div className="row link-container mt-4 mr-2">
        {links.current.map((x, i) => {
          return (
            <>
              <a className="link" href={x.url} target="_blank" rel="noreferrer">
                {x.text}
              </a>
              <span style={{ padding: "0 5px" }}>
                {i === links.current.length - 1 ? "" : " | "}
              </span>
            </>
          );
        })}
      </div>

      <div className="col" id="tabmerger-container">
        <div>
          <a href={AppFunc.getTabMergerLink(false)}>
            <img
              id="logo-img"
              className="my-4"
              src="./images/logo-full-rescale.PNG"
              alt="TabMerger Logo"
            />
          </a>
          <div className="subtitle">
            <h2 id="tab-total" className="mb-0">
              <span className="small">
                {tabTotal + (tabTotal === 1 ? " Tab" : " Tabs")}
              </span>
            </h2>

            <div className="input-group search-filter">
              <div className="input-group-prepend">
                <span className="input-group-text">
                  <AiOutlineSearch />
                </span>
              </div>
              <input
                type="text"
                name="search-group"
                placeholder="#_ &rarr; group, _ &rarr; tab"
                onChange={(e) => AppFunc.filterRegEx(e)}
              />
            </div>
          </div>
          <hr />
        </div>
        <div className="container-below-hr mt-3">
          <div className="global-btn-row row">
            <Button
              id="open-all-btn"
              classes="p-0 ml-3 btn-in-global"
              translate={AppFunc.translate("openAll")}
              tooltip={"tiptext-global"}
              onClick={() => AppFunc.openAllTabs()}
            >
              <FaTrashRestore color="green" />
            </Button>

            <Button
              id="delete-all-btn"
              classes="ml-1 mr-4 p-0 btn-in-global"
              translate={AppFunc.translate("deleteAll")}
              tooltip={"tiptext-global"}
              onClick={() => AppFunc.deleteAllGroups(setTabTotal, setGroups)}
            >
              <MdDeleteForever color="red" />
            </Button>

            <Button
              id="export-btn"
              classes="ml-4 btn-in-global"
              translate={AppFunc.translate("exportJSON")}
              tooltip={"tiptext-json"}
              onClick={AppFunc.exportJSON}
            >
              <BiExport color="darkcyan" size="1.4rem" />
            </Button>

            <div>
              <label
                id="import-btn"
                for="import-input"
                className="ml-1 mr-4 my-0 btn-in-global btn"
              >
                <div className="tip">
                  <BiImport color="darkcyan" size="1.4rem" />
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
            </div>

            <Button
              id="sync-write-btn"
              classes="ml-4 p-0 btn-in-global"
              translate={"Sync Write"}
              tooltip={"tiptext-global"}
              onClick={() =>
                AppFunc.updateSync(defaultGroup.current, syncTimestamp.current)
              }
            >
              <BsCloudUpload color="black" size="1.5rem" />
            </Button>

            <Button
              id="sync-read-btn"
              classes="ml-1 p-0 btn-in-global"
              translate={"Sync Read"}
              tooltip={"tiptext-global"}
              onClick={() =>
                // prettier-ignore
                AppFunc.loadSyncedData(syncTimestamp.current, setGroups, setTabTotal)
              }
            >
              <BsCloudDownload color="black" size="1.5rem" />
            </Button>

            <p className="alert alert-danger" id="sync-text">
              <b>Last Sync:</b>{" "}
              <span ref={syncTimestamp}>--/--/---- @ --:--:--</span>
            </p>

            <Button
              id="options-btn"
              classes="p-0 btn-in-global"
              translate={AppFunc.translate("settings")}
              tooltip={"tiptext-global"}
              onClick={() => window.location.replace("/settings/settings.html")}
            >
              <MdSettings color="grey" size="1.6rem" />
            </Button>
          </div>
          <div className="groups-container">
            {
              // prettier-ignore
              AppFunc.groupFormation(groups, ITEM_STORAGE_LIMIT.current, setGroups, setTabTotal)
            }

            <Button
              id="add-group-btn"
              classes="d-block btn-in-global mt-1 mb-4 ml-3 p-2"
              translate={AppFunc.translate("addGroup")}
              tooltip={"tiptext-global"}
              onClick={() =>
                AppFunc.addGroup(NUM_GROUP_LIMIT.current, setGroups)
              }
            >
              <MdAddCircle
                color="#dedede"
                size="2rem"
                stroke="grey"
                strokeWidth="1px"
              />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
