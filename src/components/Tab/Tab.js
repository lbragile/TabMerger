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

import { TiDelete } from "react-icons/ti";
import { AiOutlineMenu } from "react-icons/ai";
import { ImPushpin } from "react-icons/im";

import "./Tab.css";

export default function Tab({ id, item_limit, hidden }) {
  const [tabs, setTabs] = useState([]);
  const { setTabTotal, setGroups } = useContext(AppContext);

  useEffect(() => {
    TabFunc.setInitTabs(setTabs, id);
  }, [id]);

  return (
    <div className="d-flex flex-column mx-0 tabs-container">
      {tabs.map((tab) => {
        return (
          <div
            className={"row draggable p-0 mx-0 " + (hidden ? "d-none" : "")}
            draggable
            onDragStart={(e) => TabFunc.dragStart(e)}
            onDragEnd={(e) => TabFunc.dragEnd(e, item_limit, setGroups)}
            key={Math.random()}
          >
            <p
              className="close-tab"
              draggable={false}
              onClick={(e) => TabFunc.removeTab(e, tabs, setTabs, setTabTotal, setGroups)}
            >
              <TiDelete size="1.2rem" color="black" />
            </p>
            <p className="move-tab mx-1">
              <AiOutlineMenu size="1.2rem" color="black" />
            </p>
            <img className="img-tab" src={TabHelper.getFavIconURL(tab.url)} alt="icon" draggable={false} />
            <a
              href={tab.url}
              className="a-tab mx-1"
              target="_blank"
              rel="noreferrer"
              draggable={false}
              contentEditable={true}
              onMouseUp={(e) => TabFunc.handleTabClick(e)}
              onKeyPress={(e) => TabFunc.handleTabTitleChange(e)}
              onBlur={(e) => TabFunc.handleTabTitleChange(e)}
            >
              {tab.title}
              {tab.pinned && <ImPushpin className="pin ml-1" color="black" size="0.6rem" />}
            </a>
          </div>
        );
      })}
    </div>
  );
}
