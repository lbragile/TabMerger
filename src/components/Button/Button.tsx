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

export interface ButtonProps {
  id?: string;
  classes: string;
  children: React.ReactChild;
  translate: string;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  place?: string;
}

export default function Button({
  id,
  classes,
  children,
  translate,
  onClick,
  disabled,
  place,
}: ButtonProps): JSX.Element {
  return (
    <button
      id={id}
      className={classes + " btn" + (disabled ? " disabled-btn" : "")}
      onClick={onClick}
      data-tip={translate}
      data-for={
        classes.includes("merge")
          ? "merge-btn-tooltip"
          : classes.includes("title")
          ? "group-title-btn-tooltip"
          : classes.includes("options") || classes.includes("print")
          ? "smaller-btn-tooltip"
          : "btn-tooltip"
      }
      data-place={place}
      data-tip-disable={disabled}
      data-offset={
        classes.includes("global")
          ? place === "top"
            ? "{'top': -5}"
            : "{'top': 0}"
          : classes.includes("merge")
          ? "{'left': -10}"
          : "{'top': -10}"
      }
    >
      {children}
    </button>
  );
}
