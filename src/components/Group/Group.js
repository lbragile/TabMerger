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

import React, { useEffect, useRef, useCallback, useContext } from "react";

import * as GroupFunc from "./Group_functions";
import { translate } from "../App/App_functions";
import { AppContext } from "../../context/AppContext";

import MergeBtns from "../Button/MergeBtns";
import GroupTitleBtns from "../Button/GroupTitleBtns";

import { BiColorFill, BiHide, BiGridSmall, BiLock, BiLockOpen } from "react-icons/bi";
import { BsStarFill, BsStar } from "react-icons/bs";

import "./Group.css";
import "../Button/Button.css";

export default function Group({ id, title, color, created, num_tabs, hidden, children }) {
  const TITLE_TRIM_LIMIT = useRef(50);

  const { setTabTotal, setGroups } = useContext(AppContext);

  const setGroupBackground = useCallback(
    (e) => {
      GroupFunc.setGroupBackground(e, id);
    },
    [id]
  );

  useEffect(() => {
    var group = document.getElementById(id);
    setGroupBackground(group);
  }, [id, setGroupBackground]);

  return (
    <div className={"group-item " + (id === "group-0" ? "mt-0" : "mt-2")}>
      <div className="group-title d-flex flex-row justify-content-center" draggable={false}>
        <div className="title-count-color-container row">
          <h5 className="group-count">{num_tabs}</h5>
          <div className="group-color tip p-0">
            <BiColorFill className="input-color" onClick={(e) => e.target.closest("div").nextSibling.click()} />
            <span className="tiptext-group-color">{translate("pickColor")}</span>
          </div>
          <input type="color" defaultValue={color} onChange={(e) => setGroupBackground(e)} />
        </div>

        <input
          className="title-edit-input font-weight-bold mb-0"
          onFocus={(e) => e.target.select()}
          onBlur={(e) => GroupFunc.setTitle(e, setGroups, title)}
          onKeyDown={(e) => GroupFunc.blurOnEnter(e)}
          maxLength={TITLE_TRIM_LIMIT.current}
          defaultValue={title}
          onDragStart={(e) => e.preventDefault()}
        />

        <GroupTitleBtns hidden={hidden} setTabTotal={setTabTotal} setGroups={setGroups} />
      </div>

      <div id={id} className="group draggable-group" draggable={false} onDragOver={(e) => GroupFunc.tabDragOver(e)}>
        <div className="move-lock-star-container">
          <div
            className="move-group"
            draggable={true}
            onDragStart={(e) => GroupFunc.groupDragStart(e)}
            onDragEnd={(e) => GroupFunc.groupDragEnd(e)}
          >
            <BiGridSmall color="black" size="1.6rem" />
          </div>

          <div className="lock-group">
            <BiLockOpen color="black" size="1.3rem" />
          </div>

          <div className="star-group">
            <BsStar color="black" size="1.1rem" />
          </div>
        </div>

        <div className="created mr-1">
          <b>{translate("created")}:</b> <span>{created}</span>
        </div>

        <MergeBtns id={id} />

        {hidden && <BiHide className="hidden-symbol" color="black" size="1.6rem" />}
        {children}
      </div>
    </div>
  );
}
