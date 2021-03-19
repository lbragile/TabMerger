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

import Button from "./Button";
import * as AppFunc from "../App/App_functions";
import * as GroupFunc from "../Group/Group_functions";

export interface MergeButtons {
  classes: string;
  translate: string;
  clickFn: () => void;
  svg_class: string;
  viewBox: string;
  icon: JSX.Element;
}
export default function MergeBtns({ id }: { id: string }): JSX.Element {
  const MERGE_BUTTONS: MergeButtons[] = [
    {
      classes: "merge-btn btn-for-merging btn-outline-dark",
      translate: AppFunc.translate("mergeALLtabs"),
      clickFn: () => GroupFunc.sendMessage({ msg: "all", id }),
      svg_class: "merge-all-svg",
      viewBox: "-0.5 -0.5 165 155",
      icon: all_icon,
    },
    {
      classes: "merge-left-btn btn-for-merging btn-outline-dark",
      translate: AppFunc.translate("mergeLEFTtabs"),
      clickFn: () => GroupFunc.sendMessage({ msg: "left", id }),
      svg_class: "merge-left-svg",
      viewBox: "-0.5 -0.5 117 154",
      icon: left_right_icon,
    },
    {
      classes: "merge-right-btn btn-for-merging btn-outline-dark",
      translate: AppFunc.translate("mergeRIGHTtabs"),
      clickFn: () => GroupFunc.sendMessage({ msg: "right", id }),
      svg_class: "merge-right-svg",
      viewBox: "-0.5 -0.5 117 154",
      icon: left_right_icon,
    },
  ];

  return (
    <div className="merging-container float-right">
      <div className="d-flex flex-column">
        {MERGE_BUTTONS.map(
          (x: MergeButtons): JSX.Element => {
            return (
              <Button classes={x.classes} translate={x.translate} onClick={x.clickFn} key={Math.random()}>
                <svg
                  className={x.svg_class}
                  xmlns="http://www.w3.org/2000/svg"
                  width={32}
                  height={32}
                  viewBox={x.viewBox}
                  aria-labelledby="title"
                >
                  {x.icon}
                </svg>
              </Button>
            );
          }
        )}
      </div>
    </div>
  );
}

const left_right_icon = (
  <React.Fragment>
    <defs />
    <g>
      <path
        d="M 110 125 L 110 13"
        fill="none"
        stroke="#000000"
        strokeWidth="10"
        strokeMiterlimit="10"
        pointerEvents="stroke"
      />
      <path
        d="M 39 28.6 L 60.5 28.8 Q 82 29 81.62 64.91 L 81.24 100.82"
        fill="none"
        stroke="#000000"
        strokeWidth="10"
        strokeMiterlimit="10"
        pointerEvents="stroke"
      />
      <ellipse cx="28" cy="28.5" rx="11" ry="11" fill="none" stroke="#000000" strokeWidth="10" pointerEvents="all" />
      <path
        d="M 81.12 112.82 L 73.29 96.74 L 81.24 100.82 L 89.29 96.91 Z"
        fill="#000000"
        stroke="#000000"
        strokeWidth="10"
        strokeMiterlimit="10"
        pointerEvents="all"
      />
    </g>
  </React.Fragment>
);

const all_icon = (
  <React.Fragment>
    <defs />
    <g>
      <path
        d="M 39 29.6 L 60.5 29.8 Q 82 30 81.62 65.91 L 81.24 101.82"
        fill="none"
        stroke="#000000"
        strokeWidth="10"
        strokeMiterlimit="10"
        pointerEvents="stroke"
      />
      <ellipse cx="28" cy="29.5" rx="11" ry="11" fill="none" stroke="#000000" strokeWidth="10" pointerEvents="all" />
      <path
        d="M 81.12 113.82 L 73.29 97.74 L 81.24 101.82 L 89.29 97.91 Z"
        fill="#000000"
        stroke="#000000"
        strokeWidth="10"
        strokeMiterlimit="10"
        pointerEvents="all"
      />
      <path
        d="M 123 29.11 L 102.5 29.3 Q 82 29.5 81.62 65.41 L 81.24 101.32"
        fill="none"
        stroke="#000000"
        strokeWidth="10"
        strokeMiterlimit="10"
        pointerEvents="stroke"
      />
      <ellipse cx="134" cy="29" rx="11" ry="11" fill="none" stroke="#000000" strokeWidth="10" pointerEvents="all" />
      <path
        d="M 81.12 113.32 L 73.29 97.24 L 81.24 101.32 L 89.29 97.41 Z"
        fill="#000000"
        stroke="#000000"
        strokeWidth="10"
        strokeMiterlimit="10"
        pointerEvents="all"
      />
    </g>
  </React.Fragment>
);
