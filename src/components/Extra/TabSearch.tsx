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

import { translate, regexSearchForTab, resetSearch } from "@App/App_functions";
import { userType } from "@Typings/common";

import { BsInfoCircle } from "react-icons/bs";
import { AiOutlineSearch } from "react-icons/ai";

export default function TabSearch({ user }: { user: userType }): JSX.Element {
  return (
    <div className="input-group search-filter my-3 mx-auto" onDrop={(e) => e.preventDefault()}>
      <div className="input-group-prepend">
        <span className="input-group-text">
          <AiOutlineSearch color="white" />
        </span>
      </div>
      <input
        type="text"
        name="search-group"
        maxLength={20}
        placeholder={translate("searchForTabs") + "..."}
        onChange={(e) => regexSearchForTab(e, user)}
        onBlur={(e) => resetSearch(e)}
      />
      <div className="input-group-append">
        <span
          className="input-group-text"
          data-tip={`#___ → ${translate("group")}<br />___ → ${translate("tab")}`}
          data-class="text-nowrap"
          data-for="search-tooltip"
        >
          <BsInfoCircle color="white" size="1rem" />
        </span>
      </div>
    </div>
  );
}
