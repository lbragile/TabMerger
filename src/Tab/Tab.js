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

import React, { useState, useEffect } from "react";

import * as TabFunc from "./Tab_functions";
import * as TabHelper from "./Tab_helpers";

import { TiDelete } from "react-icons/ti";
import { AiOutlineMenu } from "react-icons/ai";

import "./Tab.css";

export default function Tab(props) {
  const [tabs, setTabs] = useState([]);

  useEffect(() => {
    TabFunc.setInitTabs(setTabs, props.id);
  }, [props.id]);

  return (
    <div className="d-flex flex-column mx-0 tabs-container">
      {tabs.map((tab) => {
        return (
          <div
            className="row draggable p-0 mx-0 "
            draggable
            onDragStart={(e) => TabFunc.dragStart(e)}
            onDragEnd={(e) => TabFunc.dragEnd(e, props.itemLimit, props.setGroups)}
            key={Math.random()}
          >
            <p
              className="close-tab mr-2"
              draggable={false}
              onClick={(e) => TabFunc.removeTab(e, tabs, setTabs, props.setTabTotal, props.setGroups)}
            >
              <TiDelete size="1.2rem" color="black" />
            </p>
            <p className="move-tab mr-2">
              <AiOutlineMenu size="1.2rem" color="black" />
            </p>
            <img className="img-tab mr-2" src={TabHelper.getFavIconURL(tab.url)} alt="icon" draggable={false} />
            <a
              href={tab.url}
              className="a-tab"
              target="_blank"
              rel="noreferrer"
              draggable={false}
              onClick={(e) => TabFunc.handleTabClick(e)}
            >
              {tab.title}
            </a>
          </div>
        );
      })}
    </div>
  );
}
