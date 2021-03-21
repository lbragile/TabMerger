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

import { translate, getTabMergerLink } from "@App/App_functions";

export default function Header({ total }: { total: number }): JSX.Element {
  return (
    <React.Fragment>
      <a href={getTabMergerLink(false)} target="_blank" rel="noreferrer">
        <img id="logo-img" src="./images/logo-full-rescale.PNG" alt="TabMerger Logo" />
      </a>
      <div className="subtitle">
        <h3>{total + " " + translate(total === 1 ? "tab" : "tabs")}</h3>
      </div>
    </React.Fragment>
  );
}
