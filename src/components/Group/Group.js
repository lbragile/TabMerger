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

import React, { useEffect, useState, useRef, useCallback, useContext } from "react";

import * as GroupFunc from "./Group_functions";
import { translate } from "../App/App_functions";
import { AppContext } from "../../context/AppContext";

import { BiColorFill } from "react-icons/bi";

import Button from "../Button/Button.js";
import { GROUP_TITLE_BUTTONS, MERGE_BUTTONS } from "../Button/button_details";

import "./Group.css";
import "../Button/Button.css";

export default function Group(props) {
  const TITLE_TRIM_LIMIT = useRef(15);
  const [hide, setHide] = useState(false);

  const { setTabTotal, setGroups } = useContext(AppContext);

  const setGroupBackground = useCallback(
    (e) => {
      GroupFunc.setGroupBackground(e, props.id);
    },
    [props.id]
  );

  useEffect(() => {
    var group = document.getElementById(props.id);
    setGroupBackground(group);
  }, [props.id, setGroupBackground]);

  return (
    <div className={"group-item " + (props.id === "group-0" ? "mt-0" : "mt-2")}>
      <div className="group-title d-flex flex-row justify-content-center">
        <div className="title-count-color-container row">
          <h5 className="group-count">
            <span style={{ left: props.num_tabs > 9 ? "-1px" : "0" }}>{props.num_tabs}</span>
          </h5>
          <div className="group-color tip p-0">
            <BiColorFill className="input-color" onClick={(e) => e.target.closest("div").nextSibling.click()} />
            <span className="tiptext-group-color">{translate("pickColor")}</span>
          </div>
          <input type="color" defaultValue={props.color} onChange={(e) => setGroupBackground(e)} />
        </div>

        <input
          className="title-edit-input font-weight-bold mb-0"
          onFocus={(e) => e.target.select()}
          onBlur={(e) => GroupFunc.setTitle(e, setGroups, props.title)}
          onKeyDown={(e) => GroupFunc.blurOnEnter(e)}
          maxLength={TITLE_TRIM_LIMIT.current}
          defaultValue={props.title}
        />

        <div className="title-btn-containter row">
          {GROUP_TITLE_BUTTONS(hide, setHide, setTabTotal, setGroups).map((x) => {
            return (
              <Button
                classes={x.classes}
                translate={x.translate}
                tooltip={"tiptext-group-title"}
                onClick={x.clickFn}
                key={Math.random()}
              >
                {x.icon}
              </Button>
            );
          })}
        </div>
      </div>

      <div id={props.id} className="group" onDragOver={GroupFunc.dragOver}>
        <div className="created mr-1">
          <b>{translate("created")}:</b> <span>{props.created}</span>
        </div>

        <div className="merging-container float-right">
          <div className="d-flex flex-column">
            {MERGE_BUTTONS(props.id).map((x) => {
              return (
                <Button
                  classes={x.classes}
                  translate={x.translate}
                  tooltip={"tiptext-group-merge"}
                  onClick={x.clickFn}
                  key={Math.random()}
                >
                  {x.icon}
                </Button>
              );
            })}
          </div>
        </div>

        {props.children}
      </div>
    </div>
  );
}
