import React from "react";

import Button from "./Button";
import * as AppFunc from "../App/App_functions";
import * as GroupFunc from "../Group/Group_functions";

import { AiOutlineMinus, AiOutlineClose } from "react-icons/ai";
import { BiColorFill, BiGridSmall, BiLock, BiLockOpen } from "react-icons/bi";
import { BsStarFill, BsStar } from "react-icons/bs";
import { VscChromeRestore } from "react-icons/vsc";

export default function GroupTitleBtns({ color, hidden, locked, starred, setTabTotal, setGroups }) {
  const GROUP_TITLE_BUTTONS = (hidden, locked, starred, setTabTotal, setGroups) => {
    return [
      {
        classes: "move-group-btn btn-in-group-title",
        translate: null,
        icon: <BiGridSmall size="1.6rem" />,
      },
      {
        classes: "lock-group-btn btn-in-group-title",
        translate: locked ? "Unlock Group" : "Lock Group",
        icon: locked ? <BiLock size="1.3rem" /> : <BiLockOpen size="1.3rem" />,
        clickFn: (e) => GroupFunc.toggleGroup(e, "lock", setGroups),
      },
      {
        classes: "star-group-btn btn-in-group-title",
        translate: starred ? "Unstar Group" : "Star Group",
        icon: starred ? <BsStarFill size="1.1rem" /> : <BsStar size="1.1rem" />,
        clickFn: (e) => GroupFunc.toggleGroup(e, "star", setGroups),
      },
      {
        id: "temp",
        classes: "color-group-btn btn-in-group-title",
        translate: AppFunc.translate("pickColor"),
        icon: <BiColorFill className="input-color" />,
        clickFn: (e) => e.target.closest("button").nextSibling.click(),
      },
      {
        classes: "visibility-group-btn btn-in-group-title",
        translate: hidden ? AppFunc.translate("showTabs") : AppFunc.translate("hideTabs"),
        clickFn: (e) => GroupFunc.toggleGroup(e, "visibility", setGroups),
        icon: <AiOutlineMinus />,
      },
      {
        classes: "open-group-btn btn-in-group-title",
        translate: AppFunc.translate("openGroup"),
        clickFn: (e) => GroupFunc.openGroup(e),
        icon: <VscChromeRestore />,
      },
      {
        classes: "delete-group-btn btn-in-group-title",
        translate: AppFunc.translate("deleteGroup"),
        clickFn: (e) => GroupFunc.deleteGroup(e, setTabTotal, setGroups),
        icon: <AiOutlineClose />,
      },
    ];
  };

  return (
    <div className="title-btn-containter row">
      {GROUP_TITLE_BUTTONS(hidden, locked, starred, setTabTotal, setGroups).map((x) => {
        return (
          <React.Fragment key={Math.random()}>
            <Button classes={x.classes} translate={x.translate} tooltip={"tiptext-group-title"} onClick={x.clickFn}>
              {x.icon}
            </Button>
            {x.id && (
              <input
                type="color"
                defaultValue={color}
                onChange={(e) => GroupFunc.setBGColor(e)}
                onBlur={() => GroupFunc.updateTextColor()}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
