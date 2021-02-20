import React from "react";

import Button from "./Button";
import * as AppFunc from "../App/App_functions";
import * as GroupFunc from "../Group/Group_functions";

import { AiOutlineMinus, AiOutlineClose } from "react-icons/ai";
import { BiColorFill, BiGridSmall, BiLock, BiLockOpen } from "react-icons/bi";
import { BsStarFill, BsStar } from "react-icons/bs";
import { VscChromeRestore } from "react-icons/vsc";

// prettier-ignore
export default function GroupTitleBtns({ id, color, hidden, locked, starred, tooltip, user, setTabTotal, setGroups, setDialog }) {
  const GROUP_TITLE_BUTTONS = [
    {
      classes: "move-group-btn btn-in-group-title",
      translate: null,
      icon: <BiGridSmall size="1.6rem" />,
    },
    {
      classes: "lock-group-btn btn-in-group-title",
      translate: AppFunc.translate(locked ? "unlock" : "lock") + " " + AppFunc.translate("group"),
      icon: locked ? <BiLock size="1.3rem" /> : <BiLockOpen size="1.3rem" />,
      clickFn: (e) => GroupFunc.toggleGroup(e, "lock", setGroups),
    },
    {
      classes: "star-group-btn btn-in-group-title",
      translate: AppFunc.translate(starred ? "unstar" : "star") + " " + AppFunc.translate("group"),
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
      translate: AppFunc.translate(hidden ? "showTabs" : "hideTabs"),
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
      clickFn: (e) => GroupFunc.deleteGroup(e, user, setTabTotal, setGroups, setDialog),
      icon: <AiOutlineClose />,
    },
  ];

  return (
    <div className="title-btn-containter row">
      {GROUP_TITLE_BUTTONS.map((x) => {
        return (
          <React.Fragment key={Math.random()}>
            <Button classes={x.classes} translate={x.translate} tooltip={tooltip} onClick={x.clickFn}>
              {x.icon}
            </Button>
            {x.id && (
              <React.Fragment>
                <input
                  type="color"
                  defaultValue={color}
                  list="presetColors"
                  onChange={(e) => GroupFunc.setBGColor(e, id)}
                  onBlur={() => GroupFunc.updateTextColor()}
                />
                <PresetColors />
              </React.Fragment>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function PresetColors() {
  return (
    <datalist id="presetColors">
      {/* RED */}
      <option>#ff9999</option>
      <option>#ff6666</option>
      <option>#ff3333</option>
      <option>#ff0000</option>
      <option>#cc0000</option>

      {/* ORANGE */}
      <option>#ffdb99</option>
      <option>#ffa366</option>
      <option>#ff8533</option>
      <option>#ff6600</option>
      <option>#cc5200</option>

      {/* YELLOW */}
      <option>#ffff99</option>
      <option>#ffff66</option>
      <option>#ffff33</option>
      <option>#ffff00</option>
      <option>#cccc00</option>

      {/* GREEN */}
      <option>#99ff99</option>
      <option>#66ff66</option>
      <option>#33ff33</option>
      <option>#00ff00</option>
      <option>#00cc00</option>

      {/* CYAN */}
      <option>#99ffff</option>
      <option>#66ffff</option>
      <option>#33ffff</option>
      <option>#00ffff</option>
      <option>#00cccc</option>

      {/* BLUE */}
      <option>#9999ff</option>
      <option>#6666ff</option>
      <option>#3333ff</option>
      <option>#0000ff</option>
      <option>#0000cc</option>

      {/* PURPLE */}
      <option>#cc99ff</option>
      <option>#b366ff</option>
      <option>#9933ff</option>
      <option>#8000ff</option>
      <option>#6600cc</option>

      {/* PINK */}
      <option>#ff99ff</option>
      <option>#ff66ff</option>
      <option>#ff33ff</option>
      <option>#ff00ff</option>
      <option>#cc00cc</option>

      {/* GREY */}
      <option>#dedede</option>
      <option>#b3b3b3</option>
      <option>#999999</option>
      <option>#808080</option>
      <option>#666666</option>

      {/* BLACK */}
      <option>#666666</option>
      <option>#4d4d4d</option>
      <option>#333333</option>
      <option>#1a1a1a</option>
      <option>#000000</option>
    </datalist>
  );
}
