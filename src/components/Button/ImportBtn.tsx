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
import { BiImport } from "react-icons/bi";
import { userType, setStateType } from "../../typings/common";

import { translate, importJSON } from "../App/App_functions";

export interface ImportBtnProps {
  user: userType;
  setTabTotal: setStateType<number>;
  setGroups: setStateType<string>;
}

export default function ImportBtn({ user, setGroups, setTabTotal }: ImportBtnProps): JSX.Element {
  return (
    <React.Fragment>
      <label
        id="import-btn"
        htmlFor="import-input"
        className="mx-2 mt-2 d-inline-block btn-in-global btn"
        data-tip={translate("importJSON")}
        data-for="btn-tooltip"
        data-place="bottom"
      >
        <BiImport color="black" size="1.4rem" />
      </label>
      <input
        id="import-input"
        type="file"
        accept=".json"
        onChange={(e) => importJSON(e, user, setGroups, setTabTotal)}
      ></input>
    </React.Fragment>
  );
}
