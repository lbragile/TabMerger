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

import React, { useState, useEffect, useRef, useMemo } from "react";
import Tour from "reactour";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import Tab from "../Tab/Tab";
import Group from "../Group/Group";

import * as AppFunc from "./App_functions";
import * as AppHelper from "./App_helpers";
import * as CONSTANTS from "../../constants/constants";
import { userType } from "../../typings/common";

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

export interface IChanges {
  [key: string]: any;
}

export default function App() {
  // app parameters
  const [tabTotal, setTabTotal] = useState(0);
  const [groups, setGroups] = useState(null);
  const [dialog, setDialog] = useState({ show: false });
  var syncTimestamp = useRef();
  var textStyles = useRef({ fontFamily: "Arial", fontWeight: "Normal" });

  // activation parameters
  const [user, setUser] = useState<userType>({ paid: false, tier: "Free" });

  // tutorial parameters
  const [tour, setTour] = useState<boolean>(false);
  const startStep = useRef<number>(0);

  useEffect(() => {
    function openOrRemoveTabs(changes: IChanges, namespace: string) {
      AppFunc.openOrRemoveTabs(changes, namespace, setTabTotal, setGroups);
    }

    function checkMerging(changes: IChanges, namespace: string) {
      AppFunc.checkMerging(changes, namespace, setTabTotal, setGroups);
    }

    // persist user's tier, this should only be checked when not testing to avoid database calls
    if (process.env.NODE_ENV !== "test") {
      chrome.storage.local.get("client_details", (local) => {
        local.client_details && AppHelper.checkUserStatus(setUser);
      });
    }

    const syncTimestampVal = syncTimestamp.current;
    AppFunc.storageInit(syncTimestampVal, setTour, setGroups, setTabTotal);
    AppFunc.createAutoBackUpAlarm();
    AppFunc.handleUpdate();

    chrome.alarms.onAlarm.addListener((alarm) => AppHelper.performAutoBackUp(alarm, syncTimestampVal));
    chrome.storage.onChanged.addListener(openOrRemoveTabs);
    chrome.storage.onChanged.addListener(checkMerging);

    return () => {
      chrome.alarms.onAlarm.removeListener((alarm) => AppHelper.performAutoBackUp(alarm, syncTimestampVal));
      chrome.storage.onChanged.removeListener(openOrRemoveTabs);
      chrome.storage.onChanged.removeListener(checkMerging);
    };
  }, []);

  useEffect(() => {
    window.addEventListener("beforeprint", () => AppFunc.toggleHiddenOrEmptyGroups("before", user));
    window.addEventListener("afterprint", () => AppFunc.toggleHiddenOrEmptyGroups("after", user));

    return () => {
      window.removeEventListener("beforeprint", () => AppFunc.toggleHiddenOrEmptyGroups("before", user));
      window.removeEventListener("afterprint", () => AppFunc.toggleHiddenOrEmptyGroups("after", user));
    };
  }, [user]);

  useEffect(() => AppFunc.badgeIconInfo(tabTotal, user), [groups, tabTotal, user]);
  useEffect(() => AppFunc.syncLimitIndication(), [groups, dialog, user]);
  useEffect(() => {
    chrome.storage.sync.get("settings", (sync) => {
      textStyles.current.fontWeight = CONSTANTS.FONT_WEIGHT[sync.settings?.weight ?? "Normal"];
      textStyles.current.fontFamily = CONSTANTS.FONT_FAMILY[sync.settings?.font ?? "Arial"];
    });
  }, [groups]);

  // only re-render groups when they change
  const memoizedGroupFormation = useMemo(
    () =>
      groups &&
      AppHelper.sortByKey(JSON.parse(groups)).map(
        (x, i): JSX.Element => {
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
              fontFamily={textStyles.current.fontFamily}
              key={Math.random()}
            >
              <Tab
                id={id}
                hidden={x.hidden}
                textColor={textColor}
                fontWeight={textStyles.current.fontWeight}
                fontFamily={textStyles.current.fontFamily}
              />
            </Group>
          );
        }
      ),
    [groups]
  );

  return (
    <div id="app-wrapper" className="text-center">
      {/* @ts-ignore */}
      <Dialog {...dialog} setDialog={setDialog} />

      <Tour
        /* @ts-ignore */
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

      <nav
        id="sidebar"
        style={{ fontFamily: ["Standard", "Premium"].includes(user.tier) ? textStyles.current.fontFamily : "Arial" }}
      >
        <Header total={tabTotal} />
        <hr className="mx-auto d-none shown-in-print" />
        <Reviews /> {/* Only visible in print mode for Free and Basic Tier users */}
        <div id="global-action-container">
          <TabSearch user={user} />
          <hr className="mx-auto hidden-in-print" />

          <GlobalBtns
            user={user}
            syncTimestamp={syncTimestamp}
            setTabTotal={setTabTotal}
            setGroups={setGroups}
            /* @ts-ignore */
            setDialog={setDialog}
          />

          {/* @ts-ignore */}
          <Links setTour={setTour} setDialog={setDialog} />
        </div>
        {/* Verify/activate account button*/}
        <div id="footer">
          {!user.paid && (
            <Button
              classes="p-0 btn-in-global mx-auto mb-2 d-block"
              id="subscription-btn"
              translate="Activate Plan"
              /* @ts-ignore */
              onClick={() => AppFunc.setUserStatus(setUser, setDialog)}
            >
              {<BiCheckCircle color="black" size="1.5rem" />}
            </Button>
          )}
          <a href={CONSTANTS.SUBSCRIPTION_URL} target="_blank" rel="noreferrer">
            Subscription: <b>{user.tier} Tier</b>
          </a>
          <p>
            TabMerger: <b>v{chrome.runtime.getManifest().version}</b>
          </p>
          <p className="mt-4" id="copyright">
            Copyright &copy; {new Date().getFullYear()} Lior Bragilevsky
          </p>
        </div>
      </nav>

      {/* @ts-ignore */}
      <AppProvider value={{ user, setGroups, setTabTotal, setDialog }}>
        <div className="container-fluid col" id="tabmerger-container" onDragOver={(e) => AppFunc.dragOver(e, "group")}>
          {memoizedGroupFormation}
        </div>
      </AppProvider>

      <ToastContainer
        position="top-center"
        hideProgressBar={false}
        autoClose={5000}
        pauseOnHover={true}
        newestOnTop={true}
        closeOnClick={false}
        draggable={false}
        pauseOnFocusLoss={false}
        rtl={false}
        style={{ width: "550px" }}
      />
    </div>
  );
}
