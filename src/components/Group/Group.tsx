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

import React, { useEffect, useContext } from "react";
import { BiHide } from "react-icons/bi";

import { translate, dragOver } from "@App/App_functions";
import { AppContext } from "@Context/AppContext";
import * as CONSTANTS from "@Constants/constants";
import * as GroupFunc from "@Group/Group_functions";
import MergeBtns from "@Button/MergeBtns";
import GroupTitleBtns from "@Button/GroupTitleBtns";

import "@Group/Group.css";
import "@Button/Button.css";

export interface GroupProps {
  id: string;
  title: string;
  textColor: string;
  color: string;
  created: string;
  num_tabs: number;
  hidden: boolean;
  locked: boolean;
  starred: boolean;
  fontFamily: string;
  children: JSX.Element;
}

export default function Group({
  id,
  title,
  textColor,
  color,
  created,
  num_tabs,
  hidden,
  locked,
  starred,
  fontFamily,
  children,
}: GroupProps): JSX.Element {
  const { user, setTabTotal, setGroups } = useContext(AppContext);

  useEffect(() => GroupFunc.setBGColor(document.getElementById(id) as HTMLInputElement, id), [id]);

  return (
    <div
      className={"group-item mt-2" + (hidden ? " hidden" : "") + (num_tabs > 0 ? "" : " empty")}
      draggable={true}
      onDragStart={(e) => GroupFunc.groupDragStart(e)}
      onDragEnd={(e) => GroupFunc.groupDragEnd(e)}
    >
      <div
        className="group-title d-flex flex-row justify-content-center"
        draggable={false}
        style={
          /* stylelint-disable-next-line font-family-no-missing-generic-family-keyword */ {
            fontFamily: ["Standard", "Premium"].includes(user.tier) ? fontFamily : "Arial",
          }
        }
      >
        <h5 className="group-count">{num_tabs}</h5>

        <input
          className="title-edit-input font-weight-bold mb-0"
          title="can be modified to give the group a meaningful name"
          maxLength={CONSTANTS.TITLE_TRIM_LIMIT}
          defaultValue={title}
          onFocus={(e) => e.target.select()}
          onBlur={(e: React.FocusEvent<HTMLElement>) => GroupFunc.setTitle(e)}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => GroupFunc.blurOnEnter(e)}
          onDragStart={(e) => e.preventDefault()}
          onDrop={(e) => e.preventDefault()}
        />

        <GroupTitleBtns
          id={id}
          color={color}
          hidden={hidden}
          locked={locked}
          starred={starred}
          user={user}
          textColor={textColor}
          setTabTotal={setTabTotal}
          setGroups={setGroups}
        />
      </div>

      <div id={id} className="group draggable-group" draggable={false} onDragOver={(e) => dragOver(e, "tab")}>
        <div
          className="created mr-1"
          draggable={false}
          style={
            /* stylelint-disable-next-line font-family-no-missing-generic-family-keyword */ {
              fontFamily: ["Standard", "Premium"].includes(user.tier) ? fontFamily : "Arial",
            }
          }
        >
          <b>{translate("created")}:</b> <span>{created}</span>
        </div>

        <div className="sync-group-exceed-indicator d-none" title="indicates that the group's sync limit is exceeded">
          ●
        </div>

        <input
          className="url-drag-input"
          type="text"
          name="url-drag"
          onChange={(e) => GroupFunc.addTabFromURL(e, user, setGroups, setTabTotal)}
          onKeyDown={(e) => e.preventDefault()}
          onClick={(e) => (e.target as HTMLInputElement).blur()}
        />

        <MergeBtns id={id} />

        {hidden && <BiHide className="hidden-symbol" color="black" size="1.6rem" />}
        {children}
      </div>
    </div>
  );
}
