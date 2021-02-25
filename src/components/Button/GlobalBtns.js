import React, { useEffect, useState } from "react";
import ReactTooltip from "react-tooltip";

import Button from "./Button";
import * as AppFunc from "../App/App_functions";
import * as CONSTANTS from "../../constants/constants";
import ImportBtn from "./ImportBtn.js";

import { BiExport, BiPrinter } from "react-icons/bi";
import { BsCloudUpload, BsCloudDownload } from "react-icons/bs";
import { FiSettings } from "react-icons/fi";
import { FaUndo } from "react-icons/fa";
import { GiExpand } from "react-icons/gi";
import { GrClear, GrAddCircle } from "react-icons/gr";

export default function GlobalBtns({ user, syncTimestamp, setTabTotal, setGroups, setDialog }) {
  const [tooltipVisibility, setTooltipVisibility] = useState(true);

  useEffect(() => ReactTooltip.rebuild());

  useEffect(() => {
    chrome.storage.sync.get("settings", (sync) => {
      setTooltipVisibility(sync.settings?.tooltipVisibility ?? CONSTANTS.DEFAULT_SETTINGS.tooltipVisibility);
    });
  }, []);

  const GLOBAL_BUTTONS = [
    {
      id: "options-btn",
      classes: "options-btn-class",
      translate: AppFunc.translate("settings"),
      btnFn: () => window.location.assign("/settings/settings.html"),
      icon: <FiSettings color="black" size="1.6rem" />,
    },
    {
      id: "open-all-btn",
      classes: "mx-2",
      translate: AppFunc.translate("openAll"),
      btnFn: (e) => AppFunc.openAllTabs(e, setDialog),
      icon: <GiExpand color="black" />,
    },
    {
      id: "export-btn",
      classes: "",
      translate: AppFunc.translate("exportJSON"),
      btnFn: () => AppFunc.exportJSON(true, undefined, " "),
      icon: <BiExport color="black" size="1.4rem" />,
    },
    {
      id: "sync-write-btn",
      classes: "mx-2",
      translate: AppFunc.translate("sync").substr(0, 4) + " " + AppFunc.translate("write"),
      btnFn: (e) => AppFunc.syncWrite(e, syncTimestamp.current, user),
      icon: <BsCloudUpload color="black" size="1.5rem" />,
    },
    {
      id: "undo-btn",
      classes: "",
      translate: AppFunc.translate("undo") + " " + AppFunc.translate("action"),
      btnFn: () => AppFunc.undoDestructiveAction(setGroups, setTabTotal),
      icon: <FaUndo color="black" size="1.2rem" />,
    },
    {
      id: "print-btn",
      classes: "mr-2 print-btn-class",
      translate: AppFunc.translate("print"),
      btnFn: () => {
        ReactTooltip.hide();
        setTimeout(() => window.print(), 50);
      },
      icon: <BiPrinter color="black" size="1.5rem" />,
    },
    {
      id: "delete-all-btn",
      classes: "",
      translate: AppFunc.translate("deleteAll"),
      btnFn: (e) => AppFunc.deleteAllGroups(e, user, setTabTotal, setGroups, setDialog),
      icon: <GrClear color="black" />,
    },
    {
      id: "temp",
    },
    {
      id: "sync-read-btn",
      classes: "mr-2",
      translate: AppFunc.translate("sync").substr(0, 4) + " " + AppFunc.translate("read"),
      btnFn: () => AppFunc.syncRead(syncTimestamp.current, user, setGroups, setTabTotal),
      icon: <BsCloudDownload color="black" size="1.5rem" />,
    },
    {
      id: "add-group-btn",
      classes: "",
      translate: AppFunc.translate("addGroup"),
      btnFn: () => AppFunc.addGroup(setGroups),
      icon: <GrAddCircle color="black" size="1.5rem" />,
    },
  ];

  return (
    <div className="global-btn-row col">
      <p
        className="mx-auto d-block mb-3 alert alert-danger"
        id="sync-text"
        title="red/green with red border - sync isn't available, green without red border - sync available"
      >
        <b>{AppFunc.translate("sync").substr(0, 4)}:</b> <span ref={syncTimestamp}>--/--/---- @ --:--:--</span>
      </p>

      {GLOBAL_BUTTONS.map((x, i) => {
        return i !== 7 ? (
          <React.Fragment key={Math.random()}>
            <Button
              id={x.id}
              classes={"p-0 mt-2 btn-in-global d-inline-block " + x.classes}
              translate={x.translate}
              onClick={x.btnFn}
              key={Math.random()}
              disabled={(!user.paid && [2, 3, 8].includes(i)) || (user.tier === "Basic" && i === 2)}
              place={i > 4 ? "bottom" : "top"}
            >
              {x.icon}
            </Button>
            {i === 4 && <div />}
          </React.Fragment>
        ) : (
          <ImportBtn user={user} setTabTotal={setTabTotal} setGroups={setGroups} key={Math.random()} />
        );
      })}

      {tooltipVisibility && process.env.NODE_ENV !== "test" && (
        <React.Fragment>
          <ReactTooltip
            id="btn-tooltip"
            multiline={true}
            className="font-weight-bold text-center rounded border border-white tooltip-popup"
            effect="solid"
            arrowColor="white"
            backgroundColor="black"
            textColor="white"
          />

          <ReactTooltip
            id="smaller-btn-tooltip"
            multiline={true}
            className="font-weight-bold text-center rounded border border-white smaller-tooltip-popup"
            effect="solid"
            arrowColor="white"
            backgroundColor="black"
            textColor="white"
          />

          <ReactTooltip
            id="merge-btn-tooltip"
            multiline={true}
            className="font-weight-bold text-center rounded border border-white tooltip-popup"
            effect="solid"
            arrowColor="black"
            backgroundColor="black"
            textColor="white"
            place="left"
          />

          <ReactTooltip
            id="group-title-btn-tooltip"
            multiline={true}
            className="font-weight-bold text-center rounded border border-white tooltip-popup"
            effect="solid"
            arrowColor="black"
            backgroundColor="black"
            textColor="white"
            place="top"
          />

          <ReactTooltip
            id="search-tooltip"
            multiline={true}
            className="font-weight-bold text-left rounded border border-white search-tooltip-popup"
            effect="solid"
            arrowColor="white"
            backgroundColor="black"
            textColor="white"
            place="top"
            offset={{ top: -13 }}
          />
        </React.Fragment>
      )}
    </div>
  );
}
