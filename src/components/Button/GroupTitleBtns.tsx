import React from "react";
import ReactTooltip from "react-tooltip";

import Button from "./Button";
import * as AppFunc from "../App/App_functions";
import * as GroupFunc from "../Group/Group_functions";
import * as CONSTANTS from "../../constants/constants";

import { AiOutlineMinus, AiOutlineClose } from "react-icons/ai";
import { BiColorFill, BiGridSmall, BiLock, BiLockOpen } from "react-icons/bi";
import { BsStarFill, BsStar } from "react-icons/bs";
import { VscChromeRestore } from "react-icons/vsc";

export interface GroupTitleBtnsProps {
  id: string;
  color: string;
  hidden: boolean;
  locked: boolean;
  starred: boolean;
  user: { paid: string | boolean; tier: string };
  textColor: string;
  setTabTotal: React.Dispatch<React.SetStateAction<number>>;
  setGroups: React.Dispatch<React.SetStateAction<string>>;
}

export interface GroupTitleButtonsProps {
  id?: string;
  classes: string;
  translate?: string;
  icon: JSX.Element;
  clickFn?: (e: HTMLElement | HTMLDivElement | HTMLParagraphElement) => void;
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
  const GROUP_TITLE_BUTTONS: Array<GroupTitleButtonsProps> = [
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
      /* @ts-ignore */
      clickFn: (e) => e.target.closest("button").nextSibling.click(),
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
        /* @ts-ignore */
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
