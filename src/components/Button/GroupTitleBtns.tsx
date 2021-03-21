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

import React from "react";
import ReactTooltip from "react-tooltip";

import { AiOutlineMinus, AiOutlineClose } from "react-icons/ai";
import { BiColorFill, BiGridSmall, BiLock, BiLockOpen } from "react-icons/bi";
import { BsStarFill, BsStar } from "react-icons/bs";
import { VscChromeRestore } from "react-icons/vsc";

import * as AppFunc from "@App/App_functions";
import * as GroupFunc from "@Group/Group_functions";
import * as CONSTANTS from "@Constants/constants";
import Button from "@Button/Button";
import { userType, setStateType } from "@Typings/common";

export interface GroupTitleBtnsProps {
  id: string;
  color: string;
  hidden: boolean;
  locked: boolean;
  starred: boolean;
  user: userType;
  textColor: string;
  setTabTotal: setStateType<number>;
  setGroups: setStateType<string>;
}

export interface GroupTitleButtonsProps {
  id?: string;
  classes: string;
  translate?: string;
  icon: JSX.Element;
  clickFn?: (e: MouseEvent) => void;
}

export default function GroupTitleBtns({
  id,
  color,
  hidden,
  locked,
  starred,
  user,
  textColor,
  setTabTotal,
  setGroups,
}: GroupTitleBtnsProps): JSX.Element {
  const GROUP_TITLE_BUTTONS: GroupTitleButtonsProps[] = [
    {
      classes: "move-group-btn btn-in-group-title",
      translate: null,
      icon: <BiGridSmall size="1.6rem" color={textColor === "primary" ? "black" : "white"} />,
    },
    {
      classes: "lock-group-btn btn-in-group-title",
      translate: AppFunc.translate(locked ? "unlock" : "lock") + " " + AppFunc.translate("group"),
      icon: locked ? (
        <BiLock size="1.3rem" color={textColor === "primary" ? "black" : "white"} />
      ) : (
        <BiLockOpen size="1.3rem" color={textColor === "primary" ? "black" : "white"} />
      ),
      clickFn: (e) => GroupFunc.toggleGroup(e, "lock", setGroups),
    },
    {
      classes: "star-group-btn btn-in-group-title",
      translate: AppFunc.translate(starred ? "unstar" : "star") + " " + AppFunc.translate("group"),
      icon: starred ? (
        <BsStarFill size="1.1rem" color={textColor === "primary" ? "black" : "white"} />
      ) : (
        <BsStar size="1.1rem" color={textColor === "primary" ? "black" : "white"} />
      ),
      clickFn: (e) => GroupFunc.toggleGroup(e, "star", setGroups),
    },
    {
      id: "temp",
      classes: "color-group-btn btn-in-group-title",
      translate: AppFunc.translate("pickColor"),
      icon: <BiColorFill className="input-color" color={textColor === "primary" ? "black" : "white"} />,
      clickFn: (e) => ((e.target as HTMLElement).closest("button").nextSibling as HTMLElement).click(), // prettier-ignore
    },
    {
      classes: "visibility-group-btn btn-in-group-title",
      translate: AppFunc.translate(hidden ? "showTabs" : "hideTabs"),
      clickFn: (e) => GroupFunc.toggleGroup(e, "visibility", setGroups),
      icon: <AiOutlineMinus color={textColor === "primary" ? "black" : "white"} />,
    },
    {
      classes: "open-group-btn btn-in-group-title",
      translate: AppFunc.translate("openGroup"),
      clickFn: (e) => GroupFunc.openGroup(e),
      icon: <VscChromeRestore color={textColor === "primary" ? "black" : "white"} />,
    },
    {
      classes: "delete-group-btn btn-in-group-title",
      translate: AppFunc.translate("deleteGroup"),
      clickFn: (e) => {
        ReactTooltip.hide();
        GroupFunc.deleteGroup(e, user, setTabTotal, setGroups);
      },
      icon: <AiOutlineClose color={textColor === "primary" ? "black" : "white"} />,
    },
  ];

  return (
    <div className="title-btn-containter row">
      {GROUP_TITLE_BUTTONS.map((x) => {
        return (
          <React.Fragment key={Math.random()}>
            {/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
            {/* @ts-ignore */}
            <Button classes={x.classes} translate={x.translate} onClick={x.clickFn}>
              {x.icon}
            </Button>
            {x.id && (
              <React.Fragment>
                <input
                  type="color"
                  defaultValue={color}
                  list="presetColors"
                  onChange={(e) => GroupFunc.setBGColor(e, id)}
                  onBlur={() => GroupFunc.updateTextColor(setGroups)}
                />
                <datalist id="presetColors">
                  {CONSTANTS.RANDOM_COLOR_LIST.map(
                    (color, i) => i < 50 && <option key={Math.random()}>{color}</option>
                  )}
                </datalist>
              </React.Fragment>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
