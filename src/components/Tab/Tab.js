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

import React, { useState, useEffect, useContext } from "react";

import * as TabFunc from "./Tab_functions";
import * as TabHelper from "./Tab_helpers";
import { AppContext } from "../../context/AppContext";

import { BiGridSmall } from "react-icons/bi";
import { RiPushpinLine, RiPushpinFill } from "react-icons/ri";
import { TiDelete } from "react-icons/ti";

import "./Tab.css";

export default function Tab({ id, hidden, textColor, fontWeight, fontFamily }) {
  const [tabs, setTabs] = useState([]);
  const { user, setTabTotal, setGroups } = useContext(AppContext);

  useEffect(() => TabFunc.setInitTabs(setTabs, id), [id]);

  return (
    <div className="d-flex flex-column mx-0 tabs-container">
      {tabs.map((tab) => {
        return (
          <div
            className={"row draggable p-0 mx-0 " + (hidden ? "d-none" : "")}
            draggable={true}
            onDragStart={(e) => TabFunc.tabDragStart(e)}
            onDragEnd={(e) => TabFunc.tabDragEnd(e, setGroups)}
            key={Math.random()}
          >
            <p
              className="close-tab"
              title="lets you remove this tab!"
              draggable={false}
              onClick={(e) => TabFunc.removeTab(e, tabs, user, setTabs, setTabTotal, setGroups)}
            >
              <TiDelete size="1rem" color={textColor === "light" ? "white" : "black"} />
            </p>
            <p className="move-tab" title="allows you to drag and drop a tab">
              <BiGridSmall size="1.5rem" color={textColor === "light" ? "white" : "black"} />
            </p>
            <img className="img-tab" src={TabHelper.getFavIconURL(tab.url)} alt="" draggable={false} />
            <a
              href={tab.url}
              title={tab.url}
              className={"a-tab mx-1 text-" + textColor}
              target="_blank"
              rel="noreferrer"
              draggable={false}
              contentEditable={true}
              suppressContentEditableWarning={true}
              spellCheck={false}
              onMouseUp={(e) => TabFunc.handleTabClick(e)}
              onKeyPress={(e) => TabFunc.handleTabTitleChange(e)}
              onBlur={(e) => TabFunc.handleTabTitleChange(e)}
              onDrop={(e) => e.preventDefault()}
              style={{
                fontWeight: ["Standard", "Premium"].includes(user.tier) ? fontWeight : "Normal",
                fontFamily: ["Standard", "Premium"].includes(user.tier) ? fontFamily : "Arial",
              }}
            >
              {tab.title}
            </a>
            <span
              className={"pin-tab " + (tab.pinned ? "pinned" : "")}
              onClick={(e) => TabFunc.handlePinClick(e, setGroups)}
              title="enables you to pin/unpin from here!"
            >
              {tab.pinned ? (
                <RiPushpinFill className="m-0" color={textColor === "primary" ? "black" : "white"} />
              ) : (
                <RiPushpinLine className="m-0" color={textColor === "primary" ? "black" : "white"} />
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
