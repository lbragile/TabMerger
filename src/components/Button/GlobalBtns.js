import React from "react";

import Button from "./Button";
import * as AppFunc from "../App/App_functions";
import ImportBtn from "./ImportBtn.js";

import { BiExport, BiPrinter } from "react-icons/bi";
import { BsCloudUpload, BsCloudDownload } from "react-icons/bs";
import { FiSettings } from "react-icons/fi";
import { FaUndo } from "react-icons/fa";
import { GiExpand } from "react-icons/gi";
import { GrClear, GrAddCircle } from "react-icons/gr";

export default function GlobalBtns({ syncTimestamp, group_limit, setTabTotal, setGroups, setDialog }) {
  const GLOBAL_BUTTONS = [
    {
      id: "options-btn",
      classes: "",
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
      btnFn: () => AppFunc.exportJSON(),
      icon: <BiExport color="black" size="1.4rem" />,
    },
    {
      id: "sync-write-btn",
      classes: "mx-2",
      translate: AppFunc.translate("sync").substr(0, 4) + " " + AppFunc.translate("write"),
      btnFn: () => AppFunc.syncWrite(syncTimestamp.current),
      icon: <BsCloudUpload color="black" size="1.5rem" />,
    },
    {
      id: "undo-btn",
      classes: "",
      translate: AppFunc.translate("undo") + " " + AppFunc.translate("action"),
      btnFn: () => AppFunc.undoDestructiveAction(setGroups, setTabTotal, setDialog),
      icon: <FaUndo color="black" size="1.2rem" />,
    },
    {
      id: "print-btn",
      classes: "mr-2",
      translate: AppFunc.translate("print"),
      btnFn: () => window.print(),
      icon: <BiPrinter color="black" size="1.5rem" />,
    },
    {
      id: "delete-all-btn",
      classes: "",
      translate: AppFunc.translate("deleteAll"),
      btnFn: (e) => AppFunc.deleteAllGroups(e, setTabTotal, setGroups, setDialog),
      icon: <GrClear color="black" />,
    },
    {
      id: "temp",
    },
    {
      id: "sync-read-btn",
      classes: "mr-2",
      translate: AppFunc.translate("sync").substr(0, 4) + " " + AppFunc.translate("read"),
      btnFn: () => AppFunc.syncRead(syncTimestamp.current, setGroups, setTabTotal),
      icon: <BsCloudDownload color="black" size="1.5rem" />,
    },
    {
      id: "add-group-btn",
      classes: "",
      translate: AppFunc.translate("addGroup"),
      btnFn: () => AppFunc.addGroup(group_limit, setGroups, setDialog),
      icon: <GrAddCircle color="black" size="1.5rem" />,
    },
  ];

  return (
    <div className="global-btn-row col">
      <p className="mx-auto d-block mb-3 alert alert-danger" id="sync-text">
        <b>{AppFunc.translate("sync").substr(0, 4)}:</b> <span ref={syncTimestamp}>--/--/---- @ --:--:--</span>
      </p>

      {GLOBAL_BUTTONS.map((x, i) => {
        return i !== 7 ? (
          <span key={Math.random()}>
            <Button
              id={x.id}
              classes={"p-0 mt-2 btn-in-global d-inline-block " + x.classes}
              translate={x.translate}
              tooltip={"tiptext-global" + (i > 4 ? "-bottom" : "")}
              onClick={x.btnFn}
              key={Math.random()}
            >
              {x.icon}
            </Button>
            {i === 4 && <div />}
          </span>
        ) : (
          <ImportBtn setTabTotal={setTabTotal} setGroups={setGroups} setDialog={setDialog} key={Math.random()} />
        );
      })}
    </div>
  );
}
